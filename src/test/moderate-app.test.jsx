import { beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      signInWithOAuth: vi.fn(),
      signInWithPassword: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}))

import App from '../moderate/App.jsx'
import { supabase } from '../lib/supabase.js'
import { can, roleOf } from '../moderate/roles.js'

const SETTINGS = {
  id: 1,
  submissions_open: true,
  daily_limit: 3,
  group_mode: true,
  groups: ['Alpha', 'Beta'],
  tagline_hu: '',
  tagline_en: '',
  notice_hu: '',
  notice_en: '',
  last_publish_at: null,
  updated_at: '2026-09-30T10:00:00.123456+00:00',
  updated_by: null,
}
const SESSION = { user: { id: 'user-1', email: 'Staff@Example.com' } }

// Chainable, awaitable stand-in for a PostgREST query builder.
function query(result) {
  const q = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }
  for (const m of ['select', 'eq', 'order', 'insert', 'update', 'delete', 'single', 'maybeSingle']) {
    q[m] = vi.fn(() => q)
  }
  return q
}

let tables
let authListener

function signedIn(rank, settings = SETTINGS) {
  supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } })
  supabase.rpc.mockResolvedValue({ data: { rank, settings }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.location.hash = ''
  tables = { photos: query({ data: [], error: null }) }
  supabase.from.mockImplementation((name) => tables[name])
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
  supabase.auth.signInWithOAuth.mockResolvedValue({ error: null })
  supabase.auth.onAuthStateChange.mockImplementation((cb) => {
    authListener = cb
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})

const navLabels = () =>
  within(screen.getByRole('navigation', { name: 'Sections' }))
    .getAllByRole('link')
    .map((a) => a.textContent)

test('roles map to permissions', () => {
  expect(['moderate', 'settings', 'users'].map((a) => can(0, a))).toEqual([false, false, false])
  expect(['moderate', 'settings', 'users'].map((a) => can(1, a))).toEqual([true, false, false])
  expect(['moderate', 'settings', 'users'].map((a) => can(2, a))).toEqual([true, true, false])
  expect(['moderate', 'settings', 'users'].map((a) => can(3, a))).toEqual([true, true, true])
  expect(roleOf(2)).toBe('organizer')
})

test('signed out: Google button, password form and the open-app link', async () => {
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
  expect(screen.getByTestId('open-app')).toHaveAttribute('href', '/')
  expect(supabase.rpc).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
  expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'google',
      options: expect.objectContaining({ redirectTo: `${window.location.origin}/moderate/` }),
    }),
  )
})

test('rank 0 sees the no-access screen with their email', async () => {
  signedIn(0)
  render(<App />)
  expect(await screen.findByText('Staff@Example.com')).toBeInTheDocument()
  expect(screen.getByText(/Ask an admin to add you/)).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument()
  expect(screen.getByTestId('open-app')).toHaveAttribute('href', '/')
  expect(supabase.from).not.toHaveBeenCalled()
})

test('moderator sees only the Photos section', async () => {
  signedIn(1)
  render(<App />)
  expect(await screen.findByRole('heading', { name: /Pending photos/ })).toBeInTheDocument()
  expect(navLabels()).toEqual(['Photos'])
})

test('organizer sees Photos and Settings', async () => {
  signedIn(2)
  render(<App />)
  await screen.findByRole('heading', { name: /Pending photos/ })
  expect(navLabels()).toEqual(['Photos', 'Settings'])
})

test('admin sees all sections and a prominent open-app link', async () => {
  signedIn(3)
  render(<App />)
  await screen.findByRole('heading', { name: /Pending photos/ })
  expect(navLabels()).toEqual(['Photos', 'Settings', 'Users'])
  const link = screen.getByTestId('open-app')
  expect(link).toHaveAttribute('href', '/')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveTextContent('Open CrowdLens app')
})

test('a forbidden view in the hash redirects to photos', async () => {
  window.location.hash = '#users'
  signedIn(1)
  render(<App />)
  await screen.findByRole('heading', { name: /Pending photos/ })
  await waitFor(() => expect(window.location.hash).toBe('#photos'))
  expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument()
})

test('bootstrap runs once per user, not on token refresh', async () => {
  signedIn(1)
  render(<App />)
  await screen.findByRole('heading', { name: /Pending photos/ })
  authListener('TOKEN_REFRESHED', { user: { ...SESSION.user } })
  authListener('SIGNED_IN', { user: { ...SESSION.user } })
  await screen.findByRole('heading', { name: /Pending photos/ })
  expect(supabase.rpc).toHaveBeenCalledTimes(1)
  expect(supabase.rpc).toHaveBeenCalledWith('moderate_bootstrap')
})

test('queue filters use live groups plus groups found on photos', async () => {
  tables.photos = query({
    data: [
      {
        id: 'p1',
        group_name: 'Removed',
        status: 'pending',
        storage_path: 'pending/p1.jpg',
        submitted_date: '2026-09-30',
        created_at: '2026-09-30T10:00:00Z',
      },
    ],
    error: null,
  })
  supabase.storage.from.mockReturnValue({
    createSignedUrls: vi.fn().mockResolvedValue({ data: [{ signedUrl: 'http://x/p1' }] }),
  })
  signedIn(1)
  const { container } = render(<App />)
  await screen.findByRole('heading', { name: 'Pending photos (1)' })
  const options = [...container.querySelector('.controls select').options].map((o) => o.textContent)
  expect(options).toEqual(['All groups', 'Alpha', 'Beta', 'Removed'])
})

test('group mode off hides the group filter in the queue', async () => {
  signedIn(1, { ...SETTINGS, group_mode: false })
  const { container } = render(<App />)
  await screen.findByRole('heading', { name: /Pending photos/ })
  const selects = container.querySelectorAll('.controls select')
  expect(selects).toHaveLength(1)
  expect(selects[0].options[0].textContent).toBe('All days')
})

test('settings: save sends parsed values guarded by updated_at', async () => {
  window.location.hash = '#settings'
  signedIn(2)
  const saved = { ...SETTINGS, daily_limit: 5, groups: ['Alpha', 'Gamma'], updated_at: '2026-09-30T11:00:00+00:00' }
  tables.app_settings = query({ data: saved, error: null })
  render(<App />)

  await screen.findByRole('heading', { name: 'Settings' })
  // Baked settings (test defaults) differ from the live row.
  expect(screen.getByText('Unpublished changes.')).toBeInTheDocument()
  const save = screen.getByRole('button', { name: 'Save settings' })
  expect(save).toBeDisabled()

  const limit = screen.getByRole('spinbutton')
  await userEvent.clear(limit)
  expect(screen.getByText(/whole number between 1 and 50/)).toBeInTheDocument()
  await userEvent.type(limit, '5')
  const groups = screen.getByRole('textbox', { name: /Groups/ })
  await userEvent.clear(groups)
  await userEvent.type(groups, ' Alpha {enter}{enter}Gamma{enter}Alpha')
  expect(screen.getByText('Groups (2)')).toBeInTheDocument()
  await userEvent.click(save)

  await screen.findByText(/Settings saved/)
  const q = tables.app_settings
  expect(q.update).toHaveBeenCalledWith({
    submissions_open: true,
    daily_limit: 5,
    group_mode: true,
    groups: ['Alpha', 'Gamma'],
    tagline_hu: '',
    tagline_en: '',
    notice_hu: '',
    notice_en: '',
  })
  expect(q.eq).toHaveBeenCalledWith('updated_at', SETTINGS.updated_at)
  expect(save).toBeDisabled()

  // The queue picks up the saved groups without a reload.
  await userEvent.click(screen.getByRole('link', { name: 'Photos' }))
  await waitFor(() => expect(window.location.hash).toBe('#photos'))
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Gamma', hidden: true })).toBeInTheDocument(),
  )
})

test('settings: a concurrent change is reported instead of overwritten', async () => {
  window.location.hash = '#settings'
  signedIn(3)
  tables.app_settings = query({ data: null, error: null })
  render(<App />)

  await screen.findByRole('heading', { name: 'Settings' })
  await userEvent.click(screen.getByRole('checkbox', { name: /Accept photo submissions/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  expect(await screen.findByText(/Someone else changed the settings/)).toBeInTheDocument()
  expect(screen.queryByText(/Settings saved/)).not.toBeInTheDocument()
})

test('settings: groups are required while group mode is on', async () => {
  window.location.hash = '#settings'
  signedIn(2)
  render(<App />)
  await screen.findByRole('heading', { name: 'Settings' })
  const groups = screen.getByRole('textbox', { name: /Groups/ })
  await userEvent.clear(groups)
  expect(screen.getByText(/Add at least one group/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()

  await userEvent.click(screen.getByRole('checkbox', { name: /Group mode/ }))
  expect(screen.queryByText(/Add at least one group/)).not.toBeInTheDocument()
  expect(groups).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled()
})

test('users: lists staff, adds a lowercased email, shows database errors verbatim', async () => {
  window.location.hash = '#users'
  signedIn(3)
  tables.staff_users = query({
    data: [{ email: 'staff@example.com', role: 'admin' }],
    error: null,
  })
  render(<App />)

  await screen.findByRole('heading', { name: 'Users' })
  expect(await screen.findByText('(you)')).toBeInTheDocument()

  const added = query({ data: { email: 'new.person@example.com', role: 'organizer' }, error: null })
  supabase.from.mockImplementation((name) => (name === 'staff_users' ? added : tables[name]))
  await userEvent.type(screen.getByLabelText('New staff email'), '  New.Person@Example.com ')
  await userEvent.selectOptions(screen.getByLabelText('New staff role'), 'organizer')
  await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
  expect(await screen.findByText('new.person@example.com')).toBeInTheDocument()
  expect(added.insert).toHaveBeenCalledWith({
    email: 'new.person@example.com',
    role: 'organizer',
    created_by: 'staff@example.com',
  })

  const denied = query({ data: null, error: { message: 'Cannot remove the last admin' } })
  supabase.from.mockImplementation((name) => (name === 'staff_users' ? denied : tables[name]))
  await userEvent.selectOptions(screen.getByLabelText('Role of staff@example.com'), 'moderator')
  expect(await screen.findByText('Cannot remove the last admin')).toBeInTheDocument()
  expect(screen.getByLabelText('Role of staff@example.com')).toHaveValue('admin')
})
