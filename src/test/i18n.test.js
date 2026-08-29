import { beforeEach } from 'vitest'
import { t, getLang, setLang, _tables, LANGS } from '../lib/i18n.js'

beforeEach(() => {
  localStorage.clear()
  document.cookie.split(';').forEach((c) => {
    const key = c.split('=')[0].trim()
    if (key) document.cookie = `${key}=; path=/; max-age=0`
  })
})

test('defaults to Hungarian', () => {
  expect(getLang()).toBe('hu')
  expect(t('takePhoto')).toBe('Fotózz!')
})

test('language toggle persists', () => {
  setLang('en')
  expect(getLang()).toBe('en')
  expect(t('takePhoto')).toBe('Take a photo!')
})

test('invalid language is ignored', () => {
  setLang('de')
  expect(getLang()).toBe('hu')
})

test('missing key falls back to Hungarian, then key itself', () => {
  expect(t('nonexistent-key')).toBe('nonexistent-key')
})

test('hu and en tables have identical keys', () => {
  const [hu, en] = LANGS.map((l) => Object.keys(_tables[l]).sort())
  expect(en).toEqual(hu)
})
