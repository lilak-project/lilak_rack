import { useEffect, useMemo, useRef, useState } from 'react'
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
/** Fields in a row with the same `group` share one line of the form. */
function segments(fields) {
  const out = []
  for (const fl of fields) {
    const last = out[out.length - 1]
    if (fl.group && last?.group === fl.group) last.fields.push(fl)
    else out.push({ group: fl.group || '', fields: [fl] })
  }
  return out
}

/** Taking items out of the document, and every trace of them with them: links
 *  from other items (refs to this list, and any type that can let go of an id
 *  — a citation row keeps its text), and their places in lists. */
export function dropItems(def, doc, recs) {
  const key = def.item.key
  // The records themselves are what go — not "whatever has this id", which is
  // every record when they have none (assets are known by their 자산번호).
  const drop = new Set(recs)
  const gone = new Set(recs.map((r) => r.id).filter(Boolean))     // what links point at
  let items = (doc[key] || []).filter((x) => !drop.has(x))
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
  onSave, onCreated, onDeleted, onRenamed, onCancel, canDelete = true, actions, seed,
}) {
  const fields = fieldsIn || def.item.fields
  const key = listKey || def.item.key
  const isItem = key === def.item.key
  const own = isItem ? def.item : (cls || {})
  const blank = useMemo(() => Object.fromEntries(fields.filter((f) => !f.get && f.store !== false)
    .map((f) => [f.k, f.default ?? typeOf(f).empty()])), [fields])
  const draft = !rec
  // A draft may start with values already in it (a day picked on a calendar).
  const fresh = useMemo(() => ({ ...blank, ...(seed || {}) }), [blank, seed])
  const [f, setF] = useState(rec || fresh)
  // The form as the document last had it, and as it was when it was opened.
  const saved = useRef(rec || fresh)
  const opened = useRef(rec || fresh)
  const fRef = useRef(f)
  fRef.current = f
  const same_ = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  // The record changed in the document (a save landed, someone else saved):
  // take it — unless you are in the middle of changing it, which wins.
  useEffect(() => {
    if (same_(fRef.current, saved.current)) setF(rec || fresh)
    saved.current = same_(fRef.current, saved.current) ? (rec || fresh) : saved.current
  }, [rec, fresh])   // eslint-disable-line react-hooks/exhaustive-deps

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
  useRackKeys({ onSave: () => (draft ? create() : save(false)) })

  async function create() {
    if (why) return
    const now = new Date().toISOString()
    const r = { ...tidy(f), id: newId(), createdAt: now, updatedAt: now }
    const patch = { [key]: [r, ...(doc[key] || [])] }
    Object.assign(patch, own.onSave?.(r, null, { ...doc, ...patch }) || {})
    if (await onSave(patch, `${what} '${label}' 등록됨`)) onCreated?.(r)
  }
  async function save(auto) {
    if (why) return
    const snap = f
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
    if (await onSave(patch, `${what} '${label}' ${auto ? '자동 ' : ''}저장됨`)) {
      saved.current = snap
      onRenamed?.(r)
    }
  }

  // Saving is not a step you take: a record you change saves itself a moment
  // after you stop, and before its editor closes. A draft still waits for 등록
  // (a half-filled form is not yet a record), and a record that fails its
  // checks waits, saying why.
  const dirty = !draft && !same_(f, saved.current)
  useEffect(() => {
    if (!dirty || why) return undefined
    const t = setTimeout(() => save(true), 800)
    return () => clearTimeout(t)
  }, [f, rec])   // eslint-disable-line react-hooks/exhaustive-deps
  const flush = useRef(null)
  flush.current = () => { if (dirty && !why) save(true) }
  useEffect(() => () => flush.current?.(), [])
  async function remove() {
    const patch = isItem ? dropItems(def, doc, [rec]) : { [key]: (doc[key] || []).filter((x) => !same(x)) }
    // Items pointing at it by id keep its name, as text — the way a name
    // typed before it had a record reads.
    const field = !isItem && cls?.keyBy === 'id' && rec?.id && wornBy(def, cls)
    if (field && (field.type === 'class' || field.type === 'classes')) {
      const as = (v) => (v === rec.id ? rec.name || '' : v)
      patch[def.item.key] = (doc[def.item.key] || []).map((it) => {
        const v = it[field.k]
        if (Array.isArray(v)) return v.includes(rec.id) ? { ...it, [field.k]: v.map(as) } : it
        return v === rec.id ? { ...it, [field.k]: as(v) } : it
      })
    }
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
        hint={why || (dirty ? '바뀐 것을 곧 저장합니다…' : '')}
        onSave={() => save(false)} onCancel={onCancel} onRevert={() => setF(opened.current)}
        onDelete={canDelete ? remove : undefined}
        deleteWarn={own.deleteWarn ? own.deleteWarn(f, doc) : undefined}
        extra={actions?.(f, setF)} />
      <div className="rl-rec">
        {segments(shown).map((seg) => {
          // One labelled line per field — or per group of fields that say one
          // thing between them (성 · 이름), each widget then named by its own label.
          const widget = (fl) => {
            const T = typeOf(fl)
            const c = ctxFor(def, doc, fl, { ...extra, rec: f, draft })
            const set = (v) => setF((s) => ({ ...s, [fl.k]: v }))
            const field = seg.group ? { placeholder: fl.label, ...fl } : fl
            const props = { value: fl.get ? valueOf(fl, f, c) : f[fl.k], onChange: set, field, ctx: c,
              rec: f, patch: patchF, draft }
            return fl.get ? <T.Show key={fl.k} {...props} />
              : typeof fl.edit === 'function' ? <span key={fl.k} style={{ display: 'contents' }}>{fl.edit(props)}</span>
                : <T.Edit key={fl.k} {...props} />
          }
          const hints = seg.fields.filter((fl) => fl.hint && fl.type !== 'check').map((fl) => fl.hint)
          return (
            <RackField key={seg.fields[0].k} label={seg.group || seg.fields[0].label}>
              {seg.fields.map(widget)}
              {hints.map((h) => <span key={h} className="rl-hint">{h}</span>)}
            </RackField>
          )
        })}
      </div>
    </div>
  )
}
