import './strings.js'
import { useCallback, useEffect, useState } from 'react'
import { PORTAL_BASE, authHeaders } from './portal.js'
import { labelOf } from './schema.js'
import { tr } from '../i18n.jsx'

/**
 * The bin: what was deleted in the last 30 days (the store keeps it in
 * .trash/, GET /api/trash), newest first, each with a way back. Back, a
 * record goes to the top of its list as it was when it went.
 */
export function RackTrash({ def, setDoc, say }) {
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
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
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
    <div className="rl-trash">
      <p className="rl-hint">{tr("rk_trash_hint")}</p>
      {rows.length === 0 ? <p className="rl-msg">{tr("rk_trash_empty")}</p> : (
        <table>
          <thead><tr><th>{tr("rk_deleted_at")}</th><th>{tr("rk_kind")}</th><th>{tr("rk_name")}</th><th>{tr("rk_deleted_by")}</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={`${t.key}:${t.record.id}`}>
                <td>{when(t.deletedAt)}</td>
                <td>{what(t)}</td>
                <td>{name(t)}</td>
                <td className="rl-hint">{t.by || ''}</td>
                <td><button type="button" className="rl-btn" onClick={() => restore(t)}>{tr("rk_restore")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
