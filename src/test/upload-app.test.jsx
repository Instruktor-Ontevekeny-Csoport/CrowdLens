import { beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../upload/App.jsx'
import { DAILY_LIMIT, GROUPS } from '../lib/config.js'
import { t } from '../lib/i18n.js'

vi.mock('../lib/supabase.js', () => ({
  supabase: { storage: { from: vi.fn() }, from: vi.fn() },
}))
vi.mock('../lib/image.js', () => ({ compressImage: vi.fn() }))

import { supabase } from '../lib/supabase.js'
import { compressImage } from '../lib/image.js'

const upload = vi.fn()
const insert = vi.fn()

beforeEach(() => {
  localStorage.clear()
  document.cookie.split(';').forEach((c) => {
    const key = c.split('=')[0].trim()
    if (key) document.cookie = `${key}=; path=/; max-age=0`
  })
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  supabase.storage.from.mockReturnValue({ upload })
  supabase.from.mockReturnValue({ insert })
  upload.mockResolvedValue({ error: null })
  insert.mockResolvedValue({ error: null })
  compressImage.mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' }))
})

function pickFile(container) {
  const input = container.querySelector('input[type="file"]:not([capture])')
  const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
  return userEvent.upload(input, file)
}

test('starts with full film and buttons disabled until a group is chosen', () => {
  render(<App />)
  expect(screen.getByText(`${DAILY_LIMIT} kép maradt mára`)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /fotózz/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: t('pickFromGallery', 'hu') })).toBeDisabled()
})

test('has both a camera-capture input and a plain gallery input', () => {
  const { container } = render(<App />)
  expect(container.querySelector('input[type="file"][capture]')).toBeTruthy()
  expect(container.querySelector('input[type="file"]:not([capture])')).toBeTruthy()
})

test('full happy path: pick group, pick photo, send', async () => {
  const { container } = render(<App />)
  await userEvent.selectOptions(screen.getByRole('combobox'), GROUPS[1])
  expect(screen.getByRole('button', { name: /fotózz/i })).toBeEnabled()

  await pickFile(container)
  const send = await screen.findByRole('button', { name: 'Küldés' })
  await userEvent.click(send)

  await screen.findByText('Kép elküldve! 📸')
  expect(screen.getByText(`${DAILY_LIMIT - 1} kép maradt mára`)).toBeInTheDocument()

  expect(supabase.storage.from).toHaveBeenCalledWith('pending')
  expect(upload).toHaveBeenCalledWith(
    expect.stringMatching(/\.jpg$/),
    expect.any(Blob),
    expect.objectContaining({ contentType: 'image/jpeg' }),
  )
  const row = insert.mock.calls[0][0]
  expect(row.group_name).toBe(GROUPS[1])
  expect(row.storage_path).toMatch(/^pending\//)
  expect(row.client_token).toMatch(/^[0-9a-f-]{36}$/)
  expect(localStorage.getItem('cl_group')).toBe(GROUPS[1])
})

test('remembers the group from a previous visit', () => {
  localStorage.setItem('cl_group', GROUPS[4])
  render(<App />)
  expect(screen.getByRole('combobox')).toHaveValue(GROUPS[4])
  expect(screen.getByRole('button', { name: /fotózz/i })).toBeEnabled()
})

test('server-side daily limit maxes the local counter', async () => {
  insert.mockResolvedValue({ error: { message: 'Daily photo limit reached' } })
  const { container } = render(<App />)
  await userEvent.selectOptions(screen.getByRole('combobox'), GROUPS[0])
  await pickFile(container)
  await userEvent.click(await screen.findByRole('button', { name: 'Küldés' }))

  await screen.findByText('Elérted a napi limitet.')
  await screen.findByText('Mára betelt a film! 🎞️')
})

test('upload failure shows an error and keeps the preview for retry', async () => {
  upload.mockResolvedValueOnce({ error: { message: 'network down' } })
  const { container } = render(<App />)
  await userEvent.selectOptions(screen.getByRole('combobox'), GROUPS[0])
  await pickFile(container)
  await userEvent.click(await screen.findByRole('button', { name: 'Küldés' }))

  await screen.findByRole('alert')
  const retry = screen.getByRole('button', { name: 'Újra' })

  await userEvent.click(retry)
  await screen.findByText('Kép elküldve! 📸')
  // Retry reuses the same storage path so a half-done submit can't duplicate.
  expect(upload.mock.calls[0][0]).toBe(upload.mock.calls[1][0])
})

test('film-full state hides the shooting UI at the daily limit', () => {
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  localStorage.setItem('cl_date', iso)
  localStorage.setItem('cl_count', String(DAILY_LIMIT))
  render(<App />)
  expect(screen.getByText('Mára betelt a film! 🎞️')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /fotózz/i })).not.toBeInTheDocument()
})

test('non-image file shows an error', async () => {
  compressImage.mockRejectedValue(new Error('not-an-image'))
  const { container } = render(<App />)
  await userEvent.selectOptions(screen.getByRole('combobox'), GROUPS[0])
  const input = container.querySelector('input[type="file"]:not([capture])')
  await userEvent.upload(input, new File(['x'], 'doc.pdf', { type: 'application/pdf' }), {
    applyAccept: false,
  })
  await screen.findByText(/Ez nem képfájl — válassz fotót!/)
})

test('language toggle switches the UI to English', async () => {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'EN' }))
  expect(screen.getByText(`${DAILY_LIMIT} shots left today`)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /take a photo/i })).toBeInTheDocument()
})
