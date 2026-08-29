import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

export const service = createClient(SUPABASE_URL, SERVICE_KEY)

export const STAFF_EMAIL = 'staff-e2e@crowdlens.local'
export const STAFF_PASSWORD = 'e2e-password-1234'

// 1x1 white JPEG.
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
)

export async function ensureStaffUser() {
  const { error } = await service.auth.admin.createUser({
    email: STAFF_EMAIL,
    password: STAFF_PASSWORD,
    email_confirm: true,
  })
  if (error && !/already/i.test(error.message)) throw error
}

export async function getToken(page) {
  return page.evaluate(() => localStorage.getItem('cl_token'))
}

export async function deleteRowsForToken(token) {
  if (!token) return
  const { data } = await service.from('photos').select('storage_path').like('client_token', `${token}%`)
  for (const row of data ?? []) {
    const [bucket, ...rest] = row.storage_path.split('/')
    await service.storage.from(bucket).remove([rest.join('/')])
  }
  await service.from('photos').delete().like('client_token', `${token}%`)
}

export async function uploadOnce(page, expectSuccess = true) {
  await page.setInputFiles('input[type="file"]:not([capture])', {
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: TINY_JPEG,
  })
  await page.getByRole('button', { name: /küldés|send/i }).click()
  if (expectSuccess) {
    // The third shot of the day lands directly on the film-full screen.
    await page.getByText(/Kép elküldve|Photo sent|Mára betelt|Film is full/).waitFor()
  }
}
