// Triggers a redeploy of the site through the host's deploy hook.
// Secrets: DEPLOY_HOOK_URL (required), SITE_ORIGIN (optional CORS origin, default *).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MIN_INTERVAL_MS = 60_000

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('SITE_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const hookUrl = Deno.env.get('DEPLOY_HOOK_URL')
  if (!hookUrl) return json(500, { error: 'DEPLOY_HOOK_URL is not configured' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: rank, error: rankErr } = await caller.rpc('staff_rank')
  if (rankErr || rank < 2) return json(403, { error: 'Organizer or admin role required' })

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: settings, error: readErr } = await admin
    .from('app_settings')
    .select('last_publish_at')
    .eq('id', 1)
    .single()
  if (readErr) return json(500, { error: readErr.message })
  if (
    settings.last_publish_at &&
    Date.now() - Date.parse(settings.last_publish_at) < MIN_INTERVAL_MS
  ) {
    return json(429, { error: 'A publish was started less than a minute ago' })
  }

  const hook = await fetch(hookUrl, { method: 'POST' })
  if (!hook.ok) return json(502, { error: `Deploy hook returned ${hook.status}` })

  const { error: writeErr } = await admin
    .from('app_settings')
    .update({ last_publish_at: new Date().toISOString() })
    .eq('id', 1)
  if (writeErr) return json(500, { error: writeErr.message })

  return json(200, { ok: true })
})
