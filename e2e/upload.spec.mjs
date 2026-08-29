import { test, expect } from '@playwright/test'
import { GROUPS, DAILY_LIMIT } from '../src/lib/config.js'
import { service, getToken, deleteRowsForToken, uploadOnce } from './helpers.mjs'

let token

test.afterEach(async () => {
  await deleteRowsForToken(token)
  token = null
})

test('full participant flow: all shots used, then the film is full', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(`${DAILY_LIMIT} kép maradt mára`)).toBeVisible()

  await page.getByRole('combobox').selectOption(GROUPS[1])

  await uploadOnce(page)
  await expect(page.getByText(`${DAILY_LIMIT - 1} kép maradt mára`)).toBeVisible()
  token = await getToken(page)

  for (let i = 1; i < DAILY_LIMIT; i++) await uploadOnce(page)
  await expect(page.getByText(/Mára betelt a film/)).toBeVisible()
  await expect(page.getByRole('button', { name: /fotózz/i })).toHaveCount(0)

  // Server state: all rows pending for this token, objects present in storage.
  const { data: rows } = await service.from('photos').select('*').eq('client_token', token)
  expect(rows).toHaveLength(DAILY_LIMIT)
  for (const row of rows) {
    expect(row.status).toBe('pending')
    expect(row.group_name).toBe(GROUPS[1])
    const { data, error } = await service.storage
      .from('pending')
      .download(row.storage_path.replace(/^pending\//, ''))
    expect(error).toBeNull()
    expect(data.size).toBeGreaterThan(0)
  }

  // Reload: film stays full, group stays selected.
  await page.reload()
  await expect(page.getByText(/Mára betelt a film/)).toBeVisible()
})

test('server rejects an over-limit upload even if the local counter is wiped', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox').selectOption(GROUPS[2])
  await uploadOnce(page)
  token = await getToken(page)
  for (let i = 1; i < DAILY_LIMIT; i++) await uploadOnce(page)

  // Simulate the localStorage bypass: reset the counter but keep the token.
  await page.evaluate(() => {
    localStorage.removeItem('cl_count')
    localStorage.removeItem('cl_date')
    document.cookie = 'cl_count=; path=/; max-age=0'
    document.cookie = 'cl_date=; path=/; max-age=0'
  })
  await page.reload()
  await expect(page.getByText(`${DAILY_LIMIT} kép maradt mára`)).toBeVisible()

  await uploadOnce(page, false)
  await expect(page.getByText(/Elérted a napi limitet|daily limit/)).toBeVisible()

  const { data: rows } = await service.from('photos').select('id').eq('client_token', token)
  expect(rows).toHaveLength(DAILY_LIMIT)
})

test('links to the gallery', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a.gallery-link')).toHaveAttribute('href', '/gallery/')
})

test('language toggle and group memory survive a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByText(`${DAILY_LIMIT} shots left today`)).toBeVisible()
  await page.getByRole('combobox').selectOption(GROUPS[6])
  await uploadOnce(page)
  token = await getToken(page)

  await page.reload()
  await expect(page.getByText(/shots left today/)).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveValue(GROUPS[6])
})
