import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { can, roleOf } from './roles.js'
import Login from './Login.jsx'
import NoAccess from './NoAccess.jsx'
import Queue from './Queue.jsx'
import Settings from './Settings.jsx'
import Users from './Users.jsx'
import OpenAppLink from './OpenAppLink.jsx'
import './moderate.css'

const VIEWS = [
  { key: 'photos', label: 'Photos', action: 'moderate' },
  { key: 'settings', label: 'Settings', action: 'settings' },
  { key: 'users', label: 'Users', action: 'users' },
]

function viewFromHash() {
  const key = window.location.hash.slice(1)
  return VIEWS.some((v) => v.key === key) ? key : 'photos'
}

function Shell({ email, rank, settings, onSettingsSaved }) {
  const [view, setView] = useState(viewFromHash)
  const allowed = VIEWS.filter((v) => can(rank, v.action))
  const forbidden = !allowed.some((v) => v.key === view)

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!forbidden) return
    window.history.replaceState(null, '', '#photos')
    setView('photos')
  }, [forbidden])

  const current = forbidden ? 'photos' : view

  return (
    <div className="shell">
      <header className="shell-bar">
        <span className="shell-brand">CrowdLens staff</span>
        <nav className="shell-nav" aria-label="Sections">
          {allowed.map((v) => (
            <a
              key={v.key}
              href={`#${v.key}`}
              className={v.key === current ? 'active' : ''}
              aria-current={v.key === current ? 'page' : undefined}
            >
              {v.label}
            </a>
          ))}
        </nav>
        <div className="shell-right">
          <OpenAppLink />
          <a className="shell-link" href="/gallery/" target="_blank" rel="noopener">
            Gallery
          </a>
          <span className="shell-user">
            {email} · {roleOf(rank)}
          </span>
          <button className="shell-signout" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {/* Stays mounted so switching views does not refetch the queue. */}
      <div hidden={current !== 'photos'}>
        <Queue groups={settings.groups} groupMode={settings.group_mode} />
      </div>
      {current === 'settings' && <Settings settings={settings} onSaved={onSettingsSaved} />}
      {current === 'users' && <Users myEmail={email} />}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [boot, setBoot] = useState(null) // { rank, settings } | { error }
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Keyed on the user id so token refreshes never refetch.
  const userId = session?.user?.id
  useEffect(() => {
    setBoot(null)
    if (!userId) return
    let cancelled = false
    supabase.rpc('moderate_bootstrap').then(({ data, error }) => {
      if (!cancelled) setBoot(error ? { error: error.message } : data)
    })
    return () => {
      cancelled = true
    }
  }, [userId, attempt])

  if (session === undefined) return null
  if (!session) return <Login />
  if (!boot) return <p className="empty">Loading…</p>
  if (boot.error) {
    return (
      <div className="login">
        <h1>CrowdLens Moderation</h1>
        <p className="error">Could not load your access: {boot.error}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
        <button type="button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    )
  }
  if (boot.rank === 0) return <NoAccess email={session.user.email} />

  return (
    <Shell
      email={session.user.email}
      rank={boot.rank}
      settings={boot.settings}
      onSettingsSaved={(row) => setBoot((b) => ({ ...b, settings: row }))}
    />
  )
}
