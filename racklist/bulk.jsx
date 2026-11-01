import './strings.js'
import { useEffect, useMemo, useState } from 'react'
import { RackActions } from './actions.jsx'
import { RackField } from './fields.jsx'
import { typeOf } from './types.jsx'
import { ctxFor, labelOf, linkKey, isRef } from './schema.js'
import { dropItems } from './editor.jsx'
import { tr } from '../i18n.jsx'

/**
 * Editing several items at once — the ones picked in the table.
 *
 * Only what records SHARE is offered: a title belongs to one record, but "all
 * of these were at RIKEN" or "tag all of these STARK" is one fact said many
 * times. The kinds of field that are shared by nature — a choice, a class, a
 * tag, a date, a check, a link — are offered unless a field says `bulk: false`;
 * any other field can opt in with `bulk: true`.
 *
 * The rule in every field is the same (author_manager's): what is shown is
 * what they all have, and a field left alone changes nothing. Where they
 * differ the field is empty and says so — set it and they all get it. A field
 * holding several values (tags, links) shows those they all have; adding one
 * adds it to each, taking one off takes it off each, and one only some have
 * can be taken off them too.
 */
const SHARED = ['select', 'class', 'classes', 'tags', 'check', 'date', 'number', 'ref', 'refs']
export const bulkFields = (def) => def.item.fields.filter((f) => !f.get && f.store !== false
  && f.bulk !== false && !f.when && (f.bulk === true || (SHARED.includes(f.type) && !f.required)))

const many = (f) => Array.isArray(typeOf(f).empty())
const keyOf = (f, x) => (isRef(f) ? linkKey(x) : String(x))
const list = (v) => (Array.isArray(v) ? v : (v === null || v === undefined || v === '' ? [] : [v]))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function RackBulkEditor({ def, doc, ids, ctx = {}, onSave, onCancel, canDelete, onDeleted }) {
  const idk = def.item.id || 'id'
  const recs = useMemo(() => (doc[def.item.key] || []).filter((r) => ids.includes(r[idk])), [doc, def, ids, idk])
  const fields = useMemo(() => bulkFields(def), [def])

  /** For each field, what they all have — and for many-valued ones, also what
   *  only some have, with how many. */
  const base = useMemo(() => {
    const out = {}
    for (const f of fields) {
      if (many(f)) {
        const counts = new Map()
        for (const r of recs) {
          for (const x of new Map(list(r[f.k]).map((x) => [keyOf(f, x), x])).values()) {
            const k = keyOf(f, x)
            counts.set(k, { x, n: (counts.get(k)?.n || 0) + 1 })
          }
        }
        out[f.k] = {
          all: [...counts.values()].filter((c) => c.n === recs.length).map((c) => c.x),
          some: [...counts.entries()].filter(([, c]) => c.n < recs.length).map(([k, c]) => ({ k, ...c })),
        }
      } else {
        const v0 = recs[0]?.[f.k]
        out[f.k] = recs.every((r) => same(r[f.k], v0)) ? { one: v0 } : { mixed: true }
      }
    }
    return out
  }, [fields, recs])

  const [vals, setVals] = useState({})        // what the form says, per field
  const [touched, setTouched] = useState(new Set())
  const [drop, setDrop] = useState({})        // many-valued: keys taken off those that had them
  const reset = () => { setVals({}); setTouched(new Set()); setDrop({}) }
  useEffect(reset, [ids.join(',')])   // eslint-disable-line react-hooks/exhaustive-deps

  const valueOfF = (f) => (touched.has(f.k) ? vals[f.k]
    : many(f) ? base[f.k].all : (base[f.k].mixed ? typeOf(f).empty() : base[f.k].one))
  const set = (f, v) => { setVals((s) => ({ ...s, [f.k]: v })); setTouched((s) => new Set(s).add(f.k)) }
  const dirty = touched.size > 0 || Object.values(drop).some((s) => s.length)

  async function save() {
    const now = new Date().toISOString()
    const change = (r) => {
      let out = { ...r }
      for (const f of fields) {
        const T = typeOf(f)
        if (many(f)) {
          const was = new Set(base[f.k].all.map((x) => keyOf(f, x)))
          const cur = touched.has(f.k) ? list(vals[f.k]) : base[f.k].all
          const now2 = new Set(cur.map((x) => keyOf(f, x)))
          const off = new Set([...[...was].filter((k) => !now2.has(k)), ...(drop[f.k] || [])])
          const add = cur.filter((x) => !was.has(keyOf(f, x)))
          if (!off.size && !add.length) continue
          const kept = list(r[f.k]).filter((x) => !off.has(keyOf(f, x)))
          const have = new Set(kept.map((x) => keyOf(f, x)))
          out[f.k] = T.tidy([...kept, ...add.filter((x) => !have.has(keyOf(f, x)))], f)
        } else if (touched.has(f.k)) {
          out[f.k] = T.tidy(vals[f.k], f)
        }
      }
      if (same(out, r)) return r
      out = def.item.fill ? def.item.fill(out, doc) : out
      return { ...out, updatedAt: now }
    }
    const items = (doc[def.item.key] || []).map((r) => (ids.includes(r[idk]) ? change(r) : r))
    const n = items.filter((r, i) => r !== doc[def.item.key][i]).length
    // save saves: the selection is still the selection, and the next thing to
    // set for all of them is in the form you are looking at.
    if (await onSave({ [def.item.key]: items }, tr("rk_saved_many", n, def.unit))) reset()
  }
  async function removeAll() {
    if (await onSave(dropItems(def, doc, recs), tr("rk_deleted_many", recs.length, def.unit))) onDeleted?.(recs)
  }

  if (!recs.length) return <p className="rl-msg">{tr("rk_none_selected", def.item.noun)}</p>
  return (
    <div className="rl-edit">
      <RackActions key={ids.join(',')} onSave={save} saveDisabled={!dirty} onCancel={onCancel}
        onRevert={reset} hint={dirty ? '' : tr("rk_only_changed_apply")}
        onDelete={canDelete ? removeAll : undefined}
        deleteWarn={tr("rk_delete_selected_warn", recs.length, def.unit)} />
      <div className="rl-rec">
        <RackField label={tr("rk_targets")}>
          <div className="rl-rows">
            <span className="rl-hint">{recs.length}{def.unit}</span>
            <div className="rl-rrow" style={{ flexWrap: 'wrap' }}>
              {recs.slice(0, 20).map((r) => (
                <button key={r[idk]} type="button" className="rl-tag rl-lnk" onClick={() => ctx.openItem?.(r[idk])}>
                  {labelOf(def, r)}
                </button>
              ))}
              {recs.length > 20 && <span className="rl-hint">{tr("rk_and_more", recs.length - 20, def.unit)}</span>}
            </div>
          </div>
        </RackField>
        {fields.map((f) => {
          const T = typeOf(f)
          const c = ctxFor(def, doc, f, { ...ctx, rec: {} })
          const b = base[f.k]
          return (
            <RackField key={f.k} label={f.label}>
              <div className="rl-rows">
                <div className="rl-rrow">
                  <T.Edit value={valueOfF(f)} onChange={(v) => set(f, v)} field={f} ctx={c} rec={{}} patch={() => {}} />
                  {touched.has(f.k) && (
                    <button type="button" className="rl-x" title={tr("rk_leave_field")}
                      onClick={() => setTouched((s) => { const n = new Set(s); n.delete(f.k); return n })}>↺</button>
                  )}
                </div>
                {!many(f) && b.mixed && !touched.has(f.k) && <span className="rl-hint">{tr("rk_mixed_set_all")}</span>}
                {!many(f) && touched.has(f.k) && <span className="rl-hint">{tr("rk_all_become")}</span>}
                {many(f) && b.some.length > 0 && (
                  <div className="rl-rrow" style={{ flexWrap: 'wrap' }}>
                    <span className="rl-hint">{tr("rk_only_some")}</span>
                    {b.some.map(({ k, x, n }) => {
                      const off = (drop[f.k] || []).includes(k)
                      return (
                        <span key={k} className="rl-tag" style={off ? { opacity: 0.45, textDecoration: 'line-through' } : null}>
                          {T.text([x], c) || k} <span className="rl-hint">{n}/{recs.length}</span>
                          <button type="button" className="rl-x" title={off ? tr("rk_undo") : tr("rk_take_off_from", n, def.unit)}
                            onClick={() => setDrop((s) => ({ ...s, [f.k]: off ? (s[f.k] || []).filter((y) => y !== k) : [...(s[f.k] || []), k] }))}>
                            {off ? '↺' : '×'}
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            </RackField>
          )
        })}
        {fields.length === 0 && <p className="rl-msg">{tr("rk_no_shared_fields")}</p>}
      </div>
    </div>
  )
}
