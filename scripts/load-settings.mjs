// Build-time loader for the app_settings row baked into the bundles.
import { DEFAULTS } from '../src/lib/settings.defaults.js'

export async function loadSettings({ url, anonKey, strict }) {
  try {
    if (!url || !anonKey) throw new Error('Supabase URL or anon key is not set')
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/app_settings?id=eq.1&select=*`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const [row] = await res.json()
    if (!row) throw new Error('app_settings row is missing')
    return row
  } catch (e) {
    if (strict) {
      throw new Error(
        `Could not load app settings from ${url}: ${e.message}. ` +
          'Set ALLOW_DEFAULT_SETTINGS=1 to build with the defaults anyway.',
      )
    }
    console.warn(`[settings] using built-in defaults (${e.message})`)
    return DEFAULTS
  }
}
