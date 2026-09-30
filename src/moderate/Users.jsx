import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { ROLES } from './roles.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Users({ myEmail }) {
  const me = myEmail.toLowerCase()
  const [users, setUsers] = useState(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('moderator')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('staff_users')
      .select('*')
      .order('created_at')
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        setUsers(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Runs one write; on success applies it to the local list (no refetch).
  async function run(request, apply) {
    setBusy(true)
    setError(null)
    const { data, error: err } = await request
    setBusy(false)
    if (err) {
      setError(err.message)
      return false
    }
    setUsers((prev) => apply(prev, data))
    return true
  }

  async function add(e) {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!EMAIL_RE.test(address)) {
      setError('Enter a valid email address.')
      return
    }
    const ok = await run(
      supabase
        .from('staff_users')
        .insert({ email: address, role, created_by: me })
        .select()
        .single(),
      (prev, row) => [...prev, row],
    )
    if (ok) setEmail('')
  }

  async function changeRole(user, newRole) {
    const ok = await run(
      supabase.from('staff_users').update({ role: newRole }).eq('email', user.email),
      (prev) => prev.map((u) => (u.email === user.email ? { ...u, role: newRole } : u)),
    )
    // My own permissions changed: start over with the new role.
    if (ok && user.email === me) window.location.reload()
  }

  async function remove(user) {
    if (!window.confirm(`Remove ${user.email} from the staff list?`)) return
    const ok = await run(
      supabase.from('staff_users').delete().eq('email', user.email),
      (prev) => prev.filter((u) => u.email !== user.email),
    )
    if (ok && user.email === me) window.location.reload()
  }

  return (
    <div className="users">
      <h1>Users</h1>
      <p className="banner info">
        They sign in with Google using this exact email. Changes apply on their next request — no
        re-login needed. Removing someone revokes access but does not delete their sign-in account.
      </p>

      {error && <p className="error">{error}</p>}

      {users === null ? (
        <p className="empty">Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <td>
                  {u.email} {u.email === me && <em>(you)</em>}
                </td>
                <td>
                  <select
                    value={u.role}
                    disabled={busy}
                    aria-label={`Role of ${u.email}`}
                    onChange={(e) => changeRole(u, e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" disabled={busy} onClick={() => remove(u)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="add-user" onSubmit={add}>
        <input
          type="email"
          placeholder="new.staff@example.com"
          aria-label="New staff email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select value={role} aria-label="New staff role" onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={busy}>
          Add user
        </button>
      </form>
    </div>
  )
}
