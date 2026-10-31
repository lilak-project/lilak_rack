import './strings.js'
import { useEffect, useState } from 'react'
import { RackField } from './fields.jsx'
import { RackTable, RackRow } from './table.jsx'
import { FacetRows } from './filter.jsx'
import { loadTagged, loadMentions } from './tags.js'
import { tr } from '../i18n.jsx'

/**
 * Under a shared tag's editor (a class with `shared: true`): what wears it in
 * every service, a field per service, a line per record. A record opens in
 * a pane here (`onOpen`: the service's openRecord — its page for that one
 * record, in its colour).
 *
 * What a record is called and opened by, kind by kind (the list it is in).
 */
const korName = (r) => `${(r.korFamily || '').trim()}${(r.korGiven || '').trim()}`
const engName = (r) => [r.engFirst, r.engMiddle, r.engLast].filter(Boolean).join(' ')
const labelOf = (k, r) => (k === 'authors' ? r.nick || korName(r) || engName(r)
  : k === 'todos' ? r.text : r.name || r.title || r.citeKey) || r.id || '·'
const idOf = (k, r) => (['groups', 'records', 'projects'].includes(k) ? null : k === 'assets' ? r.assetId || r.id : r.id)

export function RackTagged({ names, onOpen, skip }) {
  const [found, setFound] = useState(null)
  useEffect(() => {
    let on = true
    setFound(null)
    Promise.all(names.map(loadTagged)).then((per) => {
      if (!on) return
      // Every service, the records wearing any of these names, each once.
      setFound((per[0] || []).filter((s) => s.svc !== skip).map((s) => {
        const seen = new Map()
        for (const p of per) for (const x of p.find((y) => y.svc === s.svc)?.items || []) {
          seen.set(`${x.key}|${x.rec.id ?? x.rec.assetId}|${x.rec.line ?? ''}`, x)
        }
        return { ...s, items: [...seen.values()] }
      }).filter((s) => s.items.length))
    })
    return () => { on = false }
  }, [names.join('\u0001'), skip])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!found) return <RackField label={tr('rk_tagged_elsewhere')}><span className="rl-hint">…</span></RackField>
  if (!found.length) return <RackField label={tr('rk_tagged_elsewhere')}><span className="rl-hint">{tr('rk_none')}</span></RackField>
  return found.map((s) => (
    <RackField key={s.svc} label={`${s.label} ${s.items.length}`}>
      <div className="rl-rows">
        {s.items.map((x, i) => {
          const id = idOf(x.key, x.rec)
          const label = labelOf(x.key, x.rec)
          return id ? (
            <button key={i} type="button" className="rl-lnk"
              onClick={() => onOpen({ svc: s.svc, proj: s.proj, id, label })}>{label}</button>
          ) : <span key={i} className="rl-hint">{label}</span>
        })}
      </div>
    </RackField>
  ))
}

/** A record's second line, kind by kind: who, which. */
const subOf = (k, r) => (k === 'activities' ? [r.kind, r.place] : k === 'authors' ? [r.repEmail]
  : k === 'references' ? [r.citeKey] : k === 'todos' ? [r.title]
    : k === 'groups' ? [r.fullName] : k === 'assets' ? [r.assetId, r.location] : []).filter(Boolean).join(' · ')
/** Its date: an event's day (to its last), a note's, a to-do's due, a paper's year. */
const dateOf = (k, r) => (k === 'activities' ? [r.start, r.end && r.end !== r.start ? r.end : ''].filter(Boolean).join(' ~ ')
  : k === 'notes' ? r.date : k === 'todos' ? r.due : k === 'references' ? r.year : '') || ''
const KINDS = ['activities', 'authors', 'groups', 'references', 'assets', 'records', 'notes', 'todos']

/** The columns of a shared tag's own tab (sized and dragged like any list's),
 *  and what each sorts and filters by. */
export const TAGGED_COLS = [
  { k: 'num', w: 40, min: 30, fix: true, label: '#' },
  { k: 'svc', w: 120, min: 70, label: tr('rk_tg_service') },
  { k: 'kind', w: 80, min: 50, label: tr('rk_tg_kind') },
  { k: 'date', w: 170, min: 80, label: tr('rk_tg_date') },
  { k: 'what', w: 420, min: 120, label: tr('rk_tg_title') },
  { k: 'sub', w: 260, min: 80, label: tr('rk_tg_detail') },
]
export const TAGGED_SORTERS = Object.fromEntries(['svc', 'kind', 'date', 'what', 'sub'].map((k) => [k, (r) => r[k]]))

/** Everything wearing these names, whatever service it is in, a row each:
 *  what wears them all (`match` 'and') or any ('or') — and, for a project,
 *  whatever names it in its text (`mention`: `+STARK` in a note). null while
 *  asking. */
export function useTaggedRows(names, match = 'or', skip, mention = '') {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let on = true
    setRows(null)
    if (!names.length && !mention) { setRows([]); return undefined }
    Promise.all([...names.map(loadTagged), mention ? loadMentions(mention) : null]).then((got) => {
      if (!on) return
      const said = got.pop()
      // One map per name; then what is in all of them, or in any.
      const mapOf = (p) => {
        const m = new Map()
        for (const s of p) {
          if (s.svc === skip) continue
          for (const x of s.items) {
            const id = idOf(x.key, x.rec)
            m.set(`${s.svc}|${x.key}|${x.rec.id ?? x.rec.assetId}|${x.rec.line ?? ''}`, {
              svc: s.label, kind: KINDS.includes(x.key) ? tr(`rk_tk_${x.key}`) : x.key,
              date: String(dateOf(x.key, x.rec)), what: labelOf(x.key, x.rec), sub: subOf(x.key, x.rec),
              open: id && { svc: s.svc, proj: s.proj, id, label: labelOf(x.key, x.rec) } })
          }
        }
        return m
      }
      const maps = got.map(mapOf)
      const all = new Map(maps.flatMap((m) => [...m]))
      const rows = new Map([...all].filter(([k]) => match === 'or' || maps.every((m) => m.has(k))))
      if (said) for (const [k, r] of mapOf(said)) rows.set(k, r)
      setRows([...rows.values()])
    })
    return () => { on = false }
  }, [names.join('\u0001'), match, skip, mention])   // eslint-disable-line react-hooks/exhaustive-deps
  return rows
}

/** A shared tag's own tab — or a project's — one table of those rows, sorted
 *  and filtered like any rack list (the service holds the sort and the filter).
 *  The right click opens a record in a pane here (openRecord). */
export function RackTaggedTab({ rows, cols, onDrag, onOpen, sort, onSort, filter, mark }) {
  if (!rows) return <p className="rl-msg">…</p>
  return (
    <RackTable cols={cols} onDrag={onDrag} sort={sort} onSort={onSort} facet={filter.tableFacet}>
      <FacetRows f={filter} labels={{ empty: tr('rk_column_empty') }} />
      {!filter.mode && rows.map((r, i) => (
        <RackRow key={i} cols={cols} tone={{ what: 'ink', sub: 'dim', svc: 'dim', date: 'dim' }} className="rl-hit" mark={mark}
          onContextMenu={(e) => { e.preventDefault(); if (r.open) onOpen(r.open) }}
          cell={{ num: i + 1, svc: r.svc, kind: r.kind, date: r.date || '·', what: r.what, sub: r.sub || '·' }} />
      ))}
      {!filter.mode && rows.length === 0 && <p className="rl-msg">{tr('rk_none')}</p>}
    </RackTable>
  )
}
