import './strings.js'
import { asSorts, byKeys } from './sort.js'
import { useEffect, useMemo, useState } from 'react'
import { typeOf, refTarget, remoteDoc, refLabelOf, backlinksOf } from './types.jsx'
import { portalUser } from './portal.js'
import { tr } from '../i18n.jsx'

/**
 * A service, declared.
 *
 *   defineRack({
 *     name: 'activities', title: '학술 활동', unit: '건',
 *     key: 'ac',                                  // storage prefix
 *     item: {
 *       key: 'activities', noun: '활동',          // the document's list, and what one is called
 *       label: 'title',                           // a field name, or (rec) => string
 *       order: { k: 'date', dir: -1 },            // before a column is pressed
 *       fields: [
 *         { k: 'title', label: '제목', type: 'text', col: 320 },
 *         { k: 'date',  label: '날짜', type: 'date', col: 96 },
 *         { k: 'event', label: '행사', type: 'class', of: 'events', col: 140 },
 *         { k: 'tags',  label: '태그', type: 'tags', col: 160 },
 *         { k: 'paper', label: '논문', type: 'ref',
 *           to: { svc: 'reference_manager', proj: 'papers', item: 'references', label: 'citeKey' } },
 *       ],
 *     },
 *     classes: [
 *       { k: 'events', label: '행사', fields: [ … ] },   // a list of records others point at
 *       { k: 'tags', field: 'tags' },                    // a name records wear, no record behind it
 *     ],
 *     listing: { presets: [['CV', '{date} {title}, {event}', '⏎']] },
 *   })
 *
 * Everything the screen needs is DERIVED from this — the table's columns, what
 * each sorts by, what the search box reads, the facets, the listing's tokens,
 * the editor's form, the tabs, and the keys the backend owns. A field is said
 * once.
 *
 * `col` on a field puts it in the table: a width, or { w, min, drop, label }
 * where `drop` is the window width below which the column leaves and `label`
 * is the header when it is not the field's label. A field without one is in
 * the editor only. The columns come in declared order unless `item.columns`
 * lists their keys — the table and the form need not read the same way.
 *
 * `get: (rec, ctx) => value` makes a field COMPUTED — shown, sorted, searched
 * and listed, never stored or edited (ctx.doc is the whole document, so a
 * count of who points at this record is a computed field too).
 * `item.fill(rec, doc) => rec` runs before a save and fills what a record can
 * work out for itself (a naming rule).
 *
 * More a field may say:
 *   sort: (v, ctx) => key      what its column sorts by, when not its text
 *   cell: (rec, ctx) => node   its table cell, drawn by hand
 *   when: (rec, { draft }) => bool   shown in the editor only then
 *   store: false               a helper in the editor (a paste box), never saved
 *   tone: 'ink' | 'dim'        the column's colour: the record's own words, or about it
 *   search: false              not read by the search box
 *
 * `item.now: { start: 'start', end: 'end' }` — records with dates: while the
 * table is sorted by `start`, what is on today is lit, and a red line marks
 * where today falls between what has begun and what has not.
 *   fold(rec, gone, to)        how merging names (tags) changes a record, when
 *                              more than the field itself moves (a main tag)
 *   group: '한글 이름'          sit on one line with the fields beside it that
 *                              say the same group (성 · 이름; first · middle · last)
 *   col: { when: (tab) => bool }  a column only some tabs have (a group's core)
 *
 * Computed fields, cells and sorters see the tab they are drawn for (ctx.tab).
 * `item.tie(tab, ctx) => (a, b) => n` is the order under every sort — the one
 * the list is written in (an author list: core, then family name).
 * `item.search(rec, q, ctx) => bool` replaces reading every field.
 *
 * A stored class may say:
 *   keyBy: 'name'              items point at its records by name (the default is
 *                              by id: a rename then changes one record, not every
 *                              item — which is what lets two servers be synced)
 *   rowLabel: (rec) => string  what its row and tab are called
 *   fill(rec, doc) / check(rec, doc, prev) => '' | why not
 *   onSave(rec, prev, doc) => patch    more to change when one is saved
 *   onDelete(rec, doc) => patch        … or deleted (and deleteWarn(rec, doc))
 *   countLabel                 the header of its count column
 *   noun                       one of them, in buttons and notes (+ 새 그룹); its label by default
 *   actions(rec, setRec, ctx) => node   buttons of its own on its editor's bar
 *                              (a list's 위치 적용) — ctx has doc, commit, isAdmin, say
 *   merge(doc, gone, to) => patch   folding several records into one (the
 *                              items pointing at them follow) — a merge mode
 * and its fields may be computed (`get`) and drawn (`cell`) like an item's.
 *
 * A LIST is a stored class whose records hold items rather than being worn by
 * them — a set of assets going somewhere, the papers for a talk:
 *   { k: 'lists', label: 'lists', list: { ids: 'ids', owner: 'user' }, fields: [ name, … ] }
 * Its tab lists the lists; a list opens as a tab of its items, in its order;
 * the selection can be put in one or taken out. `owner` (optional) is filled
 * with whoever made it, and only they or a manager may delete it. `show:
 * (item) => string` is what its editor says beside each item it holds.
 */
export function defineRack(def) {
  const item = def.item || {}
  // A backlinks field is computed from the other service's links.
  const fields = (item.fields || []).map((f) => ({ label: f.k,
    ...(f.type === 'backlinks' && !f.get ? { get: (r, ctx) => backlinksOf(r, f, ctx) } : {}), ...f }))
  const classes = (def.classes || []).map((c) => {
    let fields = (c.fields || [{ k: 'name', label: tr("rk_name"), type: 'text', col: 200 }]).map((f) => ({ label: f.k, ...f }))
    // A list holds its items: the field that does is the kit's, said or not.
    if (c.list && !fields.some((f) => f.k === c.list.ids)) {
      fields = [...fields, { k: c.list.ids, label: tr("rk_item"), type: 'members', show: c.list.show }]
    }
    // A list's owner is whoever made it.
    const owner = c.list?.owner
    const fill = owner ? (r, doc) => {
      const out = c.fill ? c.fill(r, doc) : r
      return out[owner] ? out : { ...out, [owner]: portalUser()?.email || '' }
    } : c.fill
    return {
      label: c.k, keyBy: 'id', ...c, fill,
      // What one is called (+ 새 위치): said, or the tab's own name.
      noun: c.noun || c.label || c.k,
      // A class with fields of its own is a list of records in the document; one
      // without is a name the items wear (its list is what they use).
      stored: !c.field,
      fields,
    }
  })
  return {
    ...def,
    unit: def.unit || tr("rk_unit_items"),
    key: def.key || def.name,
    item: {
      noun: tr("rk_item"), id: 'id', ...item, fields,
      order: item.order || { k: fields[0]?.k, dir: 1 },
    },
    classes,
    // What the backend owns: the items, every stored class, and the settings.
    docKeys: [item.key, ...classes.filter((c) => c.stored).map((c) => c.k), 'settings'],
  }
}

const str = (v) => (v === null || v === undefined ? '' : String(v))
const D = '·'
/** A field's value: what is stored, or — for a field with `get` — what is
 *  worked out from the record (a year from a date). A computed field is never
 *  stored, so it cannot disagree with what it is computed from. */
export const valueOf = (f, rec, ctx) => (f.get ? f.get(rec || {}, ctx || {}) : rec?.[f.k])

/** The context a type is handed: what it may look at. */
export const ctxFor = (def, doc, field, extra = {}) => ({ def, doc, field, ...extra })

/** The label a record is shown under, in tabs and links. */
export function labelOf(def, rec) {
  const l = def.item.label
  if (typeof l === 'function') return l(rec)
  return str(rec?.[l || def.item.fields[0]?.k]) || str(rec?.id).slice(0, 8) || def.item.noun
}

// ─── the table ────────────────────────────────────────────────────────────
const colOf = (f) => {
  const c = typeof f.col === 'object' ? f.col : { w: f.col }
  return { k: f.k, label: c.label || f.label, w: c.w || 120, min: c.min || 40, drop: c.drop,
    num: f.type === 'number' || c.num, tone: f.tone, when: c.when }
}

/** The item table's columns: the checkbox, the number, then every field that
 *  asked for a column, in the order they are declared. */
// ─── favourites ───────────────────────────────────────────────────────────
// A favourite is an item wearing the tag FAV — in the item's tag field when it
// has one (def.item.favorite: '<field>', or the first field of a tags type),
// else in a `tags` of its own the declaration never names. It is a tag like
// any other, so it shows, searches and filters where tags do; and favourites
// come first in every list of items, whatever it is sorted by.
export const FAV = 'favorite'
export const favField = (def) => def.item.favorite
  || def.item.fields.find((f) => f.type === 'tags' || f.type === 'maintags')?.k || 'tags'
const tagList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).filter(Boolean)
export const isFav = (def, r) => tagList(r?.[favField(def)]).includes(FAV)
/** The record with the tag on or off — added at the end, so a first tag that
 *  means something (a paper's main tag) stays first. */
export const withFav = (def, r, on) => {
  const k = favField(def), now = tagList(r[k]).filter((t) => t !== FAV)
  if (on) return { ...r, [k]: [...now, FAV] }
  // Off, and nothing else was there: no field left behind.
  if (!now.length && !def.item.fields.some((f) => f.k === k)) { const { [k]: _, ...rest } = r; return rest }
  return { ...r, [k]: now }
}
const favFirst = (def, list) => [...list.filter((r) => isFav(def, r)), ...list.filter((r) => !isFav(def, r))]

export function itemColumns(def) {
  return [
    { k: 'chk', w: 26, min: 26, fix: true },
    { k: 'fav', w: 26, min: 26, fix: true },
    { k: 'num', w: 40, min: 30, fix: true, label: '#' },
    ...(def.item.columns
      ? def.item.columns.map((k) => def.item.fields.find((f) => f.k === k)).filter(Boolean)
      : def.item.fields.filter((f) => f.col)).map(colOf),
  ]
}

/** A class table's columns: its own fields, and how many items wear it. */
export function classColumns(def, cls) {
  const own = cls.stored ? cls.fields.filter((f) => f.col) : [{ k: 'name', label: cls.label, col: 220 }]
  return [
    { k: 'num', w: 40, min: 30, fix: true, label: '#' },
    ...own.map(colOf),
    { k: 'count', w: 70, min: 46, label: cls.countLabel || (def.unit === tr("rk_unit_items") ? 'count' : def.item.noun), num: true },
  ]
}

/** column key → what it sorts by. The same accessor the cell uses, so the
 *  order you get is the order you can see. */
export function itemSorters(def, doc, extra = {}) {
  const out = {}
  for (const f of def.item.fields) {
    const T = typeOf(f)
    const c = ctxFor(def, doc, f, extra)
    const by = f.sort ? (v) => f.sort(v, c) : (v) => T.sort(v, c)
    out[f.k] = (r) => by(valueOf(f, r, c))
  }
  return out
}

/** One row's cells, by column key. */
export function itemCells(def, doc, rec, extra = {}) {
  const out = {}
  for (const f of def.item.fields) {
    if (!f.col) continue
    // The record rides along, so a cell can open what it belongs to.
    const c = ctxFor(def, doc, f, { ...extra, rec })
    out[f.k] = f.cell ? f.cell(rec, c) : typeOf(f).cell(valueOf(f, rec, c), c)
  }
  return out
}

/** What the search box reads: every field that has not opted out. */
export function itemSearch(def, doc, extra = {}) {
  const linked = linkedText(def, doc, extra)
  // …and, one step further, the words of the records it points at.
  const far = (rec, q) => linked.some(({ keys, text }) => keys(rec).some((k) => text.get(k)?.includes(q)))
  if (def.item.search) return (rec, q) => def.item.search(rec, q, { def, doc, ...extra }) || far(rec, q)
  const fs = def.item.fields.filter((f) => f.search !== false)
  return (rec, q) => fs.some((f) => {
    const c = ctxFor(def, doc, f, extra)
    return typeOf(f).text(valueOf(f, rec, c), c).toLowerCase().includes(q)
  }) || far(rec, q)
}

/** The words of a record, for the search box: its own strings and lists of
 *  strings — not a photo's data URL, not a page of text. */
const recWords = (r) => Object.values(r || {}).flat()
  .filter((v) => typeof v === 'string' && v.length < 400 && !v.startsWith('data:')).join(' ').toLowerCase()

/** What an item points at, one step away, as searchable words: the record of
 *  a stored class it wears (a place's city, a journal's full name, an author's
 *  every spelling) and a record in another service it links to (a paper's
 *  title). Not further — a paper's authors' affiliations are not this item's —
 *  and not its own kind (a cited paper is another paper, not words of this one),
 *  nor the lists that hold it. */
function linkedText(def, doc, extra = {}) {
  const out = []
  for (const c of def.classes.filter((x) => x.stored && !x.list)) {
    const f = wornBy(def, c)
    if (!f) continue
    out.push({ keys: (r) => worn(r, f), text: new Map((doc?.[c.k] || []).map((r) => [String(r[c.keyBy]), recWords(r)])) })
  }
  for (const f of def.item.fields.filter(isRef)) {
    const t = refTarget(f, def)
    if (t.local) continue
    const src = extra.remote?.[`${t.svc}/${t.proj}`]?.[t.item] || []
    out.push({ keys: (r) => worn(r, f), text: new Map(src.map((r) => [`id:${r.id}`, recWords(r)])) })
  }
  return out
}

/** The listing's tokens: one per field, by its label AND its key, so a rule
 *  can say {제목} or {title}. A service whose listing speaks a language of its
 *  own (BibTeX's {author (bib)}) gives `listing.tokens(doc) => { name: fn }`,
 *  and those are the tokens. */
export function itemTokens(def, doc, extra = {}) {
  if (def.listing?.tokens) return def.listing.tokens(doc, extra)
  const out = {}
  for (const f of def.item.fields) {
    if (f.store === false) continue
    const get = (r) => { const c = ctxFor(def, doc, f, extra); return typeOf(f).text(valueOf(f, r, c), c) }
    out[f.k] = get
    if (f.label && f.label !== f.k) out[f.label] = get
  }
  return out
}

// ─── classes ──────────────────────────────────────────────────────────────
/** Which item field a class is worn through: the one pointing `of` it, or
 *  for a wearable class the field it names. */
export function wornBy(def, cls) {
  if (cls.field) return def.item.fields.find((f) => f.k === cls.field)
  return def.item.fields.find((f) => f.of === cls.k)
}
export const isRef = (f) => f?.type === 'ref' || f?.type === 'refs'
/** One link's identity: the record it points at, or — for a name with nobody
 *  behind it — the name. */
export const linkKey = (l) => (l?.id ? `id:${l.id}` : `name:${l?.label || ''}`)
/** What a record wears through a field, as keys: names for a name field, link
 *  identities for a link field — so people in another service can be a class
 *  tab here (책임자 → author_manager) the way tags are. */
function worn(rec, field) {
  const v = rec?.[field.k]
  // A type of the service's own says what a value wears (an author row points
  // at a person by id).
  const T = typeOf(field)
  if (T.keys) return T.keys(v, field)
  const vs = (Array.isArray(v) ? v : (v ? [v] : [])).filter(Boolean)
  return isRef(field) ? vs.map(linkKey) : vs.map(String)
}
export const wears = (rec, field, key) => worn(rec, field).includes(key)

/** A class tab's rows: the class records (or the names in use), each with how
 *  many items wear it. A row's `key` is what an item wears; `name` is what is
 *  shown. They differ only for links, whose label comes from where they point. */
export function classRows(def, doc, cls, extra = {}) {
  const field = wornBy(def, cls)
  const items = doc?.[def.item.key] || []
  let recs
  // A list counts what it holds, not who wears it.
  if (cls.list) return (doc?.[cls.k] || []).map((r) => ({ ...r, key: r.id, count: (r[cls.list.ids] || []).length }))
  if (cls.stored) recs = (doc?.[cls.k] || []).map((r) => ({ ...r, key: r[cls.keyBy] }))
  else if (isRef(field)) {
    const seen = new Map()
    for (const it of items) {
      const v = it[field.k]
      for (const l of (Array.isArray(v) ? v : (v ? [v] : []))) {
        const k = linkKey(l)
        if (!seen.has(k)) seen.set(k, { key: k, name: refLabelOf(l, field, { def, doc, field, ...extra }), linked: !!l.id })
      }
    }
    recs = [...seen.values()]
  } else {
    recs = [...new Set(items.flatMap((r) => worn(r, field)))].map((name) => ({ key: name, name }))
  }
  // How many wear each, in one pass over the items rather than one per row
  // (1,971 authors × 287 papers is a pause you can feel).
  const n = new Map()
  if (field) for (const it of items) for (const k of new Set(worn(it, field))) n.set(k, (n.get(k) || 0) + 1)
  return recs.map((r) => ({ ...r, count: n.get(r.key) || 0 }))
}

// ─── tabs ─────────────────────────────────────────────────────────────────
/** The every-item tab's id. A service moved onto the kit keeps the id it had
 *  (`item.tabId`), since it is in everyone's stored view. */
export const itemTabId = (def) => def.item.tabId || 'all'

/** The tabs that are always there: every item, then one per class. */
export function fixedTabs(def) {
  return [
    { id: itemTabId(def), kind: 'items', label: def.item.allLabel || def.item.key },
    // `tab: false` keeps a class out of the strip: its records are reached
    // from the items that point at them, not from a list of their own.
    ...def.classes.filter((c) => c.tab !== false)
      .map((c) => ({ id: `cls:${c.k}`, kind: 'classes', of: c.k, label: c.label })),
  ]
}

/** The items a tab lists, sorted: every one, or those wearing one class. */
export function itemScope(def, doc, tab, sort, sorters, tie) {
  return tab?.kind === 'items' ? favFirst(def, scopeOf(def, doc, tab, sort, sorters, tie)) : []
}
function scopeOf(def, doc, tab, sort, sorters, tie) {
  let list = doc?.[def.item.key] || []
  const cls = tab.of ? def.classes.find((c) => c.k === tab.of) : null
  if (cls?.list) {
    // A list's tab: its items, in the order it holds them.
    const rec = (doc?.[cls.k] || []).find((r) => r.id === tab.key)
    const idk = def.item.id || 'id'
    const byId = new Map(list.map((r) => [r[idk], r]))
    list = (rec?.[cls.list.ids] || []).map((id) => byId.get(id)).filter(Boolean)
    if (!asSorts(sort).length) return list
  } else if (tab.of && (tab.key || tab.name)) {
    const field = wornBy(def, def.classes.find((c) => c.k === tab.of) || {})
    if (field) list = list.filter((r) => wears(r, field, tab.key || tab.name))
  }
  if (tab.ids) {
    const order = new Map(tab.ids.map((id, i) => [id, i]))
    const idk = def.item.id || 'id'
    list = list.filter((r) => order.has(r[idk]))
    // Its own order (a reference list by citation number) until a column is pressed.
    if (!asSorts(sort).length) return list.sort((a, b) => order.get(a[idk]) - order.get(b[idk]))
  }
  // Underneath every column sort is the order the list is written in — the
  // service's own (tie), or its default order — so equal rows never fall into
  // whatever order the document happens to keep them in. The 나열 prints the
  // rows in this order too: it lists what the table shows, as the table shows it.
  const written = tie || byKeys(def.item.order, sorters)
  return [...list].sort(byKeys(asSorts(sort).length ? sort : def.item.order, sorters, written))
}

// ─── other services ───────────────────────────────────────────────────────
/** Every other service a field points at, loaded once — so a cell can show the
 *  label of a paper that lives in reference_manager. Keyed `${svc}/${proj}`. */
export function useRemoteDocs(def) {
  const targets = useMemo(() => {
    const all = [...def.item.fields, ...def.classes.flatMap((c) => c.fields || [])]
      .filter((f) => f.type === 'ref' || f.type === 'refs' || f.type === 'backlinks')
      .map((f) => (f.type === 'backlinks' ? { svc: f.from.svc, proj: f.from.proj } : refTarget(f, def)))
      .filter((t) => !t.local && t.svc)
    return [...new Map(all.map((t) => [`${t.svc}/${t.proj}`, t])).values()]
  }, [def])
  const [docs, setDocs] = useState({})
  useEffect(() => {
    let alive = true
    for (const t of targets) {
      remoteDoc(t.svc, t.proj).then((d) => {
        if (alive && d) setDocs((m) => ({ ...m, [`${t.svc}/${t.proj}`]: d }))
      })
    }
    return () => { alive = false }
  }, [targets])
  return docs
}

export const EMPTY_CELL = D
