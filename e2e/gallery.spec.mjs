import { test, expect } from '@playwright/test'
import { GROUPS } from '../src/lib/config.js'
import { service, deleteRowsForToken, TINY_JPEG } from './helpers.mjs'

const G_MAIN = GROUPS.at(-4)
const G_OTHER = GROUPS.at(-3)
const G_EMPTY = GROUPS.at(-2)

const TOKEN = `test-gal-${Date.now()}`

async function seed(name, group, status) {
  let storagePath = `pending/${name}.jpg`
  if (status === 'approved') {
    storagePath = `approved/${group}/${name}.jpg`
    await service.storage
      .from('approved')
      .upload(`${group}/${name}.jpg`, TINY_JPEG, { contentType: 'image/jpeg' })
  } else {
    await service.storage.from('pending').upload(`${name}.jpg`, TINY_JPEG, {
      contentType: 'image/jpeg',
    })
  }
  // One token per row: the daily-limit trigger applies to seeds too.
  const { error } = await service.from('photos').insert({
    client_token: `${TOKEN}-${name}`,
    group_name: group,
    storage_path: storagePath,
    status,
  })
  if (error) throw new Error(error.message)
}

test.beforeAll(async () => {
  await deleteRowsForToken(TOKEN)
  await seed(`${TOKEN}-ok1`, G_MAIN, 'approved')
  await seed(`${TOKEN}-ok2`, G_MAIN, 'approved')
  await seed(`${TOKEN}-other`, G_OTHER, 'approved')
  await seed(`${TOKEN}-pend`, G_MAIN, 'pending')
  await seed(`${TOKEN}-rej`, G_MAIN, 'rejected')
})

test.afterAll(async () => {
  await deleteRowsForToken(TOKEN)
})

test('defaults to all groups', async ({ page }) => {
  await page.goto('/gallery/')
  await expect(page.getByRole('combobox')).toHaveValue('all')
  // At least the 3 approved seeds are visible without picking a group.
  await expect
    .poll(async () => page.locator('.photo-grid img').count())
    .toBeGreaterThanOrEqual(3)
})

test('shows only approved photos of the selected group', async ({ page }) => {
  await page.goto('/gallery/')
  await page.getByRole('combobox').selectOption(G_MAIN)

  const imgs = page.locator('.photo-grid img')
  await expect(imgs).toHaveCount(2)
  const first = imgs.first()
  await expect(first).toHaveJSProperty('complete', true)
  expect(await first.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)

  await page.getByRole('combobox').selectOption(G_OTHER)
  await expect(imgs).toHaveCount(1)
})

test('lightbox opens and closes', async ({ page }) => {
  await page.goto('/gallery/')
  await page.getByRole('combobox').selectOption(G_MAIN)
  await page.locator('.thumb').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('arrow keys navigate between photos, Escape closes', async ({ page }) => {
  await page.goto('/gallery/')
  await page.getByRole('combobox').selectOption(G_MAIN)
  await page.locator('.thumb').first().click()
  const dialogImg = page.getByRole('dialog').locator('img')
  const firstSrc = await dialogImg.getAttribute('src')

  await page.keyboard.press('ArrowRight')
  await expect(dialogImg).not.toHaveAttribute('src', firstSrc)
  // First photo again: ArrowLeft goes back, further presses clamp at the start.
  await page.keyboard.press('ArrowLeft')
  await expect(dialogImg).toHaveAttribute('src', firstSrc)
  await page.keyboard.press('ArrowLeft')
  await expect(dialogImg).toHaveAttribute('src', firstSrc)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('empty group shows the empty state', async ({ page }) => {
  await page.goto('/gallery/')
  await page.getByRole('combobox').selectOption(G_EMPTY)
  await expect(page.getByText(/nincs előhívott kép|No developed photos/)).toBeVisible()
})

test('links back to the camera page', async ({ page }) => {
  await page.goto('/gallery/')
  await expect(page.locator('a.back-link')).toHaveAttribute('href', '/')
})
