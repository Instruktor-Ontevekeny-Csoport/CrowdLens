import { useCallback, useEffect, useRef, useState } from 'react'
import { GROUPS, PENDING_BUCKET, APPROVED_BUCKET } from '../lib/config.js'
import { supabase } from '../lib/supabase.js'
import './moderate.css'

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setBusy(false)
  }

  return (
    <form className="login" onSubmit={signIn}>
      <h1>CrowdLens Moderation</h1>
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
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

// The original upload always stays in the private bucket as {id}.jpg;
// approval copies it to approved/{group}/{id}.jpg without deleting it.
function baseFile(photo) {
  return photo.storage_path.split('/').pop()
}

function slugifyGroup(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function displayGroupName(photo) {
  return photo.group_name
}

function DecisionButtons({ photo, busy, onDecide, size = '' }) {
  return (
    <div className={`actions ${size}`}>
      {photo.status !== 'approved' && (
        <button className="approve" disabled={busy} onClick={() => onDecide(photo, 'approve')}>
          Approve
        </button>
      )}
      {photo.status !== 'rejected' && (
        <button className="reject" disabled={busy} onClick={() => onDecide(photo, 'reject')}>
          Reject
        </button>
      )}
    </div>
  )
}

function Queue() {
  const [tab, setTab] = useState('pending')
  const [photos, setPhotos] = useState([])
  const [urls, setUrls] = useState({})
  const [groupFilter, setGroupFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyIds, setBusyIds] = useState(new Set())
  const [lightboxIdx, setLightboxIdx] = useState(null) // index into `visible`
  const touchStart = useRef(null)
  const swiped = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLightboxIdx(null)
    const { data, error: err } = await supabase
      .from('photos')
      .select('*')
      .eq('status', tab)
      .order('created_at', { ascending: tab === 'pending' })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setPhotos(data)
    const map = {}
    if (tab === 'approved') {
      for (const p of data) {
        const path = p.storage_path.replace(/^approved\//, '')
        map[p.id] = supabase.storage.from(APPROVED_BUCKET).getPublicUrl(path).data.publicUrl
      }
    } else if (data.length) {
      const { data: signed } = await supabase.storage
        .from(PENDING_BUCKET)
        .createSignedUrls(data.map(baseFile), 3600)
      signed?.forEach((s, i) => {
        map[data[i].id] = s.signedUrl
      })
    }
    setUrls(map)
    setLoading(false)
  }, [tab])

  useEffect(() => {
    load()
  }, [load])

  function markBusy(id, on) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  async function decide(photo, action) {
    if (`${action}d` === photo.status || busyIds.has(photo.id)) return
    markBusy(photo.id, true)
    setError(null)
    try {
      let update
      if (action === 'approve') {
        const dest = `${slugifyGroup(photo.group_name)}/${baseFile(photo)}`
        const { error: cpErr } = await supabase.storage
          .from(PENDING_BUCKET)
          .copy(baseFile(photo), dest, { destinationBucket: APPROVED_BUCKET })
        // Duplicate: a previous half-finished approve already copied it.
        if (cpErr && !/exist|duplicate/i.test(cpErr.message)) throw cpErr
        update = { status: 'approved', storage_path: `approved/${dest}` }
      } else {
        if (photo.status === 'approved') {
          const { error: delErr } = await supabase.storage
            .from(APPROVED_BUCKET)
            .remove([photo.storage_path.replace(/^approved\//, '')])
          if (delErr) throw delErr
        }
        update = { status: 'rejected', storage_path: `pending/${baseFile(photo)}` }
      }
      const { error: dbErr } = await supabase.from('photos').update(update).eq('id', photo.id)
      if (dbErr) throw dbErr
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    } catch (e) {
      setError(`${action} failed: ${e.message}`)
    } finally {
      markBusy(photo.id, false)
    }
  }

  const dates = [...new Set(photos.map((p) => p.submitted_date))].sort()
  const visible = photos.filter(
    (p) =>
      (groupFilter === 'all' || p.group_name === groupFilter) &&
      (dateFilter === 'all' || p.submitted_date === dateFilter),
  )

  // Deciding removes the photo from the list; the same index then shows the
  // next one, clamped at the end, closing when nothing is left.
  const lbIndex =
    lightboxIdx === null || visible.length === 0
      ? null
      : Math.min(lightboxIdx, visible.length - 1)
  const lbPhoto = lbIndex === null ? null : visible[lbIndex]

  const prev = () => setLightboxIdx((i) => (i === null ? null : Math.max(0, lbIndex - 1)))
  const next = () =>
    setLightboxIdx((i) => (i === null ? null : Math.min(visible.length - 1, lbIndex + 1)))

  useEffect(() => {
    if (lbPhoto === null) return
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      const key = e.key.toLowerCase()
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'Escape') setLightboxIdx(null)
      else if (key === 'a' && lbPhoto.status !== 'approved') decide(lbPhoto, 'approve')
      else if (key === 'r' && lbPhoto.status !== 'rejected') decide(lbPhoto, 'reject')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function onTouchStart(e) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  function onTouchEnd(e) {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true
      dx < 0 ? next() : prev()
    }
  }

  return (
    <div className="queue">
      <header>
        <h1>
          {TABS.find((t) => t.key === tab).label} photos ({visible.length})
        </h1>
        <div className="controls">
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">All groups</option>
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            <option value="all">All days</option>
            {dates.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <button onClick={load}>Refresh</button>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={t.key === tab ? 'active' : ''}
            onClick={() => setTab(t.key)}
            aria-pressed={t.key === tab}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p className="empty">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="empty">{tab === 'pending' ? 'Queue is empty. 🎉' : 'Nothing here yet.'}</p>
      ) : (
        <ul className="grid">
          {visible.map((p, i) => (
            <li key={p.id} className="card">
              <button className="zoom" onClick={() => setLightboxIdx(i)} title="View full size">
                <img src={urls[p.id]} alt={`${p.status} from ${p.group_name}`} loading="lazy" />
              </button>
              <div className="meta">
                <span>{displayGroupName(p)}</span>
                <span>{new Date(p.created_at).toLocaleString()}</span>
              </div>
              <DecisionButtons photo={p} busy={busyIds.has(p.id)} onDecide={decide} />
            </li>
          ))}
        </ul>
      )}

      {lbPhoto && (
        <div
          className="lightbox"
          role="dialog"
          onClick={() => {
            if (swiped.current) swiped.current = false
            else setLightboxIdx(null)
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {lbIndex > 0 && (
            <button
              className="nav prev"
              aria-label="Previous photo"
              onClick={(e) => {
                e.stopPropagation()
                prev()
              }}
            >
              ‹
            </button>
          )}
          <img src={urls[lbPhoto.id]} alt={`${lbPhoto.status} from ${lbPhoto.group_name}`} />
          <div className="lightbox-meta">
            <span className="lightbox-group">{displayGroupName(lbPhoto)}</span>
            <span className="lightbox-date">{new Date(lbPhoto.created_at).toLocaleString()}</span>
          </div>
          {lbIndex < visible.length - 1 && (
            <button
              className="nav next"
              aria-label="Next photo"
              onClick={(e) => {
                e.stopPropagation()
                next()
              }}
            >
              ›
            </button>
          )}
          <div className="lightbox-bottom" onClick={(e) => e.stopPropagation()}>
            <DecisionButtons
              photo={lbPhoto}
              busy={busyIds.has(lbPhoto.id)}
              onDecide={decide}
              size="big"
            />
            <p className="hint">‹ › navigate · A approve · R reject · Esc close</p>
          </div>
          <button className="close" aria-label="Close">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  return session ? <Queue /> : <Login />
}
