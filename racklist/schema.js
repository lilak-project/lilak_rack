import { useEffect, useMemo, useState } from 'react'
import { typeOf, refTarget, remoteDoc, refLabelOf } from './types.jsx'

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
 *   fold(rec, gone, to)        how merging names (tags) changes a record, when
 *                              more than the field itself moves (a main tag)
 *
 * A stored class may say:
 *   keyBy: 'id'                items point at its records by id (people), not name
 *   rowLabel: (rec) => string  what its row and tab are called
 *   fill(rec, doc) / check(rec, doc, prev) => '' | why not
 *   onSave(rec, prev, doc) => patch    more to change when one is saved
 *   onDelete(rec, doc) => patch        … or deleted (and deleteWarn(rec, doc))
 *   countLabel                 the header of its count column
 * and its fields may be computed (`get`) and drawn (`cell`) like an item's.
 */
export function defineRack(def) {
  const item = def.item || {}
  const fields = (item.fields || []).map((f) => ({ label: f.k, ...f }))
  const classes = (def.classes || []).map((c) => ({
    label: c.k, keyBy: 'name', ...c,
    // A class with fields of its own is a list of records in the document; one
    // without is a name the items wear (its list is what they use).
    stored: !c.field,
    fields: (c.fields || [{ k: 'name', label: '이름', type: 'text', col: 200 }]).map((f) => ({ label: f.k, ...f })),
  }))
  return {
    ...def,
    unit: def.unit || '개',
    key: def.key || def.name,
    item: {
      noun: '항목', id: 'id', ...item, fields,
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
    num: f.type === 'number' || c.num, tone: f.tone }
}

/** The item table's columns: the checkbox, the number, then every field that
 *  asked for a column, in the order they are declared. */
export function itemColumns(def) {
  return [
    { k: 'chk', w: 26, min: 26, fix: true },
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
    { k: 'count', w: 70, min: 46, label: cls.countLabel || (def.unit === '개' ? 'count' : def.item.noun), num: true },
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
  const fs = def.item.fields.filter((f) => f.search !== false)
  return (rec, q) => fs.some((f) => {
    const c = ctxFor(def, doc, f, extra)
    return typeOf(f).text(valueOf(f, rec, c), c).toLowerCase().includes(q)
  })
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
export function itemScope(def, doc, tab, sort, sorters) {
  if (tab?.kind !== 'items') return []
  let list = doc?.[def.item.key] || []
  if (tab.of && (tab.key || tab.name)) {
    const field = wornBy(def, def.classes.find((c) => c.k === tab.of) || {})
    if (field) list = list.filter((r) => wears(r, field, tab.key || tab.name))
  }
  if (tab.ids) {
    const order = new Map(tab.ids.map((id, i) => [id, i]))
    list = list.filter((r) => order.has(r.id))
    if (!sort) return list.sort((a, b) => order.get(a.id) - order.get(b.id))
  }
  const o = sort || def.item.order
  const get = sorters[o.k] || (() => '')
  const dir = o.dir || 1
  return [...list].sort((a, b) => {
    const x = get(a), y = get(b)
    const xe = x === null || x === undefined || x === '', ye = y === null || y === undefined || y === ''
    if (xe || ye) return xe && ye ? 0 : (xe ? 1 : -1)
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
    return String(x).localeCompare(String(y), 'ko') * dir
  })
}

// ─── other services ───────────────────────────────────────────────────────
/** Every other service a field points at, loaded once — so a cell can show the
 *  label of a paper that lives in reference_manager. Keyed `${svc}/${proj}`. */
export function useRemoteDocs(def) {
  const targets = useMemo(() => {
    const all = [...def.item.fields, ...def.classes.flatMap((c) => c.fields || [])]
      .filter((f) => f.type === 'ref' || f.type === 'refs')
      .map((f) => refTarget(f, def)).filter((t) => !t.local && t.svc)
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
