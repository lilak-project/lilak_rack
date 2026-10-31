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
import { useEffect, useMemo, useState } from 'react'
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
        .then((x) => ({ svc: s.name, label: s.label || s.name, color: s.color || '', tags: x?.tags || {} })))))
    .catch(() => [])
  return asked
}
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

/** The sharing services' answers ([] until they come). */
export function useTagSources() {
  const [src, setSrc] = useState([])
  useEffect(() => {
    let on = true
    loadTagSources().then((x) => { if (on) setSrc(x) })
    return () => { on = false }
  }, [])
  return src
}

/** The shared tags' names, most worn first ([] until they come). */
export function useSharedTags() {
  const src = useTagSources()
  return useMemo(() => mergeTags(src.map((x) => x.tags)).map((x) => x.name), [src])
}

/** Where else a tag is worn, as a tags tab says it: `노트 5 · 논문 26`. */
export const whereText = (by, own) => by.filter((b) => b.svc !== own && b.n)
  .sort((a, b) => b.n - a.n).map((b) => `${b.label} ${b.n}`).join(' · ')

/** The spelling to store for a tag typed: one already in use, whatever its
 *  case — else the tag as typed. */
export const spellTag = (t, names) => names.find((n) => tagKey(n) === tagKey(t)) || String(t).trim()

/** Names, one per tag whatever the case (the first spelling met kept). */
export const uniqueTags = (names) => {
  const seen = new Set()
  return names.filter((n) => { const k = tagKey(n); if (!k || seen.has(k)) return false; seen.add(k); return true })
}
