import {
  GROUPS,
  DAILY_LIMIT,
  GROUP_MODE,
  SUBMISSIONS_OPEN,
  CUSTOM_TAGLINE,
  CUSTOM_NOTICE,
  SETTINGS_UPDATED_AT,
} from '../lib/config.js'

test('config sanity', () => {
  expect(GROUPS.length).toBeGreaterThan(0)
  expect(new Set(GROUPS).size).toBe(GROUPS.length)
  expect(Number.isInteger(DAILY_LIMIT)).toBe(true)
  expect(DAILY_LIMIT).toBeGreaterThan(0)
})

test('settings-backed exports have the expected types', () => {
  expect(typeof GROUP_MODE).toBe('boolean')
  expect(typeof SUBMISSIONS_OPEN).toBe('boolean')
  for (const lang of ['hu', 'en']) {
    expect(typeof CUSTOM_TAGLINE[lang]).toBe('string')
    expect(typeof CUSTOM_NOTICE[lang]).toBe('string')
  }
  expect(SETTINGS_UPDATED_AT === null || typeof SETTINGS_UPDATED_AT === 'string').toBe(true)
})
