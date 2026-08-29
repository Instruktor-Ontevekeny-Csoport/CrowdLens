import { storageGet, storageSet } from './storage.js'
import { DAILY_LIMIT } from './config.js'
import { randomUUID } from './uuid.js'

const TOKEN_KEY = 'cl_token'
const GROUP_KEY = 'cl_group'
const COUNT_KEY = 'cl_count'
const DATE_KEY = 'cl_date'

export function getClientToken() {
  let token = storageGet(TOKEN_KEY)
  if (!token) {
    token = randomUUID()
    storageSet(TOKEN_KEY, token)
  }
  return token
}

// Local calendar date as YYYY-MM-DD; participants' phones are in camp timezone.
export function localDateString(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getTodayCount(now = new Date()) {
  if (storageGet(DATE_KEY) !== localDateString(now)) return 0
  const n = parseInt(storageGet(COUNT_KEY) ?? '0', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function incrementTodayCount(now = new Date()) {
  const next = getTodayCount(now) + 1
  storageSet(DATE_KEY, localDateString(now))
  storageSet(COUNT_KEY, String(next))
  return next
}

export function remainingToday(now = new Date()) {
  return Math.max(0, DAILY_LIMIT - getTodayCount(now))
}

export function getLastGroup() {
  return storageGet(GROUP_KEY)
}

export function setLastGroup(group) {
  storageSet(GROUP_KEY, group)
}
