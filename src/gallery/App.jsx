import { useEffect, useRef, useState } from 'react'
import { GROUPS, GROUP_MODE, APPROVED_BUCKET } from '../lib/config.js'
import { t, getLang, setLang, LANGS } from '../lib/i18n.js'
import { supabase } from '../lib/supabase.js'
import './gallery.css'

function publicUrl(storagePath) {
  const path = storagePath.replace(/^approved\//, '')
  return supabase.storage.from(APPROVED_BUCKET).getPublicUrl(path).data.publicUrl
}

function displayGroupName(photo) {
  return photo.group_name ?? ''
}

function formatPhotoStamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${month}. ${day}. ${hours}:${minutes}`
}

export default function App() {
  const [lang, setLangState] = useState(getLang())
  const [group, setGroup] = useState('all')
  const [photos, setPhotos] = useState(null)
  const [lightbox, setLightbox] = useState(null) // index into photos
  const touchStart = useRef(null)
  const swiped = useRef(false)
  const tr = (key) => t(key, lang)

  const prev = () => setLightbox((i) => (i === null ? null : Math.max(0, i - 1)))
  const next = () =>
    setLightbox((i) => (i === null ? null : Math.min((photos?.length ?? 1) - 1, i + 1)))

  useEffect(() => {
    if (lightbox === null) return
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox === null, photos])

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

  useEffect(() => {
    let cancelled = false
    setPhotos(null)
    setLightbox(null)
    let query = supabase
      .from('photos')
      .select('id,group_name,storage_path,created_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
    if (GROUP_MODE && group !== 'all') query = query.eq('group_name', group)
    query.then(({ data }) => {
      if (!cancelled) setPhotos(data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [group])

  function switchLang(l) {
    setLang(l)
    setLangState(l)
  }

  return (
    <div className="gallery-body">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          <h1>{tr('appName')}</h1>
          <span className="sub">{tr('gallery')}</span>
        </div>
        <div className="lang-toggle" role="group" aria-label="language">
          {LANGS.map((l) => (
            <button
              key={l}
              className={l === lang ? 'active' : ''}
              onClick={() => switchLang(l)}
              aria-pressed={l === lang}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <a className="back-link" href="/">
        📸 {tr('backToCamera')}
      </a>

      {GROUP_MODE && (
        <select
          className="group-select"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          aria-label={tr('yourGroup')}
        >
          <option value="all">{tr('allGroups')}</option>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}

      {photos === null ? (
        <p className="empty">{tr('loading')}</p>
      ) : photos.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{tr('galleryEmpty')}</p>
          <p>{tr('galleryEmptyHint')}</p>
        </div>
      ) : (
        <ul className="photo-grid">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button className="thumb" onClick={() => setLightbox(i)}>
                <img src={publicUrl(p.storage_path)} alt={tr('photoAlt')} loading="lazy" />
              </button>
              <p className="photo-meta">
                <span>{formatPhotoStamp(p.created_at)}</span>
                {GROUP_MODE && <span>{displayGroupName(p)}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}

      {lightbox !== null && photos?.[lightbox] && (
        <div
          className="lightbox"
          role="dialog"
          onClick={() => {
            // A swipe shouldn't also close the lightbox.
            if (swiped.current) swiped.current = false
            else setLightbox(null)
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {lightbox > 0 && (
            <button
              className="nav prev"
              aria-label={tr('prevPhoto')}
              onClick={(e) => {
                e.stopPropagation()
                prev()
              }}
            >
              ‹
            </button>
          )}
          <img src={publicUrl(photos[lightbox].storage_path)} alt={tr('photoAlt')} />
          <p className="lightbox-meta">
            {GROUP_MODE && <span>{displayGroupName(photos[lightbox])}</span>}
            <span>{formatPhotoStamp(photos[lightbox].created_at)}</span>
          </p>
          {lightbox < photos.length - 1 && (
            <button
              className="nav next"
              aria-label={tr('nextPhoto')}
              onClick={(e) => {
                e.stopPropagation()
                next()
              }}
            >
              ›
            </button>
          )}
          <button className="close" aria-label={tr('close')}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
