import { test, expect } from '@playwright/test'
import { GROUPS } from '../src/lib/config.js'
import {
  service,
  anon,
  ensureStaffUser,
  resetSettings,
  staffLogin,
  deleteRowsForToken,
  uploadOnce,
  STAFF,
} from './helpers.mjs'

const TOKEN = `test-set-${Date.now()}`
const NEW_USER = 'new-staff-e2e@crowdlens.local'

async function removeNewUser() {
  await service.from('staff_users').delete().eq('email', NEW_USER)
}

test.beforeAll(async () => {
  for (const role of ['moderator', 'organizer', 'admin']) await ensureStaffUser(role)
  await removeNewUser()
})

test.beforeEach(resetSettings)

test.afterAll(async () => {
  await resetSettings()
  await removeNewUser()
  // Leave no elevated test accounts on the allowlist.
  await service.from('staff_users').delete().in('email', [STAFF.organizer, STAFF.admin])
  await deleteRowsForToken(TOKEN)
})

async function getSettings() {
  const { data } = await service.from('app_settings').select('*').eq('id', 1).single()
  return data
}

test('organizer changes the limit and closes submissions', async ({ page }) => {
  await staffLogin(page, 'organizer')
  const nav = page.getByRole('navigation', { name: 'Sections' })
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)

  await nav.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  const save = page.getByRole('button', { name: 'Save settings' })
  await expect(save).toBeDisabled()

  await page.getByRole('spinbutton').fill('5')
  await page.getByRole('checkbox', { name: /Accept photo submissions/ }).uncheck()
  await page.getByPlaceholder('The camp’s disposable camera').fill('E2E tagline')
  await save.click()

  await expect(page.getByText('Settings saved')).toBeVisible()
  await expect(page.getByText('Unpublished changes.')).toBeVisible()
  await expect(save).toBeDisabled()

  const row = await getSettings()
  expect(row.daily_limit).toBe(5)
  expect(row.submissions_open).toBe(false)
  expect(row.tagline_en).toBe('E2E tagline')
  expect(row.updated_by).toBe(STAFF.organizer)

  // Enforced on the server right away, before any republish.
  const { error } = await anon.from('photos').insert({
    client_token: TOKEN,
    group_name: GROUPS[0],
    storage_path: `pending/${TOKEN}.jpg`,
  })
  expect(error?.message).toMatch(/Submissions are closed/)
})

test('saved group list reaches the moderation filter without a reload', async ({ page }) => {
  await staffLogin(page, 'organizer')
  await page.getByRole('link', { name: 'Settings' }).click()
  const groups = page.getByRole('textbox', { name: /Groups/ })
  await groups.fill(`${GROUPS.join('\n')}\nE2E New Group`)
  await expect(page.getByText(`Groups (${GROUPS.length + 1})`)).toBeVisible()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Settings saved')).toBeVisible()

  await page.getByRole('link', { name: 'Photos' }).click()
  await page.locator('.controls select').first().selectOption('E2E New Group')
  expect((await getSettings()).groups).toContain('E2E New Group')
})

test('a stale settings form cannot overwrite a newer save', async ({ page }) => {
  await staffLogin(page, 'organizer')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await service.from('app_settings').update({ daily_limit: 9 }).eq('id', 1)

  await page.getByRole('spinbutton').fill('4')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText(/Someone else changed the settings/)).toBeVisible()
  expect((await getSettings()).daily_limit).toBe(9)
})

test('moderator has no Settings or Users and is redirected from #settings', async ({ page }) => {
  await staffLogin(page, 'moderator')
  await expect(page.getByRole('heading', { name: /Pending photos/ })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Sections' })
  await expect(nav.getByRole('link')).toHaveText(['Photos'])

  await page.goto('/moderate/#settings')
  await page.reload()
  await expect(page.getByRole('heading', { name: /Pending photos/ })).toBeVisible()
  await expect(page).toHaveURL(/#photos$/)
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0)
})

test('admin adds a user, changes the role and removes them', async ({ page }) => {
  await staffLogin(page, 'admin')
  await page.getByRole('link', { name: 'Users' }).click()
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(STAFF.admin) })).toContainText('(you)')

  await page.getByLabel('New staff email').fill('New-Staff-E2E@crowdlens.local')
  await page.getByLabel('New staff role').selectOption('moderator')
  await page.getByRole('button', { name: 'Add user' }).click()
  const row = page.getByRole('row', { name: new RegExp(NEW_USER) })
  await expect(row).toBeVisible()

  const roleInDb = async () =>
    (await service.from('staff_users').select('role').eq('email', NEW_USER).maybeSingle()).data?.role
  expect(await roleInDb()).toBe('moderator')

  await page.getByLabel(`Role of ${NEW_USER}`).selectOption('organizer')
  await expect.poll(roleInDb).toBe('organizer')

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toHaveCount(0)
  await expect.poll(roleInDb).toBeUndefined()
})

test('signed-in user who is not on the staff list sees the no-access screen', async ({ page }) => {
  const email = await ensureStaffUser('moderator')
  await service.from('staff_users').delete().eq('email', email)
  try {
    await staffLogin(page, 'moderator')
    await expect(page.getByText(/not on the staff list/)).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
    await expect(page.getByRole('heading', { name: /Pending photos/ })).toHaveCount(0)
  } finally {
    await ensureStaffUser('moderator')
  }
})

test('"Open app" opens the participant page in a new tab', async ({ page }) => {
  await staffLogin(page, 'moderator')
  const link = page.getByTestId('open-app')
  await expect(link).toHaveAttribute('href', '/')
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
  await popup.waitForLoadState()
  expect(new URL(popup.url()).pathname).toBe('/')
  await expect(popup.getByRole('heading', { name: 'CrowdLens' })).toBeVisible()
})

test('participant page built before submissions closed shows the closed message', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox').selectOption(GROUPS[0])
  await service.from('app_settings').update({ submissions_open: false }).eq('id', 1)

  await uploadOnce(page, false)
  await expect(page.getByText(/képbeküldés jelenleg zárva/)).toBeVisible()
  await expect(page.getByRole('button', { name: /fotózz/i })).toHaveCount(0)
})
