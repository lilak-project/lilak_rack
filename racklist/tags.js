/** Tags shared across services.
 *
 * Every service that says so in its manifest (`capabilities.tags`) answers
 * GET /api/tags on its link project (portal.js) with the tags its records wear and how
 * many wear each — the rack services from their `tags` field, note from the
 * `#tags` in its bodies. A tag box anywhere offers all of them, so a tag
 * typed in one service is the same tag in the others.
 *
 * A tag is the same tag whatever its case (`spirit` is `SpiRIT`): the name
 * shown for it is the spelling used most, and a tag typed is stored in that
 * spelling when one is already in use. Each service keeps its own records;
 * this only ever reads the others.
 *
 * `/` makes a tag a child: `agent/rack` is inside `agent`. The parent is not
 * stored anywhere, it exists because a child does, and a tag is always shown
 * and stored by its whole name.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PORTAL_BASE, authHeaders, linkProject, newId, remoteDocOf } from './portal.js'

export const tagKey = (t) => String(t ?? '').trim().toLowerCase()
/** Is `t` the tag `parent`, or inside it? */
export const tagWithin = (t, parent) => {
  const k = tagKey(t), p = tagKey(parent)
  return !!p && (k === p || k.startsWith(`${p}/`))
}

/** Flat rows ({ key, name, count, per }) as an outline: a row for every parent,
 *  worn or not, counting what is inside it. Returns the rows to draw, each with
 *  `depth`, `kids` and `open`. `order` sorts each level.
 *  ponytail: a record wearing two children counts twice in the parent; exact
 *  numbers need /api/tags to count parents itself. */
export function tagTree(rows, isOpen, order) {
  const nodes = new Map()
  const top = []
  const node = (name) => {
    const key = tagKey(name)
    if (nodes.has(key)) return nodes.get(key)
    const n = { key, name, count: 0, per: {}, group: true, under: [] }
    nodes.set(key, n)
    const i = name.lastIndexOf('/')
    ;(i > 0 ? node(name.slice(0, i)).under : top).push(n)
    return n
  }
  for (const r of rows) Object.assign(node(r.name), r, { group: false })
  const total = (n) => {
    for (const c of n.under) {
      total(c)
      n.count += c.count
      for (const [k, v] of Object.entries(c.per)) n.per[k] = (n.per[k] || 0) + v
    }
  }
  top.forEach(total)
  const out = []
  const walk = (list, depth) => {
    for (const n of order ? [...list].sort(order) : list) {
      const open = n.under.length > 0 && isOpen(n.key)
      out.push({ ...n, depth, kids: n.under.length, open })
      if (open) walk(n.under, depth + 1)
    }
  }
  walk(top, 0)
  return out
}

/** Picked tags moved under `dest` ('' = the top), what is inside each going
 *  along: `a/b` under `x` is `x/b`, and `a/b/c` is `x/b/c`. A pick inside
 *  another pick follows the outer one. `names` are the tags in use. */
export function tagMoves(names, picked, dest) {
  const tops = picked.filter((p) => !picked.some((q) => tagKey(q) !== tagKey(p) && tagWithin(p, q)))
  const out = []
  for (const p of tops) {
    const leaf = p.slice(p.lastIndexOf('/') + 1)
    const head = dest ? `${dest}/${leaf}` : leaf
    for (const n of names) {
      if (!tagWithin(n, p)) continue
      const to = head + n.slice(p.length)
      if (tagKey(to) !== tagKey(n)) out.push({ from: n, to })
    }
  }
  return out
}

/** A rename of `gone` to `to`, with what is inside each following it. */
export const tagRenames = (names, gone, to) => uniqueTags([...gone, ...names.filter((n) => gone.some((g) => tagWithin(n, g)))])
  .map((from) => ({ from, to: to + from.slice(gone.find((g) => tagWithin(from, g)).length) }))
  .filter((m) => m.from !== m.to)

/** A name another service's text can hold: note's tag rule. */
export const tagNameOk = (t) => /^(?![0-9]+$)[^\s#.,;:!?()[\]{}'"]+$/.test(t)

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
      .filter((s) => s.tags && s.link_project)
      .map((s) => fetch(`/pp/${s.name}/${s.link_project}/api/tags`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : { denied: r.status === 403 })).catch(() => null)
        // Named short where tags are counted: "activity", not "activity manager".
        .then((x) => ({ svc: s.name, proj: s.link_project, label: (s.label || s.name).replace(/\s*manager$/i, ''),
          color: s.color || '', tags: x?.tags || {}, denied: !!x?.denied })))))
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
export const renameTagEverywhere = (from, to, { skip, wearing } = {}) => loadTagSources().then((src) => Promise.all(src
  .filter((s) => s.svc !== skip && (!wearing || Object.keys(s.tags).some((t) => from.some((f) => tagKey(f) === tagKey(t))))).map((s) =>
  fetch(`/pp/${s.svc}/${s.proj}/api/tags/rename`, {
    method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }),
  }).then(async (r) => (r.ok ? { svc: s.svc, label: s.label, changed: (await r.json()).changed }
    : { svc: s.svc, label: s.label, error: (await r.json().catch(() => ({}))).detail || r.status }))
    .catch((e) => ({ svc: s.svc, label: s.label, error: String(e.message || e) }))))
  .finally(forgetTagSources))
/** The same, in this project of this service only. */
export const renameTagHere = (from, to) => fetch(`${PORTAL_BASE}/api/tags/rename`, {
  method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }),
}).then(async (r) => (r.ok ? null : (await r.json().catch(() => ({}))).detail || r.status)).catch((e) => String(e.message || e))
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
export function useTagSources(again, wanted = true) {
  const [src, setSrc] = useState([])
  useEffect(() => {
    if (!wanted) return undefined          // not asked until something shows them
    let on = true
    loadTagSources().then((x) => { if (on) setSrc(x) })
    return () => { on = false }
  }, [again, wanted])
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
  const proj = linkProject(PM)
  projAsk ||= (!proj ? Promise.resolve([]) : remoteDocOf(PM, proj)
    .then((d) => (d?.projects || []).filter((p) => p?.name)
      .map((p) => ({ id: p.id, name: p.name, tags: p.tags || [], match: p.match || 'or', svc: PM, proj })))
    .catch(() => []))
  return projAsk
}
export const forgetProjects = () => { projAsk = null }
/** Does a record wearing `tags` belong to project `p`? All its tags or any (`p.match`). */
export function projectWears(p, tags) {
  const want = (p.tags || []).map(tagKey).filter(Boolean)
  const has = (k) => (tags || []).some((t) => tagWithin(t, k))
  return want.length > 0 && (p.match === 'and' ? want.every(has) : want.some(has))
}
// ─── references ────────────────────────────────────────────────────────────
// A reference (reference_manager's record) is one paper, known by its cite
// key — the name `\cite{…}` uses. A document written elsewhere can say which
// paper it IS; this only ever reads the list.
const RM = 'reference_manager'
let refAsk = null
/** Every reference: [{ id, citeKey, title, svc, proj }] ([] without reference_manager). */
export function loadReferences() {
  const proj = linkProject(RM)
  refAsk ||= (!proj ? Promise.resolve([]) : remoteDocOf(RM, proj)
    .then((d) => (d?.references || []).filter((r) => String(r?.citeKey || '').trim())
      .map((r) => ({ id: r.id, citeKey: String(r.citeKey).trim(), title: r.title || '', svc: RM, proj })))
    .catch(() => []))
  return refAsk
}
export const forgetReferences = () => { refAsk = null }

/** reference_manager's whole document — the records with every field, plus the
 *  `authors` and `journals` a citation is spelled from. `loadReferences` keeps
 *  three fields of each record because a picker wants a list; a .bib wants the
 *  paper. Not cached: this is asked when a file is about to be written. */
export async function referenceDoc() {
  const proj = linkProject(RM)
  if (!proj) return null
  const r = await fetch(`/pp/${RM}/${proj}/api/data`, { headers: authHeaders() })
  return r.ok ? r.json() : null
}

/** A paper added to reference_manager from somewhere else, and the record as
 *  it was stored.
 *
 *  The one write across services. Everything else here reads, and this stays
 *  the exception on purpose: a manuscript IS a paper, so the service that
 *  keeps the papers should know about it the moment it exists rather than
 *  when someone remembers to type it in. It is a PUT of the records as this
 *  moment sees them, which is what reference_manager's own screen sends: the
 *  store merges record by record against `baseVersion` (rackstore's `merge`),
 *  so an edit someone is making there at the same time is kept, not run over.
 *  A key already in the library is not a second record — it is that one. */
export async function addReference(rec) {
  const proj = linkProject(RM)
  if (!proj) throw new Error('reference_manager')
  const doc = await referenceDoc()
  if (!doc) throw new Error('reference_manager')
  const key = String(rec?.citeKey || '').trim()
  const row = (r) => ({ id: r.id, citeKey: String(r.citeKey || '').trim(), title: r.title || '', svc: RM, proj })
  const had = key && (doc.references || []).find((r) => String(r.citeKey || '').trim() === key)
  if (had) return { ref: row(had), had: true }
  const made = { id: newId(), ...rec }
  const r = await fetch(`/pp/${RM}/${proj}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ baseVersion: doc.version, references: [...(doc.references || []), made] }),
  })
  if (r.status === 409) throw new Error('conflict')
  if (!r.ok) throw new Error(`PUT ${RM} → ${r.status}`)
  forgetReferences()
  return { ref: row(made), had: false }
}
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

// ─── people ────────────────────────────────────────────────────────────────
// A person (author_manager's record) is written `@이정우` or `@JungWooLee`, as
// a tag is `#name` and a project `+name`. There is no handle to keep in step:
// the NAME is the key. It is run together — a mention cannot hold a space —
// and read without case or script, so the same person is reached by their
// Korean name, their English one or their nick. This only ever reads the list.
const AM = 'author_manager'
/** A name as a mention writes it: spaces, dots, hyphens and apostrophes out.
 *  "Jung Woo Lee" is `@JungWooLee`; 이정우 is already one word. */
export const nameText = (n) => String(n ?? '').replace(/[\s.·'’\-]+/g, '')
/** The same, compared: `@jungwoolee` is `@JungWooLee`. */
export const nameKey = (n) => nameText(n).toLowerCase()
/** The spellings that reach one person — their Korean name, their English name
 *  and their nick, whichever they have. */
export const authorKeys = (p) => [...new Set([p.kor, p.eng, p.nick].map(nameKey).filter(Boolean))]

let authAsk = null
/** Every person: [{ id, kor, eng, nick, email, keys, svc, proj }] ([] without
 *  author_manager). `keys` is what `@` matches; the names are what is shown. */
export function loadAuthors() {
  const proj = linkProject(AM)
  authAsk ||= (!proj ? Promise.resolve([]) : fetch(`/pp/${AM}/${proj}/api/data`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => (d.authors || []).map((a) => {
      const p = {
        id: a.id,
        kor: `${(a.korFamily || '').trim()}${(a.korGiven || '').trim()}`,
        eng: [a.engFirst, a.engMiddle, a.engLast].filter(Boolean).join(' '),
        nick: String(a.nick || '').trim(),
        email: String(a.repEmail || '').trim() || (a.emails || [])[0] || '',
        svc: AM, proj,
      }
      return { ...p, keys: authorKeys(p) }
    }).filter((p) => p.keys.length))
    .catch(() => []))
  return authAsk
}
export const forgetAuthors = () => { authAsk = null }

/** The ONE person a `@word` names, or null — null for a word nobody answers to
 *  AND for a word two people answer to. Two 김민주 are not one person, so a
 *  name they share links to neither: it stays text until something tells them
 *  apart (a nick does, and is a name of its own here). */
export function authorFor(list, word) {
  const k = nameKey(word)
  if (!k) return null
  const hit = (list || []).filter((p) => p.keys.includes(k))
  return hit.length === 1 ? hit[0] : null
}
/** Who a `@word` names, however many — so a screen can say that a name is
 *  shared rather than quietly showing nothing. */
export const authorsNamed = (list, word) => {
  const k = nameKey(word)
  return k ? (list || []).filter((p) => p.keys.includes(k)) : []
}

/** The people ([] until they come). */
export function useAuthors() {
  const [list, setList] = useState([])
  useEffect(() => {
    let on = true
    loadAuthors().then((x) => { if (on) setList(x) })
    return () => { on = false }
  }, [])
  return list
}
