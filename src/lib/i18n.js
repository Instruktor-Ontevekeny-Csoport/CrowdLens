import { storageGet, storageSet } from './storage.js'

const LANG_KEY = 'cl_lang'

export const LANGS = ['hu', 'en']

const strings = {
  hu: {
    appName: 'CrowdLens',
    tagline: 'A tábor eldobható fényképezőgépe',
    takePhoto: 'Fotózz!',
    pickFromGallery: 'Kép feltöltése',
    yourGroup: 'Csapatod',
    chooseGroup: 'Válassz csapatot…',
    shotsLeft: 'kép maradt mára',
    shotsUsed: 'Elhasznált képek',
    filmFull: 'Mára betelt a film! 🎞️',
    filmFullHint: 'Gyere vissza holnap új tekercsért.',
    send: 'Küldés',
    cancel: 'Mégse',
    sending: 'Küldés…',
    retry: 'Újra',
    uploadSuccess: 'Kép elküldve! 📸',
    uploadSuccessHint: 'Jóváhagyás után megjelenik a galériában.',
    uploadError: 'A feltöltés nem sikerült. Ellenőrizd a netet és próbáld újra!',
    limitReachedServer: 'Elérted a napi limitet.',
    notAnImage: 'Ez nem képfájl — válassz fotót!',
    consent: 'A beküldött fotókat a tábor galériájában és az aftermovie-ban használjuk fel. Beküldéssel ehhez hozzájárulsz. A fotókat a tábor után töröljük.',
    gallery: 'Galéria',
    openGallery: 'Galéria megtekintése',
    backToCamera: 'Vissza a kamerához',
    allGroups: 'Minden csapat',
    galleryEmpty: 'Itt még nincs előhívott kép.',
    galleryEmptyHint: 'A jóváhagyott fotók itt jelennek meg.',
    loading: 'Betöltés…',
    close: 'Bezárás',
    prevPhoto: 'Előző kép',
    nextPhoto: 'Következő kép',
    photoAlt: 'táborfotó',
  },
  en: {
    appName: 'CrowdLens',
    tagline: 'The camp’s disposable camera',
    takePhoto: 'Take a photo!',
    pickFromGallery: 'Upload photo',
    yourGroup: 'Your group',
    chooseGroup: 'Choose a group…',
    shotsLeft: 'shots left today',
    shotsUsed: 'Shots used',
    filmFull: 'Film is full for today! 🎞️',
    filmFullHint: 'Come back tomorrow for a fresh roll.',
    send: 'Send',
    cancel: 'Cancel',
    sending: 'Sending…',
    retry: 'Retry',
    uploadSuccess: 'Photo sent! 📸',
    uploadSuccessHint: 'It will appear in the gallery once approved.',
    uploadError: 'Upload failed. Check your connection and try again!',
    limitReachedServer: 'You’ve reached the daily limit.',
    notAnImage: 'That’s not an image file — pick a photo!',
    consent: 'Submitted photos are used in the camp gallery and the aftermovie. By submitting you consent to this. Photos are deleted after the camp.',
    gallery: 'Gallery',
    openGallery: 'View the gallery',
    backToCamera: 'Back to the camera',
    allGroups: 'All groups',
    galleryEmpty: 'No developed photos here yet.',
    galleryEmptyHint: 'Approved photos will show up here.',
    loading: 'Loading…',
    close: 'Close',
    prevPhoto: 'Previous photo',
    nextPhoto: 'Next photo',
    photoAlt: 'camp photo',
  },
}

export function getLang() {
  const stored = storageGet(LANG_KEY)
  return LANGS.includes(stored) ? stored : 'hu'
}

export function setLang(lang) {
  if (LANGS.includes(lang)) storageSet(LANG_KEY, lang)
}

export function t(key, lang = getLang()) {
  return strings[lang]?.[key] ?? strings.hu[key] ?? key
}

// Exposed for the completeness test.
export const _tables = strings
