/**
 * Portal plumbing for a rack-list service: who you are, and the one document.
 *
 * Every one of these services is a single version-guarded JSON document behind
 * the portal's proxy, so the fetching, the token reading and the per-project
 * localStorage keys are the same code with a different service name.
 */
const BASE = (typeof window !== 'undefined' && window.__PORTAL_BASE__) || ''
const PARTS = BASE.split('/').filter(Boolean)

export const PORTAL_BASE = BASE
/** The project the portal opened: the last part of /pp/<svc>/<proj>/. */
export const PORTAL_PROJECT = PARTS.length ? PARTS[PARTS.length - 1] : ''

/** What the portal injected about this service: the colour on its card, its
 *  label, the project it was opened for. Empty when the app is opened outside
 *  the portal — the nameplate then keeps the plain RACK grey. */
export const PORTAL_SERVICE = (typeof window !== 'undefined' && window.__PORTAL_SERVICE__) || {}

/** Readable text on a given plate. Luminance, not a guess: a service may be
 *  painted anything from #f3e5bb to #3d5a80. */
export function onColor(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return ''
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.5 ? '#0f172a' : '#ffffff'
}

/** The two variables a rack-list app puts on its root so the nameplate wears
 *  the service's own colour. Spread into a style prop. */
export const brandStyle = (color = PORTAL_SERVICE.color) => (color
  ? { '--rk-brand': color, '--rk-brand-t': onColor(color) } : {})

export const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
export const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }
/** Per-service, per-project key: two services in one browser never collide. */
export const projectKey = (svc, what) => `${svc}.${what}.${PORTAL_PROJECT}`

export function portalToken() {
  try { return localStorage.getItem('lilak_portal_token') || localStorage.getItem('elog_token') || '' }
  catch { return '' }
}
export const authHeaders = () => (portalToken() ? { Authorization: `Bearer ${portalToken()}` } : {})

/** The portal's own token says who this is; deleting is a manager's job. */
export function portalUser() {
  try {
    const t = portalToken()
    if (!t) return null
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return { email: p.email || p.username || '', role: String(p.role || p.prole || '') }
  } catch { return null }
}
export const isManager = () => ['manager', 'admin'].includes((portalUser()?.role || '').toLowerCase())

export const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

export async function fetchDoc() {
  const r = await fetch(`${BASE}/api/data`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`GET /api/data → ${r.status}`)
  return r.json()
}
/** Whole-document save, version-guarded: 409 means someone else got there first. */
export async function putDoc(baseVersion, body) {
  const r = await fetch(`${BASE}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ baseVersion, ...body }),
  })
  // A conflict hands back the document that won, so the caller can take it
  // and let the edit be saved again rather than die with it.
  if (r.status === 409) return { conflict: true, doc: (await r.json()).current }
  if (!r.ok) throw new Error(`PUT /api/data → ${r.status}`)
  return { doc: await r.json() }
}

/** Another service's colour, from the portal's list of services ('' when it
 *  is not known) — a tab of that service's page wears it. */
let SERVICES = null
export function serviceColor(name) {
  SERVICES ||= fetch('/api/services', { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : [])).catch(() => [])
  return SERVICES.then((l) => ((Array.isArray(l) ? l : l?.services || []).find((s) => s.name === name) || {}).color || '')
}

/** Open a record in ANOTHER service. Inside the portal's panel the portal is
 *  asked to switch to that service and hand it the record; on a page of its
 *  own, the browser goes there. The service opened reads `#open=<id>`. */
export function openInService(svc, proj, id) {
  const msg = { type: 'lilak:open', svc, proj, id }
  if (typeof window === 'undefined') return
  if (window.parent && window.parent !== window) { window.parent.postMessage(msg, window.location.origin); return }
  window.location.href = `/pp/${svc}/${proj}/#open=${encodeURIComponent(id)}`
}
/** The record this page was asked to open, if any (and the ask is consumed). */
export function takeOpenRequest() {
  if (typeof window === 'undefined') return ''
  const m = /#open=([^&]+)/.exec(window.location.hash || '')
  if (!m) return ''
  try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* fine */ }
  return decodeURIComponent(m[1])
}
