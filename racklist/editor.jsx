import { useEffect, useMemo, useState } from 'react'
import { RackActions } from './actions.jsx'
import { RackField } from './fields.jsx'
import { typeOf } from './types.jsx'
import { ctxFor, labelOf, wornBy } from './schema.js'
import { newId } from './portal.js'

/**
 * The editor for one [항목] — or one stored [클래스] record — built from its
 * declared fields. Each field is its type's widget under its label, and the
 * bar at the foot is the kit's.
 *
 *   fields       what to show; the item's by default
 *   listKey      which list of the document the record lives in
 *   rec          the record, or null for a draft
 *   onSave(patch, said) → Promise<boolean>   the service's whole-document save
 *
 * A field with `edit: false` is shown in the table but not here (something the
 * service computes); `edit: (props) => node` replaces the widget for that one
 * field — the way out when a field needs something no type has.
 *
 * Deleting a record also unhooks every link in this document that pointed at
 * it, so a ref never points at nothing.
 */
export function RackItemEditor({
  def, doc, rec, fields: fieldsIn, listKey, noun, ctx: extra = {},
  onSave, onCreated, onDeleted, onRenamed, canDelete = true, actions,
}) {
  const fields = fieldsIn || def.item.fields
  const key = listKey || def.item.key
  const isItem = key === def.item.key
  const blank = useMemo(() => Object.fromEntries(fields.map((f) => [f.k, typeOf(f).empty()])), [fields])
  const draft = !rec
  const [f, setF] = useState(rec || blank)
  useEffect(() => { setF(rec || blank) }, [rec, blank])

  const tidy = (r) => {
    const out = { ...r }
    for (const fl of fields) out[fl.k] = typeOf(fl).tidy(r[fl.k], fl)
    return out
  }
  const label = isItem ? labelOf(def, f) : String(f.name || '')
  const missing = fields.filter((fl) => fl.required && !typeOf(fl).text(f[fl.k], ctxFor(def, doc, fl, extra)).trim())
  const what = noun || def.item.noun

  async function create() {
    if (missing.length) return
    const now = new Date().toISOString()
    const r = { ...tidy(f), id: newId(), createdAt: now, updatedAt: now }
    if (await onSave({ [key]: [r, ...(doc[key] || [])] }, `${what} '${label}' 등록됨`)) onCreated?.(r)
  }
  async function save() {
    const r = { ...tidy(f), updatedAt: new Date().toISOString() }
    const patch = { [key]: (doc[key] || []).map((x) => (x.id === r.id ? r : x)) }
    // A class record is pointed at BY NAME, so renaming it travels to every
    // item that wears it — or they would be wearing a name nobody has.
    if (!isItem && rec?.name && r.name !== rec.name) {
      const cls = def.classes.find((c) => c.k === key)
      const field = cls && wornBy(def, cls)
      if (field) {
        patch[def.item.key] = (doc[def.item.key] || []).map((it) => {
          const v = it[field.k]
          if (Array.isArray(v)) return v.includes(rec.name) ? { ...it, [field.k]: v.map((x) => (x === rec.name ? r.name : x)) } : it
          return v === rec.name ? { ...it, [field.k]: r.name } : it
        })
      }
    }
    if (await onSave(patch, `${what} '${label}' 저장됨`)) onRenamed?.(r)
  }
  async function remove() {
    const patch = { [key]: (doc[key] || []).filter((x) => x.id !== f.id) }
    // Links to it in this document go with it.
    if (isItem) {
      const refFields = def.item.fields.filter((fl) => (fl.type === 'ref' || fl.type === 'refs')
        && (!fl.to || fl.to === 'self' || fl.to === key))
      if (refFields.length) {
        patch[key] = patch[key].map((it) => {
          let out = it
          for (const fl of refFields) {
            const v = it[fl.k]
            if (Array.isArray(v) && v.some((l) => l?.id === f.id)) out = { ...out, [fl.k]: v.filter((l) => l?.id !== f.id) }
            else if (v?.id === f.id) out = { ...out, [fl.k]: null }
          }
          return out
        })
      }
    }
    if (await onSave(patch, `${what} '${label}' 삭제됨`)) onDeleted?.(f)
  }

  return (
    <div className="rl-edit">
      <div className="rl-rec">
        {fields.filter((fl) => fl.edit !== false).map((fl) => {
          const T = typeOf(fl)
          const c = ctxFor(def, doc, fl, extra)
          const set = (v) => setF((s) => ({ ...s, [fl.k]: v }))
          return (
            <RackField key={fl.k} label={fl.label}>
              {typeof fl.edit === 'function'
                ? fl.edit({ value: f[fl.k], onChange: set, rec: f, ctx: c })
                : <T.Edit value={f[fl.k]} onChange={set} field={fl} ctx={c} />}
              {fl.hint && fl.type !== 'check' && <span className="rl-hint">{fl.hint}</span>}
            </RackField>
          )
        })}
      </div>
      <RackActions key={f.id || 'draft'} draft={draft}
        onCreate={create} createDisabled={missing.length > 0}
        hint={missing.length ? `${missing.map((x) => x.label).join(', ')} 이(가) 있어야 합니다.` : ''}
        onSave={save} onRevert={() => setF(rec || blank)}
        onDelete={canDelete ? remove : undefined}
        extra={actions?.(f, setF)} />
    </div>
  )
}
