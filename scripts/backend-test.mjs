// Integration tests for the CrowdLens backend (triggers, RLS, roles, storage policies).
// Run against the local stack:  npm run test:backend
// Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Optional SUPABASE_JWT_SECRET (defaults to the local stack's) enables the
// unconfirmed-user check on projects that refuse unconfirmed sign-ins.
// Temporarily changes app_settings (restored at the end) — don't run during the event.

import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!anonKey || !serviceKey) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see `supabase status`).')
  process.exit(1)
}

const isLocal = /127\.0\.0\.1|localhost/.test(url)
const jwtSecret =
  process.env.SUPABASE_JWT_SECRET ??
  (isLocal ? 'super-secret-jwt-token-with-at-least-32-characters-long' : null)

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const anon = createClient(url, anonKey, noSession)
const service = createClient(url, serviceKey, noSession)

const PASSWORD = 'test-password-1234'
const USERS = {
  admin: 'test-admin@crowdlens.local',
  admin2: 'test-admin2@crowdlens.local',
  organizer: 'test-organizer@crowdlens.local',
  moderator: 'test-moderator@crowdlens.local',
  outsider: 'test-outsider@crowdlens.local',
  unconfirmed: 'test-unconfirmed@crowdlens.local',
}
const TOKEN = `test-${Date.now()}`
const FOLDER = 'test-folder'
const budapestToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Budapest',
}).format(new Date())

let passed = 0
let failed = 0
let skipped = 0
async function check(name, fn) {
  try {
    const result = await fn()
    if (result === 'skip') {
      skipped++
      console.log(`skip  ${name}`)
    } else {
      passed++
      console.log(`  ok  ${name}`)
    }
  } catch (e) {
    failed++
    console.error(`FAIL  ${name}: ${e.message}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function jpegBlob() {
  // Minimal JPEG header bytes; enough for storage, not a real decodable image.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9])
  return new Blob([bytes], { type: 'image/jpeg' })
}

async function setSettings(patch) {
  const { error } = await service.from('app_settings').update(patch).eq('id', 1)
  if (error) throw new Error(`settings update failed: ${error.message}`)
}

async function deleteTestUsers() {
  await service.from('staff_users').delete().in('email', Object.values(USERS))
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 })
  const emails = new Set(Object.values(USERS))
  for (const u of data?.users ?? []) {
    if (emails.has(u.email)) await service.auth.admin.deleteUser(u.id)
  }
}

async function cleanup() {
  await service.from('photos').delete().like('client_token', 'test-%')
  for (const bucket of ['pending', 'approved']) {
    const { data } = await service.storage.from(bucket).list('', { limit: 1000 })
    const rootFiles = (data ?? []).filter((f) => f.name.startsWith('test-')).map((f) => f.name)
    const { data: nested } = await service.storage.from(bucket).list(FOLDER, { limit: 1000 })
    const nestedFiles = (nested ?? []).map((f) => `${FOLDER}/${f.name}`)
    const all = [...rootFiles, ...nestedFiles]
    if (all.length) await service.storage.from(bucket).remove(all)
  }
  await deleteTestUsers()
}

async function makeUser(email, role, confirmed = true) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: confirmed,
  })
  if (error) throw error
  if (role) {
    const { error: roleErr } = await service.from('staff_users').insert({ email, role })
    if (roleErr) throw roleErr
  }
  return data.user.id
}

// Client acting as a user who never signed in, via a self-minted access token.
function clientWithMintedToken(userId, email) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: userId,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 600,
  })}`
  const token = `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`
  return createClient(url, anonKey, {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

// Returns a signed-in client, or null when sign-in is refused (unconfirmed
// users on projects that require email confirmation).
async function signIn(email) {
  const client = createClient(url, anonKey, noSession)
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) {
    if (/confirm/i.test(error.message)) return null
    throw error
  }
  return client
}

function insertPhoto(client, token, group, name = token) {
  return client.from('photos').insert({
    client_token: token,
    group_name: group,
    storage_path: `pending/${name}.jpg`,
  })
}

// Settings snapshot: restored at the end so a run never changes a live config.
const { data: original, error: snapErr } = await service
  .from('app_settings')
  .select('*')
  .eq('id', 1)
  .single()
if (snapErr) {
  console.error(`Cannot read app_settings (is the migration applied?): ${snapErr.message}`)
  process.exit(1)
}
const groups = original.groups.length ? original.groups : ['A']
const G = groups[0]
const baseline = { submissions_open: true, daily_limit: 3, group_mode: true, groups }

async function restoreSettings() {
  const { id, updated_at, updated_by, last_publish_at, ...rest } = original
  await setSettings(rest)
}

await cleanup()
await setSettings(baseline)

// Participants --------------------------------------------------------------

await check('anon can insert 3 photos on one day', async () => {
  for (let i = 0; i < 3; i++) {
    const { error } = await insertPhoto(anon, TOKEN, G, `${TOKEN}-${i}`)
    assert(!error, `insert ${i + 1} failed: ${error?.message}`)
  }
})

await check('4th insert is rejected by the daily-limit trigger', async () => {
  const { error } = await insertPhoto(anon, TOKEN, G, `${TOKEN}-3`)
  assert(error, 'insert unexpectedly succeeded')
  assert(/Daily photo limit/i.test(error.message), `wrong error: ${error.message}`)
})

await check('submitted_date is the Budapest calendar day', async () => {
  const { data } = await service.from('photos').select('submitted_date').eq('client_token', TOKEN).limit(1).single()
  assert(data.submitted_date === budapestToday, `${data.submitted_date} != ${budapestToday}`)
})

await check('anon cannot insert a pre-approved row', async () => {
  const { error } = await anon.from('photos').insert({
    client_token: `${TOKEN}-b`,
    group_name: G,
    storage_path: `pending/${TOKEN}-b.jpg`,
    status: 'approved',
  })
  assert(error, 'RLS should reject status=approved from anon')
})

await check('anon cannot backdate submitted_date', async () => {
  const { error } = await anon.from('photos').insert({
    client_token: `${TOKEN}-c`,
    group_name: G,
    storage_path: `pending/${TOKEN}-c.jpg`,
    submitted_date: '2020-01-01',
  })
  assert(error, 'RLS should reject a backdated row')
})

await check('anon sees only approved rows', async () => {
  await service
    .from('photos')
    .update({ status: 'approved' })
    .eq('storage_path', `pending/${TOKEN}-0.jpg`)
  const { data } = await anon.from('photos').select('storage_path,status').like('client_token', 'test-%')
  assert(data.length === 1, `expected 1 visible row, got ${data.length}`)
  assert(data[0].status === 'approved', 'non-approved row leaked')
})

await check('anon cannot update or delete rows', async () => {
  const { data: upd } = await anon
    .from('photos')
    .update({ status: 'approved' })
    .like('client_token', 'test-%')
    .select()
  assert(!upd || upd.length === 0, 'anon update went through')
  const { data: del } = await anon.from('photos').delete().like('client_token', 'test-%').select()
  assert(!del || del.length === 0, 'anon delete went through')
})

await check('a concurrent burst still allows exactly daily_limit inserts', async () => {
  const burstToken = `${TOKEN}-burst`
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => insertPhoto(anon, burstToken, G, `${burstToken}-${i}`)),
  )
  const ok = results.filter((r) => !r.error).length
  assert(ok === 3, `expected exactly 3 successes, got ${ok}`)
})

await check('anon can upload a jpeg to pending', async () => {
  const { error } = await anon.storage.from('pending').upload(`${TOKEN}.jpg`, jpegBlob())
  assert(!error, error?.message)
})

await check('anon cannot upload a non-jpeg', async () => {
  const blob = new Blob(['hello'], { type: 'text/plain' })
  const { error } = await anon.storage.from('pending').upload(`${TOKEN}.txt`, blob)
  assert(error, 'mime restriction did not reject text/plain')
})

await check('anon cannot read from pending', async () => {
  const { error } = await anon.storage.from('pending').download(`${TOKEN}.jpg`)
  assert(error, 'anon read of pending should fail')
})

await check('anon cannot write to approved bucket', async () => {
  const { error } = await anon.storage.from('approved').upload(`${FOLDER}/${TOKEN}-evil.jpg`, jpegBlob())
  assert(error, 'anon write to approved should fail')
})

// Settings-driven trigger behaviour -----------------------------------------

await check('anon can read app_settings but not update it', async () => {
  const { data, error } = await anon.from('app_settings').select('*').eq('id', 1).single()
  assert(!error && data.daily_limit === 3, error?.message ?? 'unexpected settings row')
  const { data: upd } = await anon.from('app_settings').update({ daily_limit: 50 }).eq('id', 1).select()
  assert(!upd || upd.length === 0, 'anon settings update went through')
  const { data: after } = await service.from('app_settings').select('daily_limit').eq('id', 1).single()
  assert(after.daily_limit === 3, 'anon changed the daily limit')
})

await check('closed submissions block both the storage upload and the insert', async () => {
  await setSettings({ submissions_open: false })
  try {
    const { error: upErr } = await anon.storage.from('pending').upload(`${TOKEN}-closed.jpg`, jpegBlob())
    assert(upErr, 'upload went through while closed')
    const { error } = await insertPhoto(anon, `${TOKEN}-closed`, G)
    assert(error && /Submissions are closed/i.test(error.message), `wrong error: ${error?.message}`)
  } finally {
    await setSettings({ submissions_open: true })
  }
})

await check('raising daily_limit to 5 allows 5 inserts and blocks the 6th', async () => {
  await setSettings({ daily_limit: 5 })
  try {
    const token = `${TOKEN}-five`
    for (let i = 0; i < 5; i++) {
      const { error } = await insertPhoto(anon, token, G, `${token}-${i}`)
      assert(!error, `insert ${i + 1} failed: ${error?.message}`)
    }
    const { error } = await insertPhoto(anon, token, G, `${token}-5`)
    assert(error && /Daily photo limit/i.test(error.message), `wrong error: ${error?.message}`)
  } finally {
    await setSettings({ daily_limit: 3 })
  }
})

await check('group mode on: unknown or missing group is rejected', async () => {
  const { error } = await insertPhoto(anon, `${TOKEN}-badgroup`, 'test-no-such-group')
  assert(error && /Invalid group/i.test(error.message), `wrong error: ${error?.message}`)
  const { error: nullErr } = await insertPhoto(anon, `${TOKEN}-nullgroup`, null)
  assert(nullErr && /Invalid group/i.test(nullErr.message), `wrong error: ${nullErr?.message}`)
})

await check('group mode off: row is stored with group_name NULL', async () => {
  await setSettings({ group_mode: false })
  try {
    const token = `${TOKEN}-nogroup`
    const { error } = await insertPhoto(anon, token, 'whatever')
    assert(!error, error?.message)
    const { data } = await service.from('photos').select('group_name').eq('client_token', token).single()
    assert(data.group_name === null, `group_name is ${data.group_name}`)
  } finally {
    await setSettings({ group_mode: true })
  }
})

// Role matrix -----------------------------------------------------------------

await makeUser(USERS.admin, 'admin')
await makeUser(USERS.organizer, 'organizer')
await makeUser(USERS.moderator, 'moderator')
await makeUser(USERS.outsider, null)
const unconfirmedId = await makeUser(USERS.unconfirmed, 'admin', false)

const admin = await signIn(USERS.admin)
const organizer = await signIn(USERS.organizer)
const moderator = await signIn(USERS.moderator)
const outsider = await signIn(USERS.outsider)
const unconfirmed =
  (await signIn(USERS.unconfirmed)) ??
  (jwtSecret ? clientWithMintedToken(unconfirmedId, USERS.unconfirmed) : null)

async function rankOf(client) {
  const { data, error } = await client.rpc('moderate_bootstrap')
  if (error) throw error
  return data.rank
}

async function assertNoAccess(client) {
  assert((await rankOf(client)) === 0, 'rank is not 0')
  const { data: rows } = await client.from('photos').select('id').eq('status', 'pending').like('client_token', 'test-%')
  assert(!rows || rows.length === 0, 'can read pending photos')
  const { error: dlErr } = await client.storage.from('pending').download(`${TOKEN}.jpg`)
  assert(dlErr, 'can read pending storage')
  const { data: upd } = await client.from('app_settings').update({ daily_limit: 50 }).eq('id', 1).select()
  assert(!upd || upd.length === 0, 'can update settings')
  const { data: staff } = await client.from('staff_users').select('email')
  assert(!staff || staff.length === 0, 'can read staff_users')
  const { error: mvErr } = await client.storage
    .from('pending')
    .move(`${TOKEN}.jpg`, `${FOLDER}/${TOKEN}-stolen.jpg`, { destinationBucket: 'approved' })
  assert(mvErr, 'can move pending → approved')
}

await check('signed-in user outside the allowlist has no staff access', () => assertNoAccess(outsider))

await check('unconfirmed user with an allowlisted email has no staff access', async () => {
  if (!unconfirmed) return 'skip' // sign-in refused and no JWT secret to mint a token
  await assertNoAccess(unconfirmed)
  // Sanity: the same account gets its role once the email is confirmed.
  await service.auth.admin.updateUserById(unconfirmedId, { email_confirm: true })
  assert((await rankOf(unconfirmed)) === 3, 'confirmed account did not get its role')
})

await check('bootstrap returns rank and settings for each role', async () => {
  assert((await rankOf(moderator)) === 1, 'moderator rank')
  assert((await rankOf(organizer)) === 2, 'organizer rank')
  assert((await rankOf(admin)) === 3, 'admin rank')
  const { data } = await moderator.rpc('moderate_bootstrap')
  assert(Array.isArray(data.settings.groups) && data.settings.daily_limit === 3, 'settings missing')
})

await check('moderator can read pending rows and files', async () => {
  const { data: rows, error } = await moderator.from('photos').select('id').eq('client_token', TOKEN)
  assert(!error && rows.length === 3, error?.message ?? `saw ${rows?.length} rows`)
  const { data, error: dlErr } = await moderator.storage.from('pending').download(`${TOKEN}.jpg`)
  assert(!dlErr && data?.size > 0, dlErr?.message ?? 'empty download')
})

await check('moderator can move pending → approved; the file leaves pending', async () => {
  const { error } = await moderator.storage
    .from('pending')
    .move(`${TOKEN}.jpg`, `${FOLDER}/${TOKEN}.jpg`, { destinationBucket: 'approved' })
  assert(!error, error?.message)
  const { data } = await service.storage.from('pending').list('', { search: `${TOKEN}.jpg` })
  assert(!data?.some((f) => f.name === `${TOKEN}.jpg`), 'original still in pending')
})

await check('approved photo is publicly fetchable without auth', async () => {
  const { data } = anon.storage.from('approved').getPublicUrl(`${FOLDER}/${TOKEN}.jpg`)
  const res = await fetch(data.publicUrl)
  assert(res.ok, `public fetch returned ${res.status}`)
})

await check('moderator can move approved → pending; the file is no longer public', async () => {
  const { error } = await moderator.storage
    .from('approved')
    .move(`${FOLDER}/${TOKEN}.jpg`, `${TOKEN}.jpg`, { destinationBucket: 'pending' })
  assert(!error, error?.message)
  const { data } = anon.storage.from('approved').getPublicUrl(`${FOLDER}/${TOKEN}.jpg`)
  const res = await fetch(data.publicUrl)
  assert(!res.ok, 'file still public after un-approve')
})

await check('moderator can update status but no other column', async () => {
  const path = `pending/${TOKEN}-1.jpg`
  const { data, error } = await moderator.from('photos').update({ status: 'rejected' }).eq('storage_path', path).select()
  assert(!error && data.length === 1, error?.message ?? 'status update affected no rows')
  const { error: colErr } = await moderator.from('photos').update({ group_name: groups.at(-1), client_token: 'test-x' }).eq('storage_path', path)
  assert(colErr, 'moderator changed a protected column')
})

await check('moderator cannot delete photos, pending files, update settings or read staff', async () => {
  const { data: del } = await moderator.from('photos').delete().eq('client_token', TOKEN).select()
  assert(!del || del.length === 0, 'moderator deleted photos')
  await moderator.storage.from('pending').remove([`${TOKEN}.jpg`])
  const { data: still } = await service.storage.from('pending').list('', { search: `${TOKEN}.jpg` })
  assert(still?.some((f) => f.name === `${TOKEN}.jpg`), 'moderator deleted a pending file')
  const { data: upd } = await moderator.from('app_settings').update({ daily_limit: 50 }).eq('id', 1).select()
  assert(!upd || upd.length === 0, 'moderator updated settings')
  const { data: staff } = await moderator.from('staff_users').select('email')
  assert(!staff || staff.length === 0, 'moderator read staff_users')
})

await check('organizer can moderate and update settings', async () => {
  const path = `pending/${TOKEN}-2.jpg`
  const { data: rows, error } = await organizer.from('photos').update({ status: 'rejected' }).eq('storage_path', path).select()
  assert(!error && rows.length === 1, error?.message ?? 'organizer could not moderate')
  const { data: before } = await service.from('app_settings').select('updated_at').eq('id', 1).single()
  const { data, error: setErr } = await organizer
    .from('app_settings')
    .update({ tagline_en: 'test tagline' })
    .eq('id', 1)
    .select()
    .single()
  assert(!setErr && data.tagline_en === 'test tagline', setErr?.message ?? 'settings not updated')
  assert(data.updated_by === USERS.organizer, `updated_by is ${data.updated_by}`)
  assert(data.updated_at !== before.updated_at, 'updated_at did not move')
})

await check('stale optimistic-concurrency update matches no rows', async () => {
  const { data } = await organizer
    .from('app_settings')
    .update({ tagline_en: 'stale write' })
    .eq('id', 1)
    .eq('updated_at', '2000-01-01T00:00:00+00:00')
    .select()
  assert(data.length === 0, 'stale update went through')
})

await check('recording a publish does not move updated_at', async () => {
  const { data: before } = await service.from('app_settings').select('updated_at').eq('id', 1).single()
  await setSettings({ last_publish_at: new Date().toISOString() })
  const { data: after } = await service.from('app_settings').select('updated_at').eq('id', 1).single()
  assert(after.updated_at === before.updated_at, 'updated_at moved')
})

await check('settings constraints reject out-of-range values', async () => {
  const { error } = await organizer.from('app_settings').update({ daily_limit: 0 }).eq('id', 1)
  assert(error, 'daily_limit 0 accepted')
  const { error: tagErr } = await organizer.from('app_settings').update({ tagline_hu: 'x'.repeat(121) }).eq('id', 1)
  assert(tagErr, 'overlong tagline accepted')
})

await check('organizer cannot read or write staff_users, nor delete photos', async () => {
  const { data: staff } = await organizer.from('staff_users').select('email')
  assert(!staff || staff.length === 0, 'organizer read staff_users')
  const { error } = await organizer.from('staff_users').insert({ email: 'test-x@crowdlens.local', role: 'admin' })
  assert(error, 'organizer inserted a staff row')
  const { data: del } = await organizer.from('photos').delete().eq('client_token', TOKEN).select()
  assert(!del || del.length === 0, 'organizer deleted photos')
})

await check('admin can create, change and remove staff users', async () => {
  const { data: list, error } = await admin.from('staff_users').select('email,role')
  assert(!error && list.some((s) => s.email === USERS.moderator), error?.message ?? 'list incomplete')
  const { error: insErr } = await admin.from('staff_users').insert({ email: USERS.outsider, role: 'moderator', created_by: USERS.admin })
  assert(!insErr, insErr?.message)
  assert((await rankOf(outsider)) === 1, 'new role did not apply without re-login')
  const { error: updErr } = await admin.from('staff_users').update({ role: 'organizer' }).eq('email', USERS.outsider)
  assert(!updErr, updErr?.message)
  assert((await rankOf(outsider)) === 2, 'role change did not apply')
  const { error: delErr } = await admin.from('staff_users').delete().eq('email', USERS.outsider)
  assert(!delErr, delErr?.message)
  assert((await rankOf(outsider)) === 0, 'removal did not revoke access')
})

await check('staff emails must be lowercase', async () => {
  const { error } = await admin.from('staff_users').insert({ email: 'Test-Upper@crowdlens.local', role: 'moderator' })
  assert(error, 'mixed-case email accepted')
})

await check('admin can delete photos and pending files', async () => {
  const { data, error } = await admin.from('photos').delete().eq('storage_path', `pending/${TOKEN}-2.jpg`).select()
  assert(!error && data.length === 1, error?.message ?? 'admin delete affected no rows')
  const { error: rmErr } = await admin.storage.from('pending').remove([`${TOKEN}.jpg`])
  assert(!rmErr, rmErr?.message)
  const { data: left } = await service.storage.from('pending').list('', { search: `${TOKEN}.jpg` })
  assert(!left?.some((f) => f.name === `${TOKEN}.jpg`), 'pending file still there')
})

await check('the last admin cannot be removed or demoted; a second admin lifts the guard', async () => {
  // The unconfirmed test account is allowlisted as admin too; drop it first.
  await service.from('staff_users').delete().eq('email', USERS.unconfirmed)
  const { data: admins } = await service.from('staff_users').select('email').eq('role', 'admin')
  if (admins.length !== 1) return 'skip' // real admins exist on this project
  const { error: delErr } = await admin.from('staff_users').delete().eq('email', USERS.admin)
  assert(delErr && /last admin/i.test(delErr.message), `delete: ${delErr?.message ?? 'went through'}`)
  const { error: demErr } = await admin.from('staff_users').update({ role: 'moderator' }).eq('email', USERS.admin)
  assert(demErr && /last admin/i.test(demErr.message), `demote: ${demErr?.message ?? 'went through'}`)

  await makeUser(USERS.admin2, 'admin')
  const { error: okErr } = await admin.from('staff_users').update({ role: 'moderator' }).eq('email', USERS.admin)
  assert(!okErr, okErr?.message)
  assert((await rankOf(admin)) === 1, 'demotion did not apply')
})

await restoreSettings()
await cleanup()

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`)
process.exit(failed ? 1 : 0)
