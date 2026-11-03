import './strings.js'
import { PORTAL_BASE, authHeaders } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'

/** The note service's own API — not rackstore's. The editor, the tools and
 *  the print page all talk to it through here. */
export const noteQ = (note) => (note ? `?note=${encodeURIComponent(note)}` : '')

/** A file's size, in the unit a person would say it in. */
export const kb = (b) => (b < 1024 ? `${b} B` : b < (1 << 20) ? `${Math.round(b / 1024)} KB`
  : `${(b / (1 << 20)).toFixed(1)} MB`)

// Each part on its own: a tex note's file is at a path (`img/fig1.png`) and
// the slashes are the URL's, not characters in a name.
export const fileSrc = (name, note) =>
  `${PORTAL_BASE}/api/file/${String(name).split('/').map(encodeURIComponent).join('/')}${noteQ(note)}`

/** A file dropped into a note: stored beside the notes, named back. Not `api`
 *  — a multipart body writes its own content type, boundary and all. */
export async function putFile(file, note, replace = false) {
  const form = new FormData()
  form.append('f', file)
  const r = await fetch(`${PORTAL_BASE}/api/file${noteQ(note)}${replace ? '&replace=1' : ''}`,
    { method: 'POST', headers: authHeaders(), body: form })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || tr("nt_upload_failed", r.status))
  return (await r.json()).name
}

/** A new tab for an address. `window.open` can be refused — a frame, a popup
 *  blocker, the portal's own proxy — and then a link clicked in the page's own
 *  name is not. The print page was opening nothing at all inside the portal. */
export function openTab(url) {
  const w = window.open(url, '_blank', 'noopener')
  if (w) return
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noreferrer noopener'
  document.body.append(a)
  a.click()
  a.remove()
}

export const api = (p, o) => fetch(`${PORTAL_BASE}/api${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(o?.headers || {}) },
})

export async function ask(p, o) {
  const r = await api(p, o)
  if (r.status === 409) return { conflict: true, body: await r.json() }
  if (!r.ok) throw new Error(`${o?.method || 'GET'} ${p} → ${r.status}`)
  return { body: await r.json() }
}
