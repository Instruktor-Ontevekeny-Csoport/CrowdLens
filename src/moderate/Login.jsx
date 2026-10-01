import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import OpenAppLink from './OpenAppLink.jsx'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function signInWithGoogle() {
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/moderate/',
        queryParams: { prompt: 'select_account' },
      },
    })
    if (err) setError(err.message)
  }

  async function signIn(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setBusy(false)
  }

  return (
    <div className="login">
      <h1>CrowdLens Moderation</h1>
      <button type="button" className="google" onClick={signInWithGoogle}>
        Continue with Google
      </button>
      {error && <p className="error">{error}</p>}
      <details>
        <summary>Sign in with email &amp; password</summary>
        <form onSubmit={signIn}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </details>
      <OpenAppLink small />
    </div>
  )
}
