import './strings.js'
import { useEffect, useState } from 'react'
import { RackField } from './fields.jsx'
import { RackTable, RackRow } from './table.jsx'
import { loadTagged } from './tags.js'
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

/** A record's second line, kind by kind: when, who, which. */
const subOf = (k, r) => (k === 'activities' ? [r.start, r.kind] : k === 'authors' ? [r.repEmail]
  : k === 'references' ? [r.citeKey, r.year] : k === 'notes' ? [r.date] : k === 'todos' ? [r.title, r.due && `📅 ${r.due}`]
    : k === 'groups' ? [r.fullName] : k === 'assets' ? [r.assetId, r.location] : []).filter(Boolean).join(' · ')
const KINDS = ['activities', 'authors', 'groups', 'references', 'assets', 'records', 'notes', 'todos']

/** The columns of a shared tag's own tab (sized and dragged like any list's). */
export const TAGGED_COLS = [
  { k: 'num', w: 40, min: 30, fix: true, label: '#' },
  { k: 'svc', w: 150, min: 70, label: tr('rk_tg_service') },
  { k: 'kind', w: 90, min: 50, label: tr('rk_tg_kind') },
  { k: 'what', w: 440, min: 120, label: tr('rk_tg_title') },
  { k: 'sub', w: 280, min: 80, label: tr('rk_tg_detail') },
]

/** A shared tag's own tab: everything wearing it, whatever service it is in,
 *  one table. The right click opens a record in a pane here (openRecord). */
export function RackTaggedTab({ names, cols, onDrag, onOpen, skip }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let on = true
    setRows(null)
    Promise.all(names.map(loadTagged)).then((per) => {
      if (!on) return
      const seen = new Map()
      for (const p of per) for (const s of p) {
        if (s.svc === skip) continue
        for (const x of s.items) {
          const id = idOf(x.key, x.rec)
          seen.set(`${s.svc}|${x.key}|${x.rec.id ?? x.rec.assetId}|${x.rec.line ?? ''}`, {
            svc: s.label, kind: KINDS.includes(x.key) ? tr(`rk_tk_${x.key}`) : x.key,
            what: labelOf(x.key, x.rec), sub: subOf(x.key, x.rec),
            open: id && { svc: s.svc, proj: s.proj, id, label: labelOf(x.key, x.rec) } })
        }
      }
      setRows([...seen.values()])
    })
    return () => { on = false }
  }, [names.join('\u0001'), skip])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows) return <p className="rl-msg">…</p>
  return (
    <RackTable cols={cols} onDrag={onDrag}>
      {rows.map((r, i) => (
        <RackRow key={i} cols={cols} tone={{ what: 'ink', sub: 'dim', svc: 'dim' }} className="rl-hit"
          onContextMenu={(e) => { e.preventDefault(); if (r.open) onOpen(r.open) }}
          cell={{ num: i + 1, svc: r.svc, kind: r.kind, what: r.what, sub: r.sub || '·' }} />
      ))}
      {rows.length === 0 && <p className="rl-msg">{tr('rk_none')}</p>}
    </RackTable>
  )
}
