import { DEFAULTS } from './settings.defaults.js'

// Baked in at build time from the app_settings row (see vite.config.js);
// edited by organizers on /moderate/ and enforced server-side.
const settings = typeof __APP_SETTINGS__ !== 'undefined' ? __APP_SETTINGS__ : DEFAULTS

export const GROUPS = settings.groups
export const DAILY_LIMIT = settings.daily_limit
export const GROUP_MODE = settings.group_mode
export const SUBMISSIONS_OPEN = settings.submissions_open
export const CUSTOM_TAGLINE = { hu: settings.tagline_hu, en: settings.tagline_en }
export const CUSTOM_NOTICE = { hu: settings.notice_hu, en: settings.notice_en }
export const SETTINGS_UPDATED_AT = settings.updated_at

export const CAMP_TIMEZONE = 'Europe/Budapest'
export const PENDING_BUCKET = 'pending'
export const APPROVED_BUCKET = 'approved'
