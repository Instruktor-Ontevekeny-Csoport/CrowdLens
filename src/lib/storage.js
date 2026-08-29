// localStorage with a cookie fallback for browsers that block it.

function cookieGet(key) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function cookieSet(key, value) {
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`
}

export function storageGet(key) {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    /* blocked */
  }
  try {
    return cookieGet(key)
  } catch {
    return null
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* blocked */
  }
  try {
    cookieSet(key, value)
  } catch {
    /* blocked */
  }
}
