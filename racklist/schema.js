import { useEffect, useMemo, useState } from 'react'
import { typeOf, refTarget, remoteDoc } from './types.jsx'

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
 * `col` on a field puts it in the table: a width, or { w, min, drop } where
 * `drop` is the window width below which the column leaves. A field without
 * one is in the editor only.
 */
export function defineRack(def) {
  const item = def.item || {}
  const fields = (item.fields || []).map((f) => ({ label: f.k, ...f }))
  const classes = (def.classes || []).map((c) => ({
    label: c.k, ...c,
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
  return { k: f.k, label: f.label, w: c.w || 120, min: c.min || 40, drop: c.drop,
    num: f.type === 'number' || c.num }
}

/** The item table's columns: the checkbox, the number, then every field that
 *  asked for a column, in the order they are declared. */
export function itemColumns(def) {
  return [
    { k: 'chk', w: 26, min: 26, fix: true },
    { k: 'num', w: 40, min: 30, fix: true, label: '#' },
    ...def.item.fields.filter((f) => f.col).map(colOf),
  ]
}

/** A class table's columns: its own fields, and how many items wear it. */
export function classColumns(def, cls) {
  const own = cls.stored ? cls.fields.filter((f) => f.col) : [{ k: 'name', label: cls.label, col: 220 }]
  return [
    { k: 'num', w: 40, min: 30, fix: true, label: '#' },
    ...own.map(colOf),
    { k: 'count', w: 70, min: 46, label: def.unit === '개' ? 'count' : def.item.noun, num: true },
  ]
}

/** column key → what it sorts by. The same accessor the cell uses, so the
 *  order you get is the order you can see. */
export function itemSorters(def, doc, extra = {}) {
  const out = {}
  for (const f of def.item.fields) {
    const T = typeOf(f)
    const c = ctxFor(def, doc, f, extra)
    out[f.k] = (r) => T.sort(r?.[f.k], c)
  }
  return out
}

/** One row's cells, by column key. */
export function itemCells(def, doc, rec, extra = {}) {
  const out = {}
  for (const f of def.item.fields) {
    if (!f.col) continue
    const T = typeOf(f)
    out[f.k] = f.cell ? f.cell(rec, ctxFor(def, doc, f, extra)) : T.cell(rec?.[f.k], ctxFor(def, doc, f, extra))
  }
  return out
}

/** What the search box reads: every field that has not opted out. */
export function itemSearch(def, doc, extra = {}) {
  const fs = def.item.fields.filter((f) => f.search !== false)
  return (rec, q) => fs.some((f) => typeOf(f).text(rec?.[f.k], ctxFor(def, doc, f, extra)).toLowerCase().includes(q))
}

/** The listing's tokens: one per field, by its label AND its key, so a rule
 *  can say {제목} or {title}. */
export function itemTokens(def, doc, extra = {}) {
  const out = {}
  for (const f of def.item.fields) {
    const get = (r) => typeOf(f).text(r?.[f.k], ctxFor(def, doc, f, extra))
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
const wears = (rec, field, name) => {
  const v = rec?.[field.k]
  return Array.isArray(v) ? v.includes(name) : v === name
}

/** A class tab's rows: the class records (or the names in use), each with how
 *  many items wear it. */
export function classRows(def, doc, cls) {
  const field = wornBy(def, cls)
  const items = doc?.[def.item.key] || []
  const names = cls.stored
    ? (doc?.[cls.k] || [])
    : [...new Set(items.flatMap((r) => (Array.isArray(r[field?.k]) ? r[field.k] : [r[field?.k]])).filter(Boolean))]
      .map((name) => ({ name }))
  return names.map((r) => ({ ...r, count: field ? items.filter((x) => wears(x, field, r.name)).length : 0 }))
}

// ─── tabs ─────────────────────────────────────────────────────────────────
/** The tabs that are always there: every item, then one per class. */
export function fixedTabs(def) {
  return [
    { id: 'all', kind: 'items', label: def.item.allLabel || def.item.key },
    ...def.classes.map((c) => ({ id: `cls:${c.k}`, kind: 'classes', of: c.k, label: c.label })),
  ]
}

/** The items a tab lists, sorted: every one, or those wearing one class. */
export function itemScope(def, doc, tab, sort, sorters) {
  if (tab?.kind !== 'items') return []
  let list = doc?.[def.item.key] || []
  if (tab.of && tab.name) {
    const field = wornBy(def, def.classes.find((c) => c.k === tab.of) || {})
    if (field) list = list.filter((r) => wears(r, field, tab.name))
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
