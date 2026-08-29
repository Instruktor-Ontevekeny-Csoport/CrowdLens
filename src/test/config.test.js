import { GROUPS, DAILY_LIMIT } from '../lib/config.js'

test('config sanity', () => {
  expect(GROUPS.length).toBeGreaterThan(0)
  expect(new Set(GROUPS).size).toBe(GROUPS.length)
  expect(Number.isInteger(DAILY_LIMIT)).toBe(true)
  expect(DAILY_LIMIT).toBeGreaterThan(0)
})
