// Integration tests for the CrowdLens backend (trigger, RLS, storage policies).
// Run against the local stack:  npm run test:backend
// Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!anonKey || !serviceKey) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see `supabase status`).')
  process.exit(1)
}

const anon = createClient(url, anonKey)
const service = createClient(url, serviceKey)

const STAFF_EMAIL = 'staff-test@crowdlens.local'
const STAFF_PASSWORD = 'test-password-1234'
const TOKEN = `test-${Date.now()}`
const budapestToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Budapest',
}).format(new Date())

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
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

async function cleanup() {
  await service.from('photos').delete().like('client_token', 'test-%')
  for (const bucket of ['pending', 'approved']) {
    const { data } = await service.storage.from(bucket).list('', { limit: 100 })
    const testFiles = (data ?? []).filter((f) => f.name.startsWith('test-')).map((f) => f.name)
    const { data: grouped } = await service.storage.from(bucket).list('Group 1', { limit: 100 })
    const groupedFiles = (grouped ?? [])
      .filter((f) => f.name.startsWith('test-'))
      .map((f) => `Group 1/${f.name}`)
    const all = [...testFiles, ...groupedFiles]
    if (all.length) await service.storage.from(bucket).remove(all)
  }
}

await cleanup()

// Staff test user (idempotent).
{
  const { error } = await service.auth.admin.createUser({
    email: STAFF_EMAIL,
    password: STAFF_PASSWORD,
    email_confirm: true,
  })
  if (error && !/already/i.test(error.message)) throw error
}

await check('anon can insert 3 photos on one day', async () => {
  for (let i = 0; i < 3; i++) {
    const { error } = await anon.from('photos').insert({
      client_token: TOKEN,
      group_name: 'Group 1',
      storage_path: `pending/${TOKEN}-${i}.jpg`,
    })
    assert(!error, `insert ${i + 1} failed: ${error?.message}`)
  }
})

await check('4th insert is rejected by the daily-limit trigger', async () => {
  const { error } = await anon.from('photos').insert({
    client_token: TOKEN,
    group_name: 'Group 1',
    storage_path: `pending/${TOKEN}-3.jpg`,
  })
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
    group_name: 'Group 1',
    storage_path: `pending/${TOKEN}-b.jpg`,
    status: 'approved',
  })
  assert(error, 'RLS should reject status=approved from anon')
})

await check('anon cannot backdate submitted_date', async () => {
  const { error } = await anon.from('photos').insert({
    client_token: `${TOKEN}-c`,
    group_name: 'Group 1',
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

await check('a concurrent burst still allows exactly 3 inserts', async () => {
  const burstToken = `${TOKEN}-burst`
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      anon.from('photos').insert({
        client_token: burstToken,
        group_name: 'Group 1',
        storage_path: `pending/${burstToken}-${i}.jpg`,
      }),
    ),
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

const staff = createClient(url, anonKey)
await check('staff can sign in', async () => {
  const { error } = await staff.auth.signInWithPassword({
    email: STAFF_EMAIL,
    password: STAFF_PASSWORD,
  })
  assert(!error, error?.message)
})

await check('staff can read pending', async () => {
  const { data, error } = await staff.storage.from('pending').download(`${TOKEN}.jpg`)
  assert(!error && data?.size > 0, error?.message ?? 'empty download')
})

await check('staff can copy pending → approved bucket', async () => {
  const { error } = await staff.storage
    .from('pending')
    .copy(`${TOKEN}.jpg`, `Group 1/${TOKEN}.jpg`, { destinationBucket: 'approved' })
  assert(!error, error?.message)
})

await check('approved photo is publicly fetchable without auth', async () => {
  const { data } = anon.storage.from('approved').getPublicUrl(`Group 1/${TOKEN}.jpg`)
  const res = await fetch(data.publicUrl)
  assert(res.ok, `public fetch returned ${res.status}`)
})

await check('anon cannot write to approved bucket', async () => {
  const { error } = await anon.storage.from('approved').upload(`Group 1/${TOKEN}-evil.jpg`, jpegBlob())
  assert(error, 'anon write to approved should fail')
})

await cleanup()
await service.auth.admin
  .listUsers()
  .then(({ data }) => data.users.find((u) => u.email === STAFF_EMAIL))
  .then((u) => u && service.auth.admin.deleteUser(u.id))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
