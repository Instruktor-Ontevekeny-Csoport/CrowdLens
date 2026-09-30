// Grants the admin role to the address in FIRST_ADMIN_EMAIL.
// Run once after applying the migrations:  npm run bootstrap-admin
// Reads FIRST_ADMIN_EMAIL, SUPABASE_SERVICE_ROLE_KEY and the Supabase URL
// (SUPABASE_URL or VITE_SUPABASE_URL) from the environment or .env.

import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const email = env.FIRST_ADMIN_EMAIL?.trim().toLowerCase()
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const url =
  env.SUPABASE_URL ??
  (env.VITE_SUPABASE_URL?.startsWith('http') ? env.VITE_SUPABASE_URL : 'http://127.0.0.1:54321')

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Set FIRST_ADMIN_EMAIL to the first admin’s email address.')
  process.exit(1)
}
if (!serviceKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (dashboard → Settings → API, or `supabase status`).')
  process.exit(1)
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } })
const { error } = await service
  .from('staff_users')
  .upsert({ email, role: 'admin', created_by: 'bootstrap' }, { onConflict: 'email' })
if (error) {
  console.error(`Could not add ${email} as admin on ${url}: ${error.message}`)
  process.exit(1)
}
console.log(`${email} is now an admin on ${url}.`)
