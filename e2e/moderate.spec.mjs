import { test, expect } from '@playwright/test'
import { GROUPS } from '../src/lib/config.js'

const G = GROUPS.at(-1)
import {
  service,
  ensureStaffUser,
  deleteRowsForToken,
  STAFF_EMAIL,
  STAFF_PASSWORD,
  TINY_JPEG,
} from './helpers.mjs'

const TOKEN = `test-mod-${Date.now()}`

function slugifyGroup(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function seedPending(name, group) {
  const path = `${name}.jpg`
  const { error: upErr } = await service.storage
    .from('pending')
    .upload(path, TINY_JPEG, { contentType: 'image/jpeg' })
  if (upErr) throw new Error(upErr.message)
  const { data, error } = await service
    .from('photos')
    .insert({ client_token: TOKEN, group_name: group, storage_path: `pending/${path}` })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

test.beforeAll(async () => {
  await ensureStaffUser()
  await deleteRowsForToken(TOKEN)
})

test.afterAll(async () => {
  await deleteRowsForToken(TOKEN)
})

test('staff logs in, approves one photo, rejects another', async ({ page }) => {
  const approveMe = await seedPending(`${TOKEN}-a`, G)
  const rejectMe = await seedPending(`${TOKEN}-b`, G)

  await page.goto('/moderate/')
  await page.getByPlaceholder('Email').fill(STAFF_EMAIL)
  await page.getByPlaceholder('Password').fill(STAFF_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: /Pending photos/ })).toBeVisible()
  // Filter to this test's group so unrelated pending photos don't interfere.
  await page.locator('.controls select').first().selectOption(G)
  const cards = page.locator('.card')
  await expect(cards).toHaveCount(2)

  // Thumbnails load through signed URLs.
  const img = cards.first().locator('img')
  await expect(img).toHaveJSProperty('complete', true)
  expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)

  // Open the first photo full-size and approve it from the lightbox.
  await cards.first().locator('.zoom').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect
    .poll(() => dialog.locator('img').evaluate((el) => el.naturalWidth))
    .toBeGreaterThan(0)
  await dialog.getByRole('button', { name: 'Approve' }).click()
  // Deciding advances the lightbox to the next photo instead of closing.
  await expect(cards).toHaveCount(1)
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await cards.first().getByRole('button', { name: 'Reject' }).click()
  await expect(cards).toHaveCount(0)

  // Both decisions are visible in their tabs, with working previews.
  await page.getByRole('button', { name: 'Approved', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Approved photos/ })).toBeVisible()
  await expect(cards).toHaveCount(1)
  await expect
    .poll(() => cards.first().locator('img').evaluate((el) => el.naturalWidth))
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Rejected', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Rejected photos/ })).toBeVisible()
  await expect(cards).toHaveCount(1)
  await expect
    .poll(() => cards.first().locator('img').evaluate((el) => el.naturalWidth))
    .toBeGreaterThan(0)
  // Rejected photos can be re-approved but not re-rejected.
  // exact: the zoom button's accessible name is the img alt "rejected from …",
  // which substring-matches 'Reject' otherwise.
  await expect(cards.first().getByRole('button', { name: 'Approve', exact: true })).toHaveCount(1)
  await expect(cards.first().getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Pending', exact: true }).click()

  // DB state
  const { data: rows } = await service.from('photos').select('*').eq('client_token', TOKEN)
  const approved = rows.find((r) => r.id === approveMe.id)
  const rejected = rows.find((r) => r.id === rejectMe.id)
  expect(approved.status).toBe('approved')
  expect(approved.storage_path).toBe(`approved/${slugifyGroup(G)}/${TOKEN}-a.jpg`)
  expect(rejected.status).toBe('rejected')
  expect(rejected.storage_path).toBe(`pending/${TOKEN}-b.jpg`)

  // Approved photo is publicly reachable; rejected one is not in the public bucket.
  const pub = service.storage.from('approved').getPublicUrl(`${slugifyGroup(G)}/${TOKEN}-a.jpg`)
  expect((await fetch(pub.data.publicUrl)).ok).toBe(true)
  const pubRej = service.storage.from('approved').getPublicUrl(`${slugifyGroup(G)}/${TOKEN}-b.jpg`)
  expect((await fetch(pubRej.data.publicUrl)).ok).toBe(false)
})

test('anonymous visitor cannot see the moderation queue', async ({ page }) => {
  await page.goto('/moderate/')
  await expect(page.getByPlaceholder('Email')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Pending photos/ })).toHaveCount(0)
})

async function login(page) {
  await page.goto('/moderate/')
  await page.getByPlaceholder('Email').fill(STAFF_EMAIL)
  await page.getByPlaceholder('Password').fill(STAFF_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /photos \(/ })).toBeVisible()
  await page.locator('.controls select').first().selectOption(G)
}

test('decisions can be reverted later from the approved/rejected tabs', async ({ page }) => {
  await deleteRowsForToken(TOKEN) // clear residue from earlier tests in this file
  const photo = await seedPending(`${TOKEN}-swap`, G)
  const publicUrl = service.storage.from('approved').getPublicUrl(`${G}/${TOKEN}-swap.jpg`).data
    .publicUrl

  await login(page)
  const cards = page.locator('.card')
  await cards.first().getByRole('button', { name: 'Approve' }).click()
  await expect(cards).toHaveCount(0)
  await expect.poll(async () => (await fetch(publicUrl)).ok).toBe(true)

  // Un-approve: photo leaves the public bucket.
  await page.getByRole('button', { name: 'Approved', exact: true }).click()
  await cards.first().getByRole('button', { name: 'Reject' }).click()
  await expect(cards).toHaveCount(0)
  await expect.poll(async () => (await fetch(publicUrl)).ok).toBe(false)

  // Rescue from rejected: photo is public again.
  await page.getByRole('button', { name: 'Rejected', exact: true }).click()
  await cards.first().getByRole('button', { name: 'Approve' }).click()
  await expect(cards).toHaveCount(0)
  await expect.poll(async () => (await fetch(publicUrl)).ok).toBe(true)

  const { data: row } = await service.from('photos').select('*').eq('id', photo.id).single()
  expect(row.status).toBe('approved')
  expect(row.storage_path).toBe(`approved/${slugifyGroup(G)}/${TOKEN}-swap.jpg`)
})

test('lightbox arrows navigate and A/R shortcuts decide', async ({ page }) => {
  await deleteRowsForToken(TOKEN) // clear residue from earlier tests in this file
  const first = await seedPending(`${TOKEN}-kb1`, G)
  const second = await seedPending(`${TOKEN}-kb2`, G)

  await login(page)
  const cards = page.locator('.card')
  await expect(cards).toHaveCount(2)
  await cards.first().locator('.zoom').click()

  const dialog = page.getByRole('dialog')
  const dialogImg = dialog.locator('img')
  await expect(dialog).toBeVisible()
  const firstSrc = await dialogImg.getAttribute('src')

  await page.keyboard.press('ArrowRight')
  await expect(dialogImg).not.toHaveAttribute('src', firstSrc)
  await page.keyboard.press('ArrowLeft')
  await expect(dialogImg).toHaveAttribute('src', firstSrc)

  // Approving advances to the next photo; the last decision closes the lightbox.
  await page.keyboard.press('a')
  await expect(dialogImg).not.toHaveAttribute('src', firstSrc)
  await page.keyboard.press('r')
  await expect(dialog).toHaveCount(0)
  await expect(cards).toHaveCount(0)

  const { data: rows } = await service
    .from('photos')
    .select('id,status')
    .in('id', [first.id, second.id])
  expect(rows.find((r) => r.id === first.id).status).toBe('approved')
  expect(rows.find((r) => r.id === second.id).status).toBe('rejected')
})
