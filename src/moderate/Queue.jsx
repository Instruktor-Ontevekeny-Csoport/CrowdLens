import { useCallback, useEffect, useRef, useState } from 'react'
import { PENDING_BUCKET, APPROVED_BUCKET } from '../lib/config.js'
import { supabase } from '../lib/supabase.js'

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

const UNGROUPED_FOLDER = 'ungrouped'

// A photo's file is always named {id}.jpg; approval moves it from the private
// bucket to approved/{group}/{id}.jpg, un-approving moves it back.
function baseFile(photo) {
  return photo.storage_path.split('/').pop()
}

function slugifyGroup(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function approvedFolder(photo) {
  return (photo.group_name && slugifyGroup(photo.group_name)) || UNGROUPED_FOLDER
}

function displayGroupName(photo) {
  return photo.group_name ?? 'No group'
}

async function moveFile(fromBucket, from, toBucket, to) {
  const { error } = await supabase.storage
    .from(fromBucket)
    .move(from, to, { destinationBucket: toBucket })
  return error
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

export default function Queue({ groups, groupMode }) {
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

  async function approveFile(photo) {
    const file = baseFile(photo)
    const dest = `${approvedFolder(photo)}/${file}`
    const mvErr = await moveFile(PENDING_BUCKET, file, APPROVED_BUCKET, dest)
    if (mvErr) {
      // A previous half-finished approve may already have moved it.
      const { data: exists } = await supabase.storage.from(APPROVED_BUCKET).exists(dest)
      if (!exists) throw mvErr
    }
    return {
      update: { status: 'approved', storage_path: `approved/${dest}` },
      undo: () => moveFile(APPROVED_BUCKET, dest, PENDING_BUCKET, file),
    }
  }

  async function rejectFile(photo) {
    const file = baseFile(photo)
    const update = { status: 'rejected', storage_path: `pending/${file}` }
    if (photo.status !== 'approved') return { update }

    const src = photo.storage_path.replace(/^approved\//, '')
    const mvErr = await moveFile(APPROVED_BUCKET, src, PENDING_BUCKET, file)
    if (!mvErr) return { update, undo: () => moveFile(PENDING_BUCKET, file, APPROVED_BUCKET, src) }
    // Photos approved before files were moved still have their original in
    // pending; only the public copy has to go.
    if (!/exist|duplicate/i.test(mvErr.message)) throw mvErr
    const { error: delErr } = await supabase.storage.from(APPROVED_BUCKET).remove([src])
    if (delErr) throw delErr
    return { update }
  }

  async function decide(photo, action) {
    if (`${action}d` === photo.status || busyIds.has(photo.id)) return
    markBusy(photo.id, true)
    setError(null)
    try {
      const { update, undo } = await (action === 'approve' ? approveFile(photo) : rejectFile(photo))
      const { error: dbErr } = await supabase.from('photos').update(update).eq('id', photo.id)
      if (dbErr) {
        await undo?.()
        throw dbErr
      }
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    } catch (e) {
      setError(`${action} failed: ${e.message}`)
    } finally {
      markBusy(photo.id, false)
    }
  }

  // Live groups plus any group still present on loaded photos, so photos of
  // renamed or removed groups stay filterable.
  const groupOptions = [...new Set([...groups, ...photos.map((p) => p.group_name).filter(Boolean)])]
  const activeGroup = groupMode ? groupFilter : 'all'
  const dates = [...new Set(photos.map((p) => p.submitted_date))].sort()
  const visible = photos.filter(
    (p) =>
      (activeGroup === 'all' || p.group_name === activeGroup) &&
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
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
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
          {groupMode && (
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="all">All groups</option>
              {groupOptions.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          )}
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            <option value="all">All days</option>
            {dates.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <button onClick={load}>Refresh</button>
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
                <img src={urls[p.id]} alt={`${p.status} from ${displayGroupName(p)}`} loading="lazy" />
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
          <img src={urls[lbPhoto.id]} alt={`${lbPhoto.status} from ${displayGroupName(lbPhoto)}`} />
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
