import { beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mutable stand-in for the baked settings; each test tweaks it before rendering.
const cfg = vi.hoisted(() => ({
  GROUPS: ['Alpha', 'Beta'],
  DAILY_LIMIT: 3,
  GROUP_MODE: true,
  SUBMISSIONS_OPEN: true,
  CUSTOM_TAGLINE: { hu: '', en: '' },
  CUSTOM_NOTICE: { hu: '', en: '' },
  SETTINGS_UPDATED_AT: null,
  CAMP_TIMEZONE: 'Europe/Budapest',
  PENDING_BUCKET: 'pending',
  APPROVED_BUCKET: 'approved',
}))
vi.mock('../lib/config.js', () => cfg)
vi.mock('../lib/supabase.js', () => ({
  supabase: { storage: { from: vi.fn() }, from: vi.fn() },
}))
vi.mock('../lib/image.js', () => ({ compressImage: vi.fn() }))

import App from '../upload/App.jsx'
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
  Object.assign(cfg, {
    DAILY_LIMIT: 3,
    GROUP_MODE: true,
    SUBMISSIONS_OPEN: true,
    CUSTOM_TAGLINE: { hu: '', en: '' },
    CUSTOM_NOTICE: { hu: '', en: '' },
  })
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  supabase.storage.from.mockReturnValue({ upload })
  supabase.from.mockReturnValue({ insert })
  upload.mockResolvedValue({ error: null })
  insert.mockResolvedValue({ error: null })
  compressImage.mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' }))
})

async function pickAndSend(container) {
  const input = container.querySelector('input[type="file"]:not([capture])')
  await userEvent.upload(input, new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Küldés' }))
}

test('closed submissions replace the shooting UI with a closed panel', () => {
  cfg.SUBMISSIONS_OPEN = false
  const { container } = render(<App />)
  expect(screen.getByText(/képbeküldés jelenleg zárva/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /fotózz/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  // Gallery and notice links stay available.
  expect(container.querySelector('a.gallery-link')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Fontos információ' })).toBeInTheDocument()
})

test('group mode off: no picker, buttons enabled, photo sent without a group', async () => {
  cfg.GROUP_MODE = false
  const { container } = render(<App />)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /fotózz/i })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Kép feltöltése' })).toBeEnabled()

  await pickAndSend(container)
  await screen.findByText('Kép elküldve! 📸')
  expect(insert.mock.calls[0][0].group_name).toBeNull()
  expect(localStorage.getItem('cl_group')).toBeNull()
})

test('custom tagline and notice override the built-in texts', async () => {
  cfg.CUSTOM_TAGLINE = { hu: 'Egyedi szlogen', en: 'Custom tagline' }
  cfg.CUSTOM_NOTICE = { hu: 'Egyedi tájékoztató <b>szöveg</b>', en: '' }
  render(<App />)
  expect(screen.getByText('Egyedi szlogen')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Fontos információ' }))
  // Rendered as plain text, never as HTML.
  expect(screen.getByText('Egyedi tájékoztató <b>szöveg</b>')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'EN' }))
  expect(screen.getByText('Custom tagline')).toBeInTheDocument()
  expect(screen.getByText(/You may upload a maximum of 3 photos per day/)).toBeInTheDocument()
})

test('default notice states the configured daily limit', async () => {
  cfg.DAILY_LIMIT = 7
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'Fontos információ' }))
  expect(screen.getByText(/Naponta legfeljebb 7 képet tölthetsz fel/)).toBeInTheDocument()
})

test('limits above 10 show only the numeric counter', () => {
  cfg.DAILY_LIMIT = 25
  const { container } = render(<App />)
  expect(container.querySelectorAll('.frame')).toHaveLength(0)
  expect(screen.getByText('25 kép maradt mára')).toBeInTheDocument()
})

test('"Submissions are closed" from the server shows the closed panel', async () => {
  insert.mockResolvedValue({ error: { message: 'Submissions are closed' } })
  const { container } = render(<App />)
  await userEvent.selectOptions(screen.getByRole('combobox'), 'Alpha')
  await pickAndSend(container)

  await screen.findByText(/képbeküldés jelenleg zárva/)
  expect(screen.queryByRole('button', { name: /fotózz/i })).not.toBeInTheDocument()
  expect(screen.getByText('3 kép maradt mára')).toBeInTheDocument()
})

test('a storage policy rejection is treated as closed submissions', async () => {
  upload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } })
  const { container } = render(<App />)
  await userEvent.selectOptions(screen.getByRole('combobox'), 'Alpha')
  await pickAndSend(container)

  await screen.findByText(/képbeküldés jelenleg zárva/)
  expect(insert).not.toHaveBeenCalled()
})

test('"Invalid group" from the server asks to pick again', async () => {
  insert.mockResolvedValue({ error: { message: 'Invalid group' } })
  const { container } = render(<App />)
  await userEvent.selectOptions(screen.getByRole('combobox'), 'Beta')
  await pickAndSend(container)

  await screen.findByText(/Ez a csapat már nem választható/)
  expect(screen.getByRole('combobox')).toHaveValue('')
  expect(screen.getByText('3 kép maradt mára')).toBeInTheDocument()
})

test('a remembered group that no longer exists is not preselected', () => {
  localStorage.setItem('cl_group', 'Removed group')
  render(<App />)
  expect(screen.getByRole('combobox')).toHaveValue('')
  expect(screen.getByRole('button', { name: /fotózz/i })).toBeDisabled()
})
