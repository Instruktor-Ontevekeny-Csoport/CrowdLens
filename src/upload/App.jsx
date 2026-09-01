import { useRef, useState } from 'react'
import { Analytics } from "@vercel/analytics/next"
import { FaInstagram, FaFacebookF, FaInfoCircle } from 'react-icons/fa'
import { GROUPS, DAILY_LIMIT, PENDING_BUCKET } from '../lib/config.js'
import { t, getLang, setLang, LANGS } from '../lib/i18n.js'
import {
  getClientToken,
  getTodayCount,
  incrementTodayCount,
  remainingToday,
  getLastGroup,
  setLastGroup,
} from '../lib/identity.js'
import { compressImage } from '../lib/image.js'
import { randomUUID } from '../lib/uuid.js'
import { supabase } from '../lib/supabase.js'
import './upload.css'

export default function App() {
  const [lang, setLangState] = useState(getLang())
  const [group, setGroup] = useState(getLastGroup() ?? '')
  const [used, setUsed] = useState(getTodayCount())
  const [photo, setPhoto] = useState(null) // { blob, previewUrl }
  const [phase, setPhase] = useState('idle') // idle | preview | sending | success
  const [error, setError] = useState(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)

  const remaining = remainingToday()
  const tr = (key) => t(key, lang)

  function switchLang(l) {
    setLang(l)
    setLangState(l)
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      const blob = await compressImage(file)
      setPhoto({ blob, previewUrl: URL.createObjectURL(blob) })
      setPhase('preview')
    } catch (err) {
      // Failures here are always about the file, never the network.
      console.error('photo decode/compress failed:', err)
      setError(tr('notAnImage'))
    }
  }

  function discardPhoto() {
    if (photo) URL.revokeObjectURL(photo.previewUrl)
    setPhoto(null)
    setPhase('idle')
    setError(null)
  }

  async function submit() {
    if (!photo || !group) return
    setPhase('sending')
    setError(null)
    try {
      if (!photo.path) {
        photo.path = `${randomUUID()}.jpg`
      }
      const { error: upErr } = await supabase.storage
        .from(PENDING_BUCKET)
        .upload(photo.path, photo.blob, { contentType: 'image/jpeg' })
      // A duplicate means a previous retry already uploaded this photo.
      if (upErr && !/exist|duplicate/i.test(upErr.message)) throw upErr

      const { error: dbErr } = await supabase.from('photos').insert({
        client_token: getClientToken(),
        group_name: group,
        storage_path: `${PENDING_BUCKET}/${photo.path}`,
      })
      if (dbErr) {
        if (/daily photo limit/i.test(dbErr.message)) {
          while (getTodayCount() < DAILY_LIMIT) incrementTodayCount()
          setUsed(getTodayCount())
          discardPhoto()
          setError(tr('limitReachedServer'))
          return
        }
        throw dbErr
      }

      setUsed(incrementTodayCount())
      setLastGroup(group)
      URL.revokeObjectURL(photo.previewUrl)
      setPhoto(null)
      setPhase('success')
    } catch (err) {
      console.error('upload failed:', err)
      setError(tr('uploadError'))
      setPhase('preview')
    }
  }

  const filmFull = remaining <= 0 && phase !== 'sending'

  return (
    <>
      <Analytics />
      <div className="camera-body">
        <header className="top-bar">
          <div className="brand">
            <span className="brand-dot" aria-hidden="true" />
            <h1>{tr('appName')}</h1>
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

        <p className="tagline">{tr('tagline')}</p>

        <div className="counter-window" aria-label={tr('shotsLeft')}>
          <div className="frames">
            {Array.from({ length: DAILY_LIMIT }, (_, i) => (
              <span key={i} className={`frame ${i < used ? 'used' : ''}`} aria-hidden="true" />
            ))}
          </div>
          <span className="counter-text">
            {remaining} {tr('shotsLeft')}
          </span>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {filmFull && phase !== 'preview' ? (
          <div className="film-full">
            <p className="film-full-title">{tr('filmFull')}</p>
            <p>{tr('filmFullHint')}</p>
          </div>
        ) : phase === 'idle' || phase === 'success' ? (
          <main className="shoot-area">
            {phase === 'success' && (
              <div className="success" role="status">
                <p className="success-title">{tr('uploadSuccess')}</p>
                <p>{tr('uploadSuccessHint')}</p>
              </div>
            )}
            <label className="group-label">
              {tr('yourGroup')}
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="" disabled>
                  {tr('chooseGroup')}
                </option>
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFileSelected}
              hidden
            />
            <input ref={galleryRef} type="file" accept="image/*" onChange={onFileSelected} hidden />

            <button className="shutter" onClick={() => cameraRef.current.click()} disabled={!group}>
              <span className="shutter-ring">
                <span className="shutter-core" />
              </span>
              {tr('takePhoto')}
            </button>
            <button className="gallery-pick" onClick={() => galleryRef.current.click()} disabled={!group}>
              {tr('pickFromGallery')}
            </button>
          </main>
        ) : (
          <main className="preview-area">
            <div className="viewfinder">
              <img src={photo?.previewUrl} alt="" />
            </div>
            <div className="preview-actions">
              <button className="secondary" onClick={discardPhoto} disabled={phase === 'sending'}>
                {tr('cancel')}
              </button>
              <button className="primary" onClick={submit} disabled={phase === 'sending' || !group}>
                {phase === 'sending' ? tr('sending') : error ? tr('retry') : tr('send')}
              </button>
            </div>
          </main>
        )}

        <a className="gallery-link" href="/gallery/">
          🎞️ {tr('openGallery')}
        </a>

        <footer className="footer-block">
          <button type="button" className="consent-link" onClick={() => setNoticeOpen(true)}>
            <FaInfoCircle aria-hidden="true" />
            {tr('noticeLink')}
          </button>

          <div className="footer-logos" aria-label="Organizations">
            <img className="org-logo iocs" src="/logos/iocs_white.png" alt="IÖCS logo" />
            <img className="org-logo maki" src="/logos/makilogo.svg" alt="MAKI logo" />
          </div>

          <div className="footer-follow" aria-label="Follow us">
            <span className="follow-text">{tr('officialPhotos')}</span>
            <div className="social-links">
              <a href="https://www.instagram.com/" target="_blank" rel="noreferrer" aria-label="Instagram">
                <FaInstagram />
              </a>
              <a href="https://www.facebook.com/" target="_blank" rel="noreferrer" aria-label="Facebook">
                <FaFacebookF />
              </a>
            </div>
          </div>
        </footer>

        {noticeOpen && (
          <div className="notice-backdrop" onClick={() => setNoticeOpen(false)}>
            <div className="notice-modal" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="notice-close" onClick={() => setNoticeOpen(false)} aria-label={tr('close')}>
                ×
              </button>

              <h2>{tr('importantNotice')}</h2>
              <p className="notice-text">{tr('consent')}</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
