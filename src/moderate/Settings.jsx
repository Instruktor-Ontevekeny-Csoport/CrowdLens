import { useEffect, useState } from 'react'
import { SETTINGS_UPDATED_AT } from '../lib/config.js'
import { t, defaultNotice } from '../lib/i18n.js'
import { supabase } from '../lib/supabase.js'
import { parseGroups } from './parseGroups.js'

const PUBLISH_ENABLED = import.meta.env.VITE_ENABLE_PUBLISH === 'true'
const PUBLISH_COOLDOWN_MS = 60_000
const LANG_LABELS = { hu: 'Hungarian', en: 'English' }

function toForm(s) {
  return {
    submissions_open: s.submissions_open,
    daily_limit: String(s.daily_limit),
    tagline_hu: s.tagline_hu,
    tagline_en: s.tagline_en,
    notice_hu: s.notice_hu,
    notice_en: s.notice_en,
    group_mode: s.group_mode,
    groupsText: s.groups.join('\n'),
  }
}

function isPublished(settings) {
  return (
    Boolean(SETTINGS_UPDATED_AT) &&
    Date.parse(SETTINGS_UPDATED_AT) === Date.parse(settings.updated_at)
  )
}

function PublishStatus({ settings }) {
  const [state, setState] = useState('idle') // idle | busy | sent
  const [error, setError] = useState(null)

  useEffect(() => {
    if (state !== 'sent') return
    const timer = setTimeout(() => setState('idle'), PUBLISH_COOLDOWN_MS)
    return () => clearTimeout(timer)
  }, [state])

  if (isPublished(settings)) {
    return <p className="banner ok">Live site is up to date.</p>
  }

  async function publish() {
    setState('busy')
    setError(null)
    const { error: err } = await supabase.functions.invoke('publish-site')
    if (err) {
      setError(
        err.context?.status === 429
          ? 'A publish was started less than a minute ago — wait a moment.'
          : `Publish failed: ${err.message}`,
      )
      setState('idle')
      return
    }
    setState('sent')
  }

  return (
    <div className="banner warn">
      <strong>Unpublished changes.</strong>{' '}
      {PUBLISH_ENABLED ? (
        <>
          Participants see the saved texts and groups after the site is republished.{' '}
          <button type="button" onClick={publish} disabled={state !== 'idle'}>
            {state === 'busy' ? 'Publishing…' : 'Publish now'}
          </button>
          {state === 'sent' && (
            <span>
              {' '}
              Build takes ~1–2 min; the banner turns green after the new deployment loads
              /moderate/.
            </span>
          )}
        </>
      ) : (
        <>
          Redeploy the site so participants see the saved texts and groups (
          <code>npm run build</code>, then upload <code>dist/</code> — or trigger a deploy on your
          host).
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function Toggle({ label, checked, onChange, help }) {
  return (
    <label className="field toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        {help && <small>{help}</small>}
      </span>
    </label>
  )
}

export default function Settings({ settings, onSaved }) {
  const [form, setForm] = useState(() => toForm(settings))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 4000)
    return () => clearTimeout(timer)
  }, [saved])

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))
  const setText = (key) => (e) => set(key)(e.target.value)

  const limit = Number(form.daily_limit)
  const limitValid = /^\d+$/.test(form.daily_limit.trim()) && limit >= 1 && limit <= 50
  const { groups, errors: groupErrors } = parseGroups(form.groupsText)
  const errors = [
    ...(limitValid ? [] : ['Daily photo limit must be a whole number between 1 and 50.']),
    ...groupErrors,
    ...(form.group_mode && groups.length === 0
      ? ['Add at least one group, or turn group mode off.']
      : []),
  ]
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings))

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    const { groupsText, daily_limit, ...rest } = form
    const { data, error: err } = await supabase
      .from('app_settings')
      .update({ ...rest, daily_limit: limit, groups })
      .eq('id', 1)
      // Optimistic concurrency: matches nothing if someone else saved meanwhile.
      .eq('updated_at', settings.updated_at)
      .select()
      .maybeSingle()
    setBusy(false)
    if (err) {
      setError(err.message)
    } else if (!data) {
      setConflict(true)
    } else {
      setForm(toForm(data))
      setSaved(true)
      onSaved(data)
    }
  }

  return (
    <form className="settings" onSubmit={save}>
      <h1>Settings</h1>

      <p className="banner info">
        The submission switch, daily limit and group validity apply <strong>immediately</strong>{' '}
        on the server. Tagline, notice, group list, group mode — and re-opening closed
        submissions — are shown to participants after the site is republished. Change settings
        before the event and publish right after saving: a removed group is rejected by the server
        at once, while already-loaded pages list it until the republish finishes.
      </p>
      <PublishStatus settings={settings} />

      <Toggle
        label="Accept photo submissions"
        checked={form.submissions_open}
        onChange={set('submissions_open')}
        help="Off: uploads are refused right away; the gallery stays available."
      />

      <label className="field">
        <strong>Daily photo limit</strong>
        <input
          type="number"
          min="1"
          max="50"
          value={form.daily_limit}
          onChange={setText('daily_limit')}
        />
        <small>Photos per participant per day (1–50).</small>
      </label>

      <fieldset>
        <legend>Tagline</legend>
        {['hu', 'en'].map((lang) => (
          <label className="field" key={lang}>
            <span>{LANG_LABELS[lang]} tagline</span>
            <input
              type="text"
              maxLength={120}
              value={form[`tagline_${lang}`]}
              placeholder={t('tagline', lang)}
              onChange={setText(`tagline_${lang}`)}
            />
          </label>
        ))}
        <small>Leave empty to use the built-in tagline.</small>
      </fieldset>

      <fieldset>
        <legend>Important notice</legend>
        {['hu', 'en'].map((lang) => (
          <label className="field" key={lang}>
            <span>{LANG_LABELS[lang]} notice</span>
            <textarea
              rows={8}
              maxLength={4000}
              value={form[`notice_${lang}`]}
              placeholder={defaultNotice(lang, limitValid ? limit : settings.daily_limit)}
              onChange={setText(`notice_${lang}`)}
            />
          </label>
        ))}
        <small>
          Plain text only; leave empty to use the built-in notice. If you write a custom notice,
          mention the daily limit yourself.
        </small>
      </fieldset>

      <Toggle
        label="Group mode"
        checked={form.group_mode}
        onChange={set('group_mode')}
        help="Off: photos are collected without a group; the group picker disappears for participants and the gallery."
      />

      <label className="field">
        <strong>Groups ({groups.length})</strong>
        <textarea
          rows={12}
          value={form.groupsText}
          onChange={setText('groupsText')}
          disabled={!form.group_mode}
          aria-describedby="groups-help"
        />
        <small id="groups-help">One name per line.</small>
      </label>
      <p className="banner warn">
        Group names are stored on each photo. Renaming or removing a group does not migrate
        existing photos — they stay under the old name and remain visible under 'All groups'.
      </p>

      {errors.map((msg) => (
        <p className="error" key={msg}>
          {msg}
        </p>
      ))}
      {error && <p className="error">{error}</p>}
      {conflict && (
        <p className="error">
          Someone else changed the settings — reload.{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}

      <div className="save-row">
        <button type="submit" className="primary" disabled={busy || !dirty || errors.length > 0}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {saved && (
          <span className="toast" role="status">
            Settings saved ✓
          </span>
        )}
      </div>
    </form>
  )
}
