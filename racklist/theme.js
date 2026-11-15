/**
 * Bright or dark: one choice for the whole site, NEON's pages and the rack's
 * alike. The portal keeps it on the account (prefs.theme) and writes it here,
 * in this origin's localStorage (`lilak.theme`), on sign-in and at its switch;
 * every open page follows the storage event. Dark puts
 * `data-lilak-theme="dark"` on <html>, which rack.css reads. (Behind the
 * portal the attribute is already there before the page draws: the proxy's
 * injected head script sets it.)
 */
export const THEME_KEY = 'lilak.theme'

const saved = () => {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'bright' } catch { return 'bright' }
}

export function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.lilakTheme = 'dark'
  else delete document.documentElement.dataset.lilakTheme
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === THEME_KEY) applyTheme(saved()) })
  applyTheme(saved())
}
