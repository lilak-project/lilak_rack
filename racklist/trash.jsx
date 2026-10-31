import './strings.js'
import { useCallback, useEffect, useState } from 'react'
import { PORTAL_BASE, authHeaders } from './portal.js'
import { labelOf } from './schema.js'
import { RackTable, RackRow } from './table.jsx'
import { tr } from '../i18n.jsx'

/**
 * The bin: what was deleted in the last 30 days (the store keeps it in
 * .trash/, GET /api/trash), newest first, each with a way back — a rack table
 * like every other list here, the button in its last column. Back, a record
 * goes to the top of its list as it was when it went. Opened from the button
 * at the foot of the screen (a manager's), as a tab of its own.
 */
export const TRASH_COLS = [
  { k: 'num', w: 40, min: 30, fix: true, label: '#' },
  { k: 'when', w: 140, min: 90, label: tr("rk_deleted_at") },
  { k: 'what', w: 90, min: 50, label: tr("rk_kind") },
  { k: 'name', w: 420, min: 120, label: tr("rk_name") },
  { k: 'by', w: 200, min: 60, label: tr("rk_deleted_by") },
  { k: 'act', w: 96, min: 80, fix: true },
]

export function RackTrash({ def, setDoc, say, cols = TRASH_COLS, onDrag }) {
  const [rows, setRows] = useState(null)
  const load = useCallback(() => {
    fetch(`${PORTAL_BASE}/api/trash`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((x) => setRows(Array.isArray(x) ? x : []))
      .catch(() => setRows([]))
  }, [])
  useEffect(() => { load() }, [load])

  const cls = (t) => def.classes.find((c) => c.k === t.key)
  const what = (t) => (t.key === def.item.key ? def.item.noun : cls(t)?.noun || t.key)
  const name = (t) => (t.key === def.item.key ? labelOf(def, t.record)
    : String((cls(t)?.rowLabel ? cls(t).rowLabel(t.record) : t.record.name) || t.record.id))
  const when = (s) => {
    const d = new Date(s)
    // 2026-10-21 22:33 — short enough for its column, and sorts as it reads.
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
  }

  async function restore(t) {
    const r = await fetch(`${PORTAL_BASE}/api/trash/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ key: t.key, id: t.record.id }),
    })
    if (!r.ok) { say(tr("rk_restore_failed", r.status)); return }
    setDoc(await r.json())
    say(tr("rk_restored", what(t), name(t)))
    load()
  }

  if (!rows) return <p className="rl-msg">{tr("rk_trash_loading")}</p>
  return (
    <RackTable cols={cols} onDrag={onDrag}>
      {rows.map((t, i) => (
        <RackRow key={`${t.key}:${t.record.id}`} cols={cols} tone={{ name: 'ink', when: 'dim', by: 'dim' }}
          cell={{ num: i + 1, when: when(t.deletedAt), what: what(t), name: name(t), by: t.by || '·',
            act: <button type="button" className="rl-btn" onClick={() => restore(t)}>{tr("rk_restore")}</button> }} />
      ))}
      <p className="rl-msg">{rows.length ? tr("rk_trash_hint") : `${tr("rk_trash_empty")} ${tr("rk_trash_hint")}`}</p>
    </RackTable>
  )
}
