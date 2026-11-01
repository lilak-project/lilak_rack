// The rack kit's words, in the shared dictionary (lilak-ui i18n). Every kit
// module that shows text imports this first, so its entries exist before any
// tr() call — including ones made while a service's definition is evaluated.
// Adding a language: add i18n/<lang>.js and list it here.
import { addStrings, currentLang, LANG_KEY } from '../i18n.jsx'
import { applyLangFont } from '../theme/applyTheme.js'
import ko from './i18n/ko.js'
import en from './i18n/en.js'

addStrings({ ko, en })

// A rack service shows the language the portal (or another tab) chose. Its
// field labels are read once, when the service's definition loads, so a change
// made elsewhere is followed by reading the page again.
if (typeof window !== 'undefined' && !window.__rackLangWatch) {
  window.__rackLangWatch = true
  document.documentElement.lang = currentLang()
  applyLangFont(currentLang())
  window.addEventListener('storage', (e) => {
    if (e.key === LANG_KEY && e.newValue && e.newValue !== document.documentElement.lang) window.location.reload()
  })
}
