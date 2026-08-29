import { createClient } from '@supabase/supabase-js'

// Accepts a full URL (production) or a path like /sb (dev proxy).
const raw = import.meta.env.VITE_SUPABASE_URL
const url = raw.startsWith('http') ? raw : new URL(raw, window.location.origin).href

export const supabase = createClient(url, import.meta.env.VITE_SUPABASE_ANON_KEY)
