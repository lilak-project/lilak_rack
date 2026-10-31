/** Tags shared across services.
 *
 * Every service that says so in its manifest (`capabilities.tags`) answers
 * GET /api/tags on its entry project with the tags its records wear and how
 * many wear each — the rack services from their `tags` field, note from the
 * `#tags` in its bodies. A tag box anywhere offers all of them, so a tag
 * typed in one service is the same tag in the others.
 *
 * A tag is the same tag whatever its case (`spirit` is `SpiRIT`): the name
 * shown for it is the spelling used most, and a tag typed is stored in that
 * spelling when one is already in use. Each service keeps its own records;
 * this only ever reads the others.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authHeaders } from './portal.js'

export const tagKey = (t) => String(t ?? '').trim().toLowerCase()

/** { name: count, … } from several places → [{ name, count }], one per tag
 *  whatever its case, named by its commonest spelling, most worn first. */
export function mergeTags(counts) {
  const by = new Map()
  for (const c of counts) {
    for (const [t, n] of Object.entries(c || {})) {
      const k = tagKey(t)
      if (!k) continue
      const e = by.get(k) || { count: 0, spell: new Map() }
      e.count += n
      e.spell.set(t.trim(), (e.spell.get(t.trim()) || 0) + n)
      by.set(k, e)
    }
  }
  return [...by.values()].map((e) => ({
    name: [...e.spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    count: e.count,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))
}

let asked = null
/** Every sharing service's tags, asked once per page: [{ svc, label, color,
 *  tags: { name: count } }]. */
export function loadTagSources() {
  asked ||= fetch('/api/services', { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => Promise.all((Array.isArray(list) ? list : [])
      .filter((s) => s.tags && (s.tags_project || s.entry_project))
      .map((s) => fetch(`/pp/${s.name}/${s.tags_project || s.entry_project}/api/tags`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        // Named short where tags are counted: "activity", not "activity manager".
        .then((x) => ({ svc: s.name, proj: s.tags_project || s.entry_project, label: (s.label || s.name).replace(/\s*manager$/i, ''),
          color: s.color || '', tags: x?.tags || {} })))))
    .catch(() => [])
  return asked
}
/** Every record wearing `tag`, service by service: [{ svc, proj, label,
 *  color, items: [{ key, rec }] }] — each service's GET /api/tagged. */
export const loadTagged = (tag) => loadTagSources().then((src) => Promise.all(src.map((s) =>
  fetch(`/pp/${s.svc}/${s.proj}/api/tagged?tag=${encodeURIComponent(tag)}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((x) => ({ ...s, items: x?.items || [] })))))
/** Every record naming project `name` in its text (`+STARK`: a note, a
 *  to-do), service by service — the same shape as loadTagged. */
export const loadMentions = (name) => loadTagSources().then((src) => Promise.all(src.map((s) =>
  fetch(`/pp/${s.svc}/${s.proj}/api/tagged?project=${encodeURIComponent(name)}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((x) => ({ ...s, items: x?.items || [] })))))
/** Forget the answers: the next ask goes to the services again. */
export const forgetTagSources = () => { asked = null }

/** One tag renamed — or several merged into one — in EVERY sharing service
 *  (but `skip`, which renames its own): each one's POST /api/tags/rename, in
 *  turn. [{ svc, label, changed } | { svc, label, error }]; the answers are
 *  forgotten after. */
export const renameTagEverywhere = (from, to, { skip } = {}) => loadTagSources().then((src) => Promise.all(src.filter((s) => s.svc !== skip).map((s) =>
  fetch(`/pp/${s.svc}/${s.proj}/api/tags/rename`, {
    method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }),
  }).then(async (r) => (r.ok ? { svc: s.svc, label: s.label, changed: (await r.json()).changed }
    : { svc: s.svc, label: s.label, error: (await r.json().catch(() => ({}))).detail || r.status }))
    .catch((e) => ({ svc: s.svc, label: s.label, error: String(e.message || e) }))))
  .finally(forgetTagSources))
export const loadSharedTags = () => loadTagSources().then((src) => mergeTags(src.map((x) => x.tags)))

/** One row per tag across the services: { key, name, count, by: [{ svc,
 *  label, color, n }] }. `own` ({ svc, tags }) stands in for that service's
 *  answer — what is on its screen now, not what it said when the page opened. */
export function sharedTagRows(sources, own) {
  const src = own ? [...sources.filter((x) => x.svc !== own.svc), { label: own.svc, ...sources.find((x) => x.svc === own.svc), ...own }] : sources
  const names = new Map(mergeTags(src.map((x) => x.tags)).map((t) => [tagKey(t.name), t]))
  const by = new Map()
  for (const x of src) {
    for (const [t, n] of Object.entries(x.tags || {})) {
      const k = tagKey(t)
      if (!k) continue
      const list = by.get(k) || []
      const e = list.find((y) => y.svc === x.svc)
      if (e) e.n += n
      else list.push({ svc: x.svc, label: x.label, color: x.color, n })
      by.set(k, list)
    }
  }
  return [...names.entries()].map(([key, t]) => ({ key, name: t.name, count: t.count, by: by.get(key) || [] }))
}

/** The sharing services' answers ([] until they come); asked again when
 *  `again` changes (after a rename). */
export function useTagSources(again) {
  const [src, setSrc] = useState([])
  useEffect(() => {
    let on = true
    loadTagSources().then((x) => { if (on) setSrc(x) })
    return () => { on = false }
  }, [again])
  return src
}

/** The shared tags' names, most worn first ([] until they come). */
export function useSharedTags() {
  const src = useTagSources()
  return useMemo(() => mergeTags(src.map((x) => x.tags)).map((x) => x.name), [src])
}

// ─── starred tags ──────────────────────────────────────────────────────────
// The tags this ACCOUNT starred (the portal keeps them on the account:
// prefs.favTags), first in every tags tab. One list for the page, every
// screen that shows it kept in step.
let favAsk = null
let favNow = null
const favSeen = new Set()
const loadFavs = () => (favAsk ||= fetch('/api/account/prefs', { headers: authHeaders() })
  .then((r) => (r.ok ? r.json() : null)).then((x) => (favNow = x?.prefs?.favTags || []))
  .catch(() => (favNow = [])))
/** { favTags, isFavTag(tag), toggleFavTag(tag) } — a star turns at once and
 *  is saved behind it. */
export function useFavTags() {
  const [list, setList] = useState(favNow || [])
  useEffect(() => {
    favSeen.add(setList)
    loadFavs().then(setList)
    return () => { favSeen.delete(setList) }
  }, [])
  const isFavTag = useCallback((t) => list.some((x) => tagKey(x) === tagKey(t)), [list])
  const toggleFavTag = useCallback((t) => {
    const next = list.some((x) => tagKey(x) === tagKey(t)) ? list.filter((x) => tagKey(x) !== tagKey(t)) : [...list, t]
    favNow = next
    favSeen.forEach((f) => f(next))
    fetch('/api/account/prefs', { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ favTags: next }) }).catch(() => {})
  }, [list])
  return { favTags: list, isFavTag, toggleFavTag }
}

/** The spelling to store for a tag typed: one already in use, whatever its
 *  case — else the tag as typed. */
export const spellTag = (t, names) => names.find((n) => tagKey(n) === tagKey(t)) || String(t).trim()

/** Names, one per tag whatever the case (the first spelling met kept). */
export const uniqueTags = (names) => {
  const seen = new Set()
  return names.filter((n) => { const k = tagKey(n); if (!k || seen.has(k)) return false; seen.add(k); return true })
}

// ─── projects ──────────────────────────────────────────────────────────────
// A project (project_manager's record) is a set of tags matched all or any;
// in text it is `+name`, as a tag is `#name`. What belongs to one is what
// wears its tags — and, in a note, what names it (`+STARK`).
const PM = 'project_manager'
let projAsk = null
/** Every project: [{ id, name, tags, match, svc, proj }] ([] without project_manager). */
export function loadProjects() {
  projAsk ||= fetch('/api/services', { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (Array.isArray(list) ? list : []).find((s) => s.name === PM))
    .then((s) => {
      const proj = s && (s.tags_project || s.entry_project)
      if (!proj) return []
      return fetch(`/pp/${PM}/${proj}/api/data`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : {}))
        .then((d) => (d.projects || []).filter((p) => p?.name)
          .map((p) => ({ id: p.id, name: p.name, tags: p.tags || [], match: p.match || 'or', svc: PM, proj })))
    })
    .catch(() => [])
  return projAsk
}
export const forgetProjects = () => { projAsk = null }
/** Does a record wearing `tags` belong to project `p`? All its tags or any (`p.match`). */
export function projectWears(p, tags) {
  const have = new Set((tags || []).map(tagKey))
  const want = (p.tags || []).map(tagKey).filter(Boolean)
  return want.length > 0 && (p.match === 'and' ? want.every((k) => have.has(k)) : want.some((k) => have.has(k)))
}
// ─── references ────────────────────────────────────────────────────────────
// A reference (reference_manager's record) is one paper, known by its cite
// key — the name `\cite{…}` uses. A document written elsewhere can say which
// paper it IS; this only ever reads the list.
const RM = 'reference_manager'
let refAsk = null
/** Every reference: [{ id, citeKey, title, svc, proj }] ([] without reference_manager). */
export function loadReferences() {
  refAsk ||= fetch('/api/services', { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (Array.isArray(list) ? list : []).find((s) => s.name === RM))
    .then((s) => {
      const proj = s && (s.tags_project || s.entry_project)
      if (!proj) return []
      return fetch(`/pp/${RM}/${proj}/api/data`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : {}))
        .then((d) => (d.references || []).filter((r) => String(r?.citeKey || '').trim())
          .map((r) => ({ id: r.id, citeKey: String(r.citeKey).trim(), title: r.title || '', svc: RM, proj })))
    })
    .catch(() => [])
  return refAsk
}
export const forgetReferences = () => { refAsk = null }
/** The references ([] until they come). */
export function useReferences() {
  const [list, setList] = useState([])
  useEffect(() => {
    let on = true
    loadReferences().then((x) => { if (on) setList(x) })
    return () => { on = false }
  }, [])
  return list
}

/** The projects ([] until they come). */
export function useProjects() {
  const [list, setList] = useState([])
  useEffect(() => {
    let on = true
    loadProjects().then((x) => { if (on) setList(x) })
    return () => { on = false }
  }, [])
  return list
}
