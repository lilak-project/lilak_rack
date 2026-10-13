import { useEffect, useMemo, useState } from 'react'
import { RackActions } from './actions.jsx'
import { RackField } from './fields.jsx'
import { typeOf } from './types.jsx'
import { ctxFor, labelOf, wornBy, valueOf } from './schema.js'
import { useRackKeys } from './hooks.js'
import { newId } from './portal.js'

/**
 * The editor for one [항목] — or one stored [클래스] record — built from its
 * declared fields. Each field is its type's widget under its label, and the
 * kit's bar sits at the top.
 *
 *   fields       what to show; the item's by default
 *   cls          the class, when the record is one of a stored class's
 *   rec          the record, or null for a draft
 *   onSave(patch, said) → Promise<boolean>   the service's whole-document save
 *
 * A widget is handed the value and, besides, the whole record (`rec`), a way
 * to change several fields at once (`patch`) and whether it is a draft — what
 * a cite key worked out from the other fields, or a paste box that fills them,
 * needs.
 *
 * A field with `edit: false` is shown in the table but not here; `edit:
 * (props) => node` replaces the widget for that one field. A computed field
 * (`get`) is left out unless its type can Show it (a folder, a cited-by list).
 * `when(rec, { draft })` shows a field only then; `store: false` is a helper
 * that is never saved; `default` is what a new record starts with.
 *
 * Deleting a record also unhooks every link in this document that pointed at
 * it, so a ref never points at nothing.
 */
/** Taking items out of the document, and every trace of them with them: links
 *  from other items (refs to this list, and any type that can let go of an id
 *  — a citation row keeps its text), and their places in lists. */
export function dropItems(def, doc, recs) {
  const key = def.item.key
  const gone = new Set(recs.map((r) => r.id))
  let items = (doc[key] || []).filter((x) => !gone.has(x.id))
  const hooked = def.item.fields.filter((fl) => typeOf(fl).unlink
    || ((fl.type === 'ref' || fl.type === 'refs') && (!fl.to || fl.to === 'self' || fl.to === key)))
  if (hooked.length) {
    items = items.map((it) => {
      let out = it
      for (const fl of hooked) {
        const T = typeOf(fl)
        for (const id of gone) {
          const v = out[fl.k]
          if (T.unlink) { const next = T.unlink(v, id); if (next !== v) out = { ...out, [fl.k]: next } }
          else if (Array.isArray(v) && v.some((l) => l?.id === id)) out = { ...out, [fl.k]: v.filter((l) => l?.id !== id) }
          else if (v?.id === id) out = { ...out, [fl.k]: null }
        }
      }
      return out
    })
  }
  const patch = { [key]: items }
  const idk = def.item.id || 'id'
  const goneKeys = new Set(recs.map((r) => r[idk]))
  for (const c of def.classes.filter((x) => x.list)) {
    patch[c.k] = (doc[c.k] || []).map((l) => (
      (l[c.list.ids] || []).some((id) => goneKeys.has(id))
        ? { ...l, [c.list.ids]: l[c.list.ids].filter((id) => !goneKeys.has(id)) } : l))
  }
  return patch
}

export function RackItemEditor({
  def, doc, rec, fields: fieldsIn, listKey, noun, cls, ctx: extra = {},
  onSave, onCreated, onDeleted, onRenamed, onCancel, canDelete = true, actions,
}) {
  const fields = fieldsIn || def.item.fields
  const key = listKey || def.item.key
  const isItem = key === def.item.key
  const own = isItem ? def.item : (cls || {})
  const blank = useMemo(() => Object.fromEntries(fields.filter((f) => !f.get && f.store !== false)
    .map((f) => [f.k, f.default ?? typeOf(f).empty()])), [fields])
  const draft = !rec
  const [f, setF] = useState(rec || blank)
  useEffect(() => { setF(rec || blank) }, [rec, blank])

  const tidy = (r) => {
    const out = { ...r }
    for (const fl of fields) {
      if (fl.get || fl.store === false) { delete out[fl.k]; continue }   // computed or a helper: never stored
      out[fl.k] = typeOf(fl).tidy(r[fl.k], fl)
    }
    // What a record can work out for itself — a naming rule — fills in last.
    return own.fill ? own.fill(out, doc) : out
  }
  const label = isItem ? labelOf(def, f) : String((cls?.rowLabel ? cls.rowLabel(f) : f.name) || '')
  const missing = fields.filter((fl) => fl.required && !typeOf(fl).text(f[fl.k], ctxFor(def, doc, fl, extra)).trim())
  const why = missing.length ? `${missing.map((x) => x.label).join(', ')} 이(가) 있어야 합니다.`
    : (own.check ? own.check(tidy(f), doc, rec) || '' : '')
  const what = noun || def.item.noun
  // The record in the document this form edits. Records older than the kit
  // may have no id (a journal is known by its name), so it is the record
  // itself that is looked for, not an id every one of them would share.
  const same = (x) => (rec?.id ? x.id === rec.id : x === rec)

  // ⌘S saves and stays; leaving is ⌘X's.
  useRackKeys({ onSave: () => (draft ? create() : save()) })

  async function create() {
    if (why) return
    const now = new Date().toISOString()
    const r = { ...tidy(f), id: newId(), createdAt: now, updatedAt: now }
    const patch = { [key]: [r, ...(doc[key] || [])] }
    Object.assign(patch, own.onSave?.(r, null, { ...doc, ...patch }) || {})
    if (await onSave(patch, `${what} '${label}' 등록됨`)) onCreated?.(r)
  }
  async function save() {
    if (why) return
    const r = { ...tidy(f), updatedAt: new Date().toISOString() }
    const patch = { [key]: (doc[key] || []).map((x) => (same(x) ? r : x)) }
    // A class record pointed at BY NAME: renaming it travels to every item
    // that wears it — or they would be wearing a name nobody has.
    if (!isItem && cls?.keyBy !== 'id' && rec?.name && r.name !== rec.name) {
      const field = cls && wornBy(def, cls)
      if (field) {
        patch[def.item.key] = (doc[def.item.key] || []).map((it) => {
          const v = it[field.k]
          if (Array.isArray(v)) return v.includes(rec.name) ? { ...it, [field.k]: v.map((x) => (x === rec.name ? r.name : x)) } : it
          return v === rec.name ? { ...it, [field.k]: r.name } : it
        })
      }
    }
    Object.assign(patch, own.onSave?.(r, rec, { ...doc, ...patch }) || {})
    if (await onSave(patch, `${what} '${label}' 저장됨`)) onRenamed?.(r)
  }
  async function remove() {
    const patch = isItem ? dropItems(def, doc, [f]) : { [key]: (doc[key] || []).filter((x) => !same(x)) }
    Object.assign(patch, own.onDelete?.(f, { ...doc, ...patch }) || {})
    if (await onSave(patch, `${what} '${label}' 삭제됨`)) onDeleted?.(f)
  }

  const shown = fields.filter((fl) => fl.edit !== false && (!fl.get || typeOf(fl).Show)
    && (!fl.when || fl.when(f, { draft, doc })))
  const patchF = (o) => setF((s) => ({ ...s, ...o }))

  return (
    <div className="rl-edit">
      {/* First, and stuck to the top of the pane: the record is as long as it
          is, and what you do to it is always in the same place. */}
      <RackActions key={f.id || 'draft'} draft={draft}
        onCreate={create} createDisabled={!!why} saveDisabled={!!why}
        hint={why}
        onSave={save} onCancel={onCancel} onRevert={() => setF(rec || blank)}
        onDelete={canDelete ? remove : undefined}
        deleteWarn={own.deleteWarn ? own.deleteWarn(f, doc) : undefined}
        extra={actions?.(f, setF)} />
      <div className="rl-rec">
        {shown.map((fl) => {
          const T = typeOf(fl)
          const c = ctxFor(def, doc, fl, { ...extra, rec: f, draft })
          const set = (v) => setF((s) => ({ ...s, [fl.k]: v }))
          const props = { value: fl.get ? valueOf(fl, f, c) : f[fl.k], onChange: set, field: fl, ctx: c,
            rec: f, patch: patchF, draft }
          return (
            <RackField key={fl.k} label={fl.label}>
              {fl.get ? <T.Show {...props} />
                : typeof fl.edit === 'function' ? fl.edit(props)
                  : <T.Edit {...props} />}
              {fl.hint && fl.type !== 'check' && <span className="rl-hint">{fl.hint}</span>}
            </RackField>
          )
        })}
      </div>
    </div>
  )
}
