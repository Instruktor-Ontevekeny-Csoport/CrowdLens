import { beforeEach } from 'vitest'
import {
  getClientToken,
  localDateString,
  getTodayCount,
  incrementTodayCount,
  remainingToday,
  getLastGroup,
  setLastGroup,
} from '../lib/identity.js'
import { DAILY_LIMIT } from '../lib/config.js'

beforeEach(() => {
  localStorage.clear()
  document.cookie.split(';').forEach((c) => {
    const key = c.split('=')[0].trim()
    if (key) document.cookie = `${key}=; path=/; max-age=0`
  })
})

test('client token is a UUID and stable across calls', () => {
  const token = getClientToken()
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
  expect(getClientToken()).toBe(token)
})

test('token survives localStorage loss via cookie fallback', () => {
  const token = getClientToken()
  localStorage.clear()
  expect(getClientToken()).toBe(token)
})

test('counter starts at zero and increments', () => {
  expect(getTodayCount()).toBe(0)
  incrementTodayCount()
  incrementTodayCount()
  expect(getTodayCount()).toBe(2)
  expect(remainingToday()).toBe(DAILY_LIMIT - 2)
})

test('counter resets when the local date changes', () => {
  const today = new Date('2026-08-28T20:00:00')
  const tomorrow = new Date('2026-08-29T08:00:00')
  incrementTodayCount(today)
  incrementTodayCount(today)
  expect(getTodayCount(today)).toBe(2)
  expect(getTodayCount(tomorrow)).toBe(0)
  incrementTodayCount(tomorrow)
  expect(getTodayCount(tomorrow)).toBe(1)
})

test('corrupt counter value reads as zero', () => {
  localStorage.setItem('cl_date', localDateString())
  localStorage.setItem('cl_count', 'garbage')
  expect(getTodayCount()).toBe(0)
})

test('last group persists', () => {
  expect(getLastGroup()).toBeNull()
  setLastGroup('Group 3')
  expect(getLastGroup()).toBe('Group 3')
})
