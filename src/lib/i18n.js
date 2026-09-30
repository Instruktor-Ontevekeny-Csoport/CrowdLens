import { storageGet, storageSet } from './storage.js'
import { CUSTOM_TAGLINE, CUSTOM_NOTICE, DAILY_LIMIT } from './config.js'

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
    consent: 'A fotó feltöltésével tudomásul veszed, hogy az általad feltöltött képet a Gólyatábor szervezői a közzététel előtt ellenőrzik. A szervezők fenntartják a jogot, hogy a nem megfelelő, mások személyiségi jogait sértő, kompromittáló vagy a Gólyatábor szellemiségével és a Semmelweis Egyetem etikai kódexével össze nem egyeztethető képeket töröljék.\n' +
        '\n' +
        'A feltöltött képek a Gólyatáborral kapcsolatos kommunikációs felületeken – így különösen a közösségi médiában és egyéb hivatalos felületeken – közzétételre kerülhetnek.\n' +
        '\n' +
        'A fotó feltöltésével kijelented, hogy a kép feltöltésére jogosult vagy, és annak feltöltésével, valamint a fentiek szerinti felhasználásával kapcsolatban harmadik személy jogát nem sérted.',
    dailyLimitLine: 'Naponta legfeljebb {n} képet tölthetsz fel.',
    submissionsClosed: 'A képbeküldés jelenleg zárva van. 🔒',
    submissionsClosedHint: 'A galériát továbbra is megnézheted.',
    groupInvalid: 'Ez a csapat már nem választható. Frissítsd az oldalt, és válassz újra!',
    noticeLink: 'Fontos információ',
    importantNotice: 'Fontos információ',
    officialPhotos: 'Kövesd a MAKI-t a hivatalos fotókért',
    orgName: 'MAKI',
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
    consent: 'By uploading a photo, you acknowledge that the photo you upload will be reviewed by the Freshman Camp organizers before it is published. The organizers reserve the right to delete any inappropriate photos, including those that violate the personal rights of others, are compromising or humiliating, or are inconsistent with the spirit of the Freshman Camp or the Code of Ethics of Semmelweis University.\n' +
        '\n' +
        'Uploaded photos may be published on communication channels related to the Freshman Camp, including, in particular, social media platforms and other official channels.\n' +
        '\n' +
        'By uploading a photo, you declare that you are authorized to upload the photo and that its upload and use as described above do not infringe upon the rights of any third party.',
    dailyLimitLine: 'You may upload a maximum of {n} photos per day.',
    submissionsClosed: 'Photo submissions are closed right now. 🔒',
    submissionsClosedHint: 'You can still browse the gallery.',
    groupInvalid: 'This group is no longer available. Refresh the page and pick again!',
    noticeLink: 'Important notice',
    importantNotice: 'Important notice',
    officialPhotos: 'Follow MAKI for the official photos',
    orgName: 'MAKI',
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

// Organizer-defined texts override the built-in ones when non-empty.
export function getTagline(lang = getLang()) {
  return CUSTOM_TAGLINE[lang] || t('tagline', lang)
}

export function defaultNotice(lang = getLang(), limit = DAILY_LIMIT) {
  return `${t('consent', lang)}\n\n${t('dailyLimitLine', lang).replace('{n}', limit)}`
}

export function getNotice(lang = getLang()) {
  return CUSTOM_NOTICE[lang] || defaultNotice(lang)
}

// Exposed for the completeness test.
export const _tables = strings
