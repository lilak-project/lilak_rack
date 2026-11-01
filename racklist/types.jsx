import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './strings.js'
import { tr, currentLang } from '../i18n.jsx'
import { RackTextRows } from './fields.jsx'
import { authHeaders, openInService, serviceColor } from './portal.js'
import { useSharedTags, spellTag, tagKey, uniqueTags } from './tags.js'
import { parseRule, describe, withUntil, withCount, withoutEnd, DAYS, dow, nth } from './rrule.js'

/**
 * Field types — what a property of an [항목] IS, said once.
 *
 * A rack-list service used to spell every field four times: a table cell, a
 * sort key, a search term and an editor widget, each by hand, each drifting
 * from the others. A type answers all four from one place:
 *
 *   empty()                     what a new record starts with
 *   text(v, ctx)                the plain words — search, facets, listing tokens
 *   sort(v, ctx)                what a column sorts by (default: text)
 *   cell(v, ctx)                what the table shows (default: text)
 *   Edit({ value, onChange, field, ctx })   the widget in the editor
 *   tidy(v)                     what is kept on save — half-typed rows go
 *
 * `ctx` carries what a type may need to look at: the document (`doc`), the
 * service declaration (`def`), the field itself, and `say` for the note line.
 *
 * registerType(name, type) is the way OUT: a service whose field is not one of
 * these (a LaTeX author block, a PDF on disk) registers its own and uses it by
 * name like any other. Nothing in the kit has to know about it.
 */

const D = '·'
const str = (v) => (v === null || v === undefined ? '' : String(v))
const list = (v) => (Array.isArray(v) ? v : (v ? [v] : []))
const nonBlank = (xs) => list(xs).map((x) => str(x).trim()).filter(Boolean)

const REGISTRY = {}
export function registerType(name, type) {
  REGISTRY[name] = { ...BASE, ...type }
}
export function typeOf(field) {
  if (field?.type && typeof field.type === 'object') return { ...BASE, ...field.type }
  return REGISTRY[field?.type] || REGISTRY.text
}

const BASE = {
  empty: () => '',
  text: (v) => str(v),
  sort(v, ctx) { return this.text(v, ctx) },
  cell(v, ctx) { return this.text(v, ctx) || D },
  tidy: (v) => v,
}

// ─── one value ────────────────────────────────────────────────────────────
/** `grow`: as wide as the line leaves it (what is typed is text, and long). */
function Input({ value, onChange, field, type = 'text', width, grow, placeholder, inputMode, maxLength }) {
  return (
    <input className={`rl-in${field.mono ? ' rl-mono' : ''}`} type={type} inputMode={inputMode} maxLength={maxLength}
      style={field.width ? { width: field.width } : grow ? { flex: '1 1 220px', minWidth: 0 } : { width }}
      value={str(value)}
      placeholder={placeholder || field.placeholder || ''}
      onChange={(e) => onChange(e.target.value)} />
  )
}

/** `href: (v) => url` puts a link beside it (a doi → doi.org). `make: (rec)
 *  => value` puts a button beside it that writes the value by a rule (a name
 *  from the kind, the date and the title); `makeLabel` names the button. */
registerType('text', {
  Edit: (p) => {
    const made = p.field.make ? str(p.field.make(p.rec || {})) : ''
    return (
      <>
        <Input {...p} grow />
        {p.field.href && str(p.value).trim() && (
          <a className="rl-hint" href={p.field.href(str(p.value).trim())} target="_blank" rel="noreferrer">{tr("rk_open")}</a>
        )}
        {p.field.make && (
          <button type="button" className="rl-btn" disabled={!made || made === str(p.value)}
            title={made || tr("rk_rule_values_empty")} onClick={() => p.onChange(made)}>{p.field.makeLabel || tr("rk_generate")}</button>
        )}
      </>
    )
  },
  tidy: (v) => str(v).trim(),
})

registerType('longtext', {
  cell: (v) => (str(v).split('\n')[0] || D),
  Edit: (p) => <GrowText {...p} />,
})

/** A text box as tall as its lines — it grows as you type, not by dragging. */
function GrowText({ value, onChange, field }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`   // + its borders
  }, [value])
  return (
    <textarea ref={ref} className="rl-in rl-grow" rows={field.rows || 2} style={{ width: '100%', minWidth: 260 }}
      value={str(value)} placeholder={field.placeholder || ''}
      onChange={(e) => onChange(e.target.value)} />
  )
}

registerType('number', {
  // Numbers sort as numbers: 9 before 10, and a blank last rather than first.
  sort: (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v)),
  Edit: (p) => <Input {...p} type="number" width={100} />,
  tidy: (v) => (v === '' || v === null || v === undefined ? '' : Number(v)),
})

/** '과' after a final consonant, '와' after a vowel: 행사 시작과, 마감일과… */
const withGwa = (w) => {
  if (currentLang() !== 'ko') return str(w)          // other languages carry no particle
  const c = str(w).trim().slice(-1).charCodeAt(0)
  return `${w}${c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? '과' : '와'}`
}

/** `same: 'start'` puts a button beside it that copies that field's date —
 *  a talk on the first day, a trip as long as the meeting; `same: ['start',
 *  'end']` puts one for each. */
registerType('date', {
  // ISO dates already sort as text; the cell keeps the date part only.
  text: (v) => str(v).slice(0, 10),
  Edit: (p) => {
    const froms = [p.field.same].flat().filter(Boolean)
    const fields = p.ctx?.def?.item?.fields || []
    return (
      <>
        <Input {...p} type="date" width={150} />
        {froms.map((from) => {
          const src = fields.find((f) => f.k === from)
          const v = str(p.rec?.[from])
          return (
            <button key={from} type="button" className="rl-btn" disabled={!v || v === str(p.value)}
              title={v ? `${v}` : tr("rk_is_empty", src?.label || from)}
              onClick={() => p.onChange(v)}>{tr("rk_same_as", withGwa(src?.label || from))}</button>
          )
        })}
      </>
    )
  },
})

/** A time of day, 'HH:MM' — what sorts as text, as a date does. */
// Typed, not the browser's picker, which shows 오후 02:30 by the OS locale:
// 930, 0930, 9:30 and 14.30 all become 09:30 / 14:30 when saved; 14 → 14:00.
const hhmm = (v) => {
  const t = str(v).trim()
  const m = t.match(/^(\d{1,2})(?:\D?(\d{2}))?$/)
  return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : t
}
registerType('time', {
  Edit: (p) => <Input {...p} width={64} placeholder="--:--" inputMode="numeric" maxLength={5} />,
  tidy: hhmm,
})

/** `short: 'link'` shows that word in the table instead of the address —
 *  a column that says whether there is one, and takes you there. */
registerType('url', {
  cell: (v, ctx) => (str(v) ? (
    <a className="rl-lnk" href={str(v)} target="_blank" rel="noreferrer" title={str(v)}
      onClick={(e) => e.stopPropagation()}>{ctx.field?.short || str(v).replace(/^https?:\/\//, '').slice(0, 40)}</a>
  ) : D),
  Edit: ({ value, onChange, field }) => (
    <>
      <Input value={value} onChange={onChange} field={field} type="url" grow />
      {/^https?:\/\//.test(str(value))
        ? <a className="rl-btn" href={str(value)} target="_blank" rel="noreferrer">{tr("rk_open")}</a>
        : <button type="button" className="rl-btn" disabled>{tr("rk_open")}</button>}
    </>
  ),
})

registerType('email', { Edit: (p) => <Input {...p} type="email" grow /> })

registerType('check', {
  empty: () => false,
  text: (v) => (v ? '✓' : ''),
  Edit: ({ value, onChange, field }) => (
    <label className="rl-hint">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.hint || ''}
    </label>
  ),
})

/** One of a fixed set — `options: ['paper', 'thesis']` or [[value, label]];
 *  `{ group, options }` among them is a run of options under a heading. */
const flatOptions = (opts) => (opts || []).flatMap((o) => (o?.group ? o.options : [o]))
const option = (o) => {
  const [v, l] = Array.isArray(o) ? o : [o, o]
  return <option key={v} value={v}>{l}</option>
}
registerType('select', {
  text(v, ctx) {
    const o = flatOptions(ctx.field.options).find((x) => (Array.isArray(x) ? x[0] : x) === v)
    return Array.isArray(o) ? o[1] : str(v)
  },
  // A value no longer among the options (a kind since taken out) still shows,
  // marked, rather than reading as empty.
  Edit: ({ value, onChange, field }) => {
    const gone = str(value) && !flatOptions(field.options).some((o) => (Array.isArray(o) ? o[0] : o) === str(value))
    return (
      <>
        <select className="rl-in" value={str(value)} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">—</option>}
          {(field.options || []).map((o) => (o?.group
            ? <optgroup key={o.group} label={o.group}>{o.options.map(option)}</optgroup>
            : option(o)))}
          {gone && <option value={str(value)}>{str(value)}</option>}
        </select>
        {gone && <span className="rl-hint rl-warn">{tr("rk_not_in_list", field.label || tr("rk_value"))}</span>}
      </>
    )
  },
})

// ─── names a record wears ─────────────────────────────────────────────────
/** The names already in use for this field (or in the class it points at),
 *  offered when typing — a tag or a class is a word others already use, not a
 *  thing to create first. */
function namesFor(field, ctx) {
  const recs = field.of ? (ctx.doc?.[field.of] || []) : []
  const fromClass = recs.map((r) => r.name).filter(Boolean)
  const items = ctx.doc?.[ctx.def?.item?.key] || []
  const used = items.flatMap((r) => list(r[field.k])).map((v) => nameOf(field, ctx, v))
  return [...new Set([...fromClass, ...used.map(str).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'ko'))
}

/** The class record a value points at: by id — or, for a name typed before
 *  it had a record (or data from before ids), by name. */
export function classRec(field, ctx, v) {
  if (!field?.of || v === null || v === undefined || v === '') return null
  const recs = ctx.doc?.[field.of] || []
  return recs.find((r) => r.id && r.id === v) || recs.find((r) => r.name === v) || null
}
/** What a value is called: its record's name, or the text itself. */
export const nameOf = (field, ctx, v) => classRec(field, ctx, v)?.name || str(v)
/** What a chip wears: the field's `show` field when it names one, else the
 *  name. A journal's full title is three lines wide; its shortName is not. */
const shownAs = (field, ctx, v) =>
  (field.show && classRec(field, ctx, v)?.[field.show]) || nameOf(field, ctx, v)
/** What to store for a name typed or picked: the record's id when it has one. */
const storedFor = (field, ctx, t) => {
  const rec = field?.of && (ctx.doc?.[field.of] || []).find((r) => r.name === t)
  return rec?.id || t
}

/** Chips, a box to add one, and the names in use on offer. Leaving the box is
 *  as good as pressing the button: a name typed and then saved used to vanish
 *  without a word. */
function Chips({ value, onChange, field, ctx, single, shared }) {
  const [add, setAdd] = useState('')
  const vals = list(value)
  // Tags (`shared` given): this service's and every other's, one per tag
  // whatever its case — and a tag typed takes the spelling already in use.
  const options = useMemo(() => (shared ? uniqueTags([...namesFor(field, ctx), ...shared]) : namesFor(field, ctx)),
    [field, ctx, shared])
  const id = `rl-dl-${field.k}`
  const put = () => {
    const t = shared ? spellTag(add, options) : storedFor(field, ctx, add.trim())
    if (!t) return
    if (single) onChange(t)
    else if (!vals.some((x) => (shared ? tagKey(x) === tagKey(t) : x === t))) onChange([...vals, t])
    setAdd('')
  }
  return (
    <div className="rl-rows rl-chips">
      <div className="rl-rrow">
        {vals.map((t) => (
          /* `show` names a shorter field to wear — a journal's shortName. The
             chip stays one line; the full name is the title and one press
             away. The same rule the table's text() follows. */
          <span key={t} className="rl-tag" title={nameOf(field, ctx, t)}>
            {/* A value that is a record of a stored class opens that record. */}
            {ctx.openClass && classRec(field, ctx, t)
              ? <button type="button" className="rl-lnk" onClick={() => ctx.openClass(field.of, classRec(field, ctx, t).id || t)}>
                {shownAs(field, ctx, t)}</button>
              : shownAs(field, ctx, t)}
            <button type="button" className="rl-x" title={tr("rk_detach")}
              onClick={() => onChange(single ? '' : vals.filter((x) => x !== t))}>×</button>
          </span>
        ))}
        {vals.length === 0 && <span className="rl-hint">{tr("rk_none")}</span>}
      </div>
      {(!single || vals.length === 0) && (
        <div className="rl-rrow">
          <input className="rl-in" style={{ flex: '1 1 220px', minWidth: 0 }} list={id} value={add}
            placeholder={field.placeholder || field.label || ''} onChange={(e) => setAdd(e.target.value)}
            onBlur={put} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); put() } }} />
          <datalist id={id}>{options.map((t) => <option key={t} value={t} />)}</datalist>
          <button type="button" className="rl-btn" onClick={put} disabled={!add.trim()}>+</button>
        </div>
      )}
    </div>
  )
}

/** Many free names: tags. The tag list is what the records wear — there is
 *  no record behind a tag. */
function TagChips(p) {
  const shared = useSharedTags()
  return <Chips {...p} shared={shared} />
}
registerType('tags', {
  empty: () => [],
  text: (v) => nonBlank(v).join(' '),
  Edit: (p) => <TagChips {...p} />,
  tidy: (v) => [...new Set(nonBlank(v))],
})

/** One name from a class (`of: 'journals'`) — a record the service keeps a
 *  list of. A name not in it is allowed and stays text until it is added. */
registerType('class', {
  text(v, ctx) {
    const rec = classRec(ctx.field, ctx, v)
    return rec ? str((ctx.field.show && rec[ctx.field.show]) || rec.name || v) : str(v)
  },
  Edit: (p) => (p.field.pick ? <Pick {...p} /> : <Chips {...p} single />),
  tidy: (v) => str(v).trim(),
})

/** `pick: true` on a class: chosen from the names in use, as a 구분 is — or
 *  typed, when it is a new one. `options` are offered first, used or not;
 *  `options: (rec) => [...]` offers only those, as fit this record (a role its
 *  kind allows), and says so when the value is not among them. */
const NEW = '\u0001new'
function Pick({ value, onChange, field, ctx, rec }) {
  const only = typeof field.options === 'function' ? field.options(rec || {}) : null
  const cur = nameOf(field, ctx, value)
  const options = useMemo(() => (only
    ? [...new Set([...only, ...(cur ? [cur] : [])])]
    : [...new Set([...(field.options || []), ...namesFor(field, ctx)])]), [field, ctx, only, cur])
  const off = only && cur && !only.includes(cur)
  const [typing, setTyping] = useState(false)
  const [t, setT] = useState('')
  if (typing) {
    const done = () => { if (t.trim()) onChange(storedFor(field, ctx, t.trim())); setTyping(false); setT('') }
    return (
      <input className="rl-in" autoFocus style={{ width: 220 }} value={t} placeholder={tr("rk_new_name")}
        onChange={(e) => setT(e.target.value)} onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); done() }
          if (e.key === 'Escape') { setTyping(false); setT('') }
        }} />
    )
  }
  return (
    <>
      <select className="rl-in" value={cur}
        onChange={(e) => (e.target.value === NEW ? setTyping(true) : onChange(storedFor(field, ctx, e.target.value)))}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={NEW}>{tr("rk_type_your_own")}</option>
      </select>
      {off && <span className="rl-hint rl-warn">{tr("rk_not_in_kind", field.label || tr("rk_value"))}</span>}
    </>
  )
}

/** Several names from a class. */
registerType('classes', {
  empty: () => [],
  text: (v, ctx) => nonBlank(v).map((x) => (ctx ? nameOf(ctx.field, ctx, x) : x)).join(', '),
  Edit: (p) => <Chips {...p} />,
  tidy: (v) => [...new Set(nonBlank(v))],
})

/** Several plain strings — links, other spellings, emails. */
registerType('list', {
  empty: () => [],
  text: (v) => nonBlank(v).join(', '),
  Edit: ({ value, onChange, field }) => (
    <RackTextRows value={list(value)} onChange={onChange} add={`+ ${field.label || ''}`}
      placeholder={field.placeholder} link={field.link} width={field.width || 320} />
  ),
  tidy: (v) => nonBlank(v),
})

// ─── structured rows ──────────────────────────────────────────────────────
/** Several ENTRIES, each with fields of its own — an affiliation history
 *  (tag · dept · position · since), a group membership (group · role · core).
 *  The sub-fields are ordinary fields, so every type above works inside. */
registerType('rows', {
  empty: () => [],
  text(v, ctx) {
    const subs = ctx.field.fields || []
    const first = subs[0]
    return list(v).map((e) => (first ? typeOf(first).text(e?.[first.k], { ...ctx, field: first }) : '')).filter(Boolean).join(', ')
  },
  Edit: ({ value, onChange, field, ctx }) => {
    const rows = list(value)
    const subs = field.fields || []
    const put = (i, k, v) => onChange(rows.map((e, j) => (j === i ? { ...e, [k]: v } : e)))
    const blank = () => Object.fromEntries(subs.map((s) => [s.k, typeOf(s).empty()]))
    return (
      <div className="rl-rows">
        {rows.length === 0 && <span className="rl-hint">{tr("rk_none")}</span>}
        {rows.map((e, i) => (
          <div key={i} className="rl-rrow">
            {subs.map((s) => {
              const T = typeOf(s)
              return <T.Edit key={s.k} value={e?.[s.k]} field={{ ...s, width: s.width || 140 }}
                ctx={{ ...ctx, field: s }} onChange={(v) => put(i, s.k, v)} />
            })}
            <button type="button" className="rl-x" title={tr("rk_delete_row")}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="rl-btn" onClick={() => onChange([...rows, blank()])}>
          + {field.label || ''}
        </button>
      </div>
    )
  },
  tidy(v, field) {
    // An entry whose first field is blank was added and thought better of.
    const first = field?.fields?.[0]?.k
    return list(v).filter((e) => !first || str(e?.[first]).trim())
  },
})

// ─── files ────────────────────────────────────────────────────────────────
// The whole document is saved on every edit, so an attachment is carried in it
// as a data URL and counts against every future save. A couple of megabytes is
// a fair scan; ten is a document nobody can save any more.
const FILE_CAP = 2 * 1024 * 1024
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)
const dataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(r.result)
  r.onerror = () => rej(new Error(tr("rk_read_failed")))
  r.readAsDataURL(file)
})
function download(data, name) {
  const a = document.createElement('a')
  a.href = data
  a.download = name || 'file'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
function Files({ value, onChange, field, ctx }) {
  const pick = useRef(null)
  const files = list(value)
  const cap = field.cap || FILE_CAP
  async function add(e) {
    const got = [...(e.target.files || [])]
    e.target.value = ''
    const added = []
    for (const f of got) {
      if (f.size > cap) { ctx.say?.(tr("rk_file_too_big", f.name, kb(cap))); continue }
      added.push({ name: f.name, type: f.type, size: f.size, data: await dataUrl(f) })
    }
    if (added.length) onChange([...files, ...added])
  }
  return (
    <div className="rl-rows">
      {files.length === 0 && <span className="rl-hint">{tr("rk_none")}</span>}
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="rl-rrow">
          <button type="button" className="rl-btn" onClick={() => download(f.data, f.name)}>{f.name}</button>
          <span className="rl-hint">{f.size ? kb(f.size) : ''}</span>
          <button type="button" className="rl-x" title={tr("rk_delete")}
            onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="rl-btn" onClick={() => pick.current?.click()}>{tr("rk_add_file")}</button>
      <input ref={pick} type="file" multiple hidden accept={field.accept} onChange={add} />
      <span className="rl-hint">{tr("rk_one_file_up_to", kb(cap))}</span>
    </div>
  )
}
registerType('files', {
  empty: () => [],
  text: (v) => list(v).map((f) => f?.name).filter(Boolean).join(', '),
  cell: (v) => (list(v).length ? `📎 ${list(v).length}` : D),
  sort: (v) => list(v).length || null,
  Edit: (p) => <Files {...p} />,
})

// ─── links to other records ───────────────────────────────────────────────
/**
 * `ref` points at another [항목] — in this service (`to: 'self'`, or another
 * item list of this document: `to: { item: 'people' }`) or in ANOTHER service:
 * `to: { svc: 'reference_manager', proj: 'papers', item: 'references' }`.
 *
 * What is stored is the address, never a copy: `{ id }` here, `{ svc, proj, id }`
 * across services. The label is looked up when shown, so renaming the target
 * renames every link to it. `many: true` holds a list of them.
 *
 * `names: true` lets an entry be a name with nobody behind it ({ label }) — a
 * collaborator the other service does not list. It shows as plain text.
 *
 * Another service's records are read through the portal's proxy with the
 * user's own token — the same origin, and the same permissions they have
 * there. Nothing is copied across.
 */
const REMOTE = new Map()        // `${svc}/${proj}` → Promise<doc>
export function remoteDoc(svc, proj) {
  const k = `${svc}/${proj}`
  if (!REMOTE.has(k)) {
    REMOTE.set(k, fetch(`/pp/${svc}/${proj}/api/data`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null))
  }
  return REMOTE.get(k)
}
export const forgetRemote = (svc, proj) => REMOTE.delete(`${svc}/${proj}`)

/** Where a ref field points, normalised. */
export function refTarget(field, def) {
  const to = field.to || 'self'
  if (to === 'self') return { local: true, item: def?.item?.key, label: def?.item?.label }
  if (typeof to === 'string') return { local: true, item: to }
  return { local: !to.svc, item: to.item, svc: to.svc, proj: to.proj, label: to.label }
}
const labelWith = (label) => (typeof label === 'function' ? label
  : label ? (r) => str(r?.[label]) : (r) => str(r?.name || r?.title || r?.citeKey || r?.id))

/** The records a ref field can point at, with a label each. */
export function useRefOptions(field, ctx) {
  const t = refTarget(field, ctx.def)
  const [remote, setRemote] = useState(null)
  useEffect(() => {
    if (t.local || !t.svc) return
    let alive = true
    remoteDoc(t.svc, t.proj).then((d) => { if (alive) setRemote(d) })
    return () => { alive = false }
  }, [t.local, t.svc, t.proj])
  const src = t.local ? ctx.doc : remote
  const label = labelWith(t.label)
  return useMemo(() => (src?.[t.item] || []).map((r) => ({ id: r.id, label: label(r) || r.id, rec: r })),
    [src, t.item])   // eslint-disable-line react-hooks/exhaustive-deps
}

export function refLabelOf(link, field, ctx) {
  const t = refTarget(field, ctx.def)
  const id = typeof link === 'object' ? link?.id : link
  // A name with nobody behind it yet: someone the other service does not have.
  if (!id) return (typeof link === 'object' && link?.label) || ''
  const src = t.local ? ctx.doc : ctx.remote?.[`${t.svc}/${t.proj}`]
  const rec = (src?.[t.item] || []).find((r) => r.id === id)
  return rec ? labelWith(t.label)(rec) : (typeof link === 'object' && link?.label) || tr("rk_missing_item")
}

function RefEdit({ value, onChange, field, ctx }) {
  const options = useRefOptions(field, ctx)
  const t = refTarget(field, ctx.def)
  const links = list(value)
  const [q, setQ] = useState('')
  const byLabel = useMemo(() => new Map(options.map((o) => [o.label, o])), [options])
  const id = `rl-ref-${field.k}`
  const mk = (o) => (t.local ? { id: o.id } : { svc: t.svc, proj: t.proj, id: o.id, label: o.label })
  const put = () => {
    const o = byLabel.get(q.trim())
    if (!o) return
    if (field.many) { if (!links.some((l) => l.id === o.id)) onChange([...links, mk(o)]) }
    else onChange(mk(o))
    setQ('')
  }
  const name = (l) => (l.id ? options.find((o) => o.id === l.id)?.label : null) || l.label || tr("rk_missing_item")
  // A name the other side does not have can still be written down; it shows as
  // plain text and links the moment someone with that name is picked instead.
  const putName = () => {
    const n = q.trim()
    if (!n || byLabel.has(n)) return
    if (field.many) { if (!links.some((l) => !l.id && l.label === n)) onChange([...links, { label: n }]) }
    else onChange({ label: n })
    setQ('')
  }
  return (
    <div className="rl-rows rl-chips">
      <div className="rl-rrow">
        {links.map((l) => (
          <span key={l.id || `name:${l.label}`} className={`rl-tag${l.id ? '' : ' rl-unlinked'}`}
            title={l.id ? '' : tr("rk_name_only_no_link")}>
            {t.local && l.id && ctx.openItem
              ? <button type="button" className="rl-lnk" onClick={() => ctx.openItem(l.id)}>{name(l)}</button>
              // A record in another service: press it and you are there.
              : !t.local && l.id
                ? <button type="button" className="rl-lnk" title={tr("rk_open_in", t.svc)}
                  onClick={() => openInService(l.svc || t.svc, l.proj || t.proj, l.id)}>{name(l)}</button>
                : name(l)}
            <button type="button" className="rl-x" title={tr("rk_unlink")}
              onClick={() => onChange(field.many ? links.filter((x) => x !== l) : null)}>×</button>
          </span>
        ))}
        {links.length === 0 && <span className="rl-hint">{t.svc ? tr("rk_link_to_items_of", t.svc) : tr("rk_none")}</span>}
      </div>
      {(field.many || links.length === 0) && (
        <div className="rl-rrow">
          <input className="rl-in" style={{ flex: '1 1 220px', minWidth: 0 }} list={id} value={q}
            placeholder={options.length ? tr("rk_search_and_pick") : tr("rk_loading")}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); put() } }} />
          <datalist id={id}>{options.map((o) => <option key={o.id} value={o.label} />)}</datalist>
          <button type="button" className="rl-btn" onClick={put} disabled={!byLabel.has(q.trim())}>{tr("rk_link")}</button>
          {field.names && q.trim() && !byLabel.has(q.trim()) && (
            <button type="button" className="rl-btn" onClick={putName}>{tr("rk_name_only")}</button>
          )}
        </div>
      )}
    </div>
  )
}

registerType('ref', {
  empty: () => null,
  text(v, ctx) { return list(v).map((l) => refLabelOf(l, ctx.field, ctx)).filter(Boolean).join(', ') },
  sort(v, ctx) { return this.text(v, ctx) || null },
  Edit: (p) => <RefEdit {...p} />,
  tidy: (v) => v || null,
})
/** The table's cell for links: their names — and a link into another service
 *  is pressable there too. */
function refCell(v, ctx) {
  const links = list(v).filter((l) => l?.id || l?.label)
  if (!links.length) return D
  const t = refTarget(ctx.field, ctx.def)
  if (t.local) return links.map((l) => refLabelOf(l, ctx.field, ctx)).filter(Boolean).join(', ')
  return links.map((l, i) => (
    <span key={l.id || `n${i}`}>
      {i > 0 && ', '}
      {l.id ? (
        <button type="button" className="rl-lnk" title={tr("rk_open_in", t.svc)}
          onClick={(e) => { e.stopPropagation(); openInService(l.svc || t.svc, l.proj || t.proj, l.id) }}>
          {refLabelOf(l, ctx.field, ctx)}
        </button>
      ) : refLabelOf(l, ctx.field, ctx)}
    </span>
  ))
}

registerType('refs', {
  empty: () => [],
  text(v, ctx) { return list(v).map((l) => refLabelOf(l, ctx.field, ctx)).filter(Boolean).join(', ') },
  cell: refCell,
  Edit: (p) => <RefEdit {...p} field={{ ...p.field, many: true }} />,
  tidy: (v) => list(v).filter((l) => l?.id || String(l?.label || '').trim()),
})

// ─── a list's items ───────────────────────────────────────────────────────
/** What a LIST holds (a class with `list: { ids }`): item ids, in order. Each
 *  opens its item; × takes it out of the list — the item stays. */
const itemLabel = (def, r) => {
  const l = def?.item?.label
  return str(typeof l === 'function' ? l(r) : r?.[l || def?.item?.fields?.[0]?.k]) || str(r?.id).slice(0, 8)
}
registerType('members', {
  empty: () => [],
  text: (v) => (list(v).length ? String(list(v).length) : ''),
  sort: (v) => list(v).length || null,
  cell: (v) => list(v).length || D,
  Edit: ({ value, onChange, ctx, field }) => {
    const def = ctx.def
    const idk = def?.item?.id || 'id'
    const byId = new Map((ctx.doc?.[def?.item?.key] || []).map((r) => [r[idk], r]))
    const ids = list(value)
    return (
      <div className="rl-rows">
        {ids.length === 0 && <span className="rl-hint">{tr("rk_list_empty_hint")}</span>}
        {ids.map((id) => {
          const r = byId.get(id)
          return (
            <div key={id} className="rl-rrow">
              {r ? <button type="button" className="rl-lnk rl-mono" onClick={() => ctx.openItem?.(id)}>{itemLabel(def, r)}</button>
                : <span className="rl-hint">{tr("rk_missing_item_id", id)}</span>}
              {r && field.show && <span className="rl-hint">{field.show(r)}</span>}
              <button type="button" className="rl-x" title={tr("rk_remove_from_list")}
                onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
            </div>
          )
        })}
        {ids.length > 0 && <span className="rl-hint">{tr("rk_n", ids.length)}</span>}
      </div>
    )
  },
  tidy: (v) => [...new Set(list(v))],
})

// ─── a photo ──────────────────────────────────────────────────────────────
/** One picture, kept in the document as a data URL — so a picked file is
 *  shrunk first (1280px, jpeg 0.82): the document is sent whole on every save,
 *  and a 4MB phone photo would be paid for on every keystroke after it.
 *  `capture` hands a phone its camera; a desktop gets the file picker.
 *  Several photos of one record are several fields: { group: '사진' } puts
 *  them side by side. */
const SHOT_MAX = 1280
const SHOT_CAP = 600 * 1024
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const s = Math.min(1, SHOT_MAX / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      res(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(tr("rk_read_failed"))) }
    img.src = url
  })
}
function Shot({ value, onChange, field, ctx }) {
  const [big, setBig] = useState(false)
  const pick = useRef(null)
  async function take(file) {
    if (!file) return
    try {
      const data = await shrink(file)
      if (data.length > SHOT_CAP * 1.4) { ctx.say?.(tr("rk_photo_too_big")); return }
      onChange(data)
    } catch (e) { ctx.say?.(String(e.message || e)) }
  }
  return (
    <span className="rl-shot">
      {value ? (
        <button type="button" className="rl-shot-img" title={tr("rk_view_large")} onClick={() => setBig(true)}>
          <img src={value} alt={field.label} />
        </button>
      ) : <span className="rl-shot-img is-empty">{tr("rk_none")}</span>}
      <span className="rl-shot-line">
        <span className="rl-hint">{field.placeholder || field.label}</span>
        <button type="button" className="rl-btn" onClick={() => pick.current?.click()}>{value ? tr("rk_replace") : tr("rk_add")}</button>
        {value && <button type="button" className="rl-x" title={tr("rk_delete")} onClick={() => onChange('')}>×</button>}
      </span>
      <input ref={pick} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f) }} />
      {big && (
        <button type="button" className="rl-lightbox" onClick={() => setBig(false)} title={tr("rk_close")}>
          <img src={value} alt="" />
        </button>
      )}
    </span>
  )
}
registerType('image', {
  text: () => '',                       // a data URL is not words to search
  sort: (v) => (v ? 1 : null),
  cell: (v) => (v ? '▣' : D),
  Edit: (p) => <Shot {...p} />,
  tidy: (v) => v || '',
})

// ─── who points here, from elsewhere ──────────────────────────────────────
/** The reverse of a link into another service: the records THERE that point at
 *  this one. Declared on the side being pointed at, as a computed field:
 *
 *    { k: 'usedBy', label: '활동', type: 'backlinks',
 *      from: { svc: 'academic_activities', proj: 'activities', item: 'activities',
 *              field: 'papers', label: 'name' } }
 *
 *  Nothing is stored here: the other service's links are the only copy, so the
 *  two can never disagree. Each one opens that record there. */
export function backlinksOf(rec, field, ctx) {
  const f = field.from || {}
  const src = ctx.remote?.[`${f.svc}/${f.proj}`]?.[f.item] || []
  const me = ctx.def?.name
  const id = rec?.id
  if (!id) return []
  const label = labelWith(f.label)
  return src.filter((x) => list(x[f.field]).some((l) => l?.id === id && (!l.svc || l.svc === me)))
    .map((x) => ({ svc: f.svc, proj: f.proj, id: x.id, label: label(x) }))
}
registerType('backlinks', {
  text: (v) => list(v).map((l) => l.label).join(', '),
  sort: (v) => list(v).length || null,
  cell: (v) => {
    const links = list(v)
    if (!links.length) return D
    return links.map((l, i) => (
      <span key={l.id}>
        {i > 0 && ', '}
        <button type="button" className="rl-lnk" title={tr("rk_open_in", l.svc)}
          onClick={(e) => { e.stopPropagation(); openInService(l.svc, l.proj, l.id) }}>{l.label}</button>
      </span>
    ))
  },
  Show: ({ value }) => {
    const links = list(value)
    if (!links.length) return <span className="rl-hint">{tr("rk_none")}</span>
    return (
      <div className="rl-rows">
        <div className="rl-rrow" style={{ flexWrap: 'wrap' }}>
          {links.map((l) => (
            <span key={l.id} className="rl-tag">
              <button type="button" className="rl-lnk" title={tr("rk_open_in", l.svc)}
                onClick={() => openInService(l.svc, l.proj, l.id)}>{l.label}</button>
            </span>
          ))}
        </div>
      </div>
    )
  },
})

// ─── a note about the record, in the note service ─────────────────────────
/** `type: 'note'` — the record's note in the note service (`svc`, `proj`;
 *  'note' by default), named `title(rec)`. Made when asked; a note already
 *  there by that name is the one meant, not a second. Kept as { id, title }
 *  and found again by its id — or by its name, if the id never got saved. */
const NOTES = new Map()           // 'svc/proj' → Promise<[{ id, title }]>
const noteApi = (svc, proj, p, o = {}) => fetch(`/pp/${svc}/${proj}/api${p}`,
  { ...o, headers: { 'Content-Type': 'application/json', ...authHeaders() } })
function notesOf(svc, proj, fresh) {
  const k = `${svc}/${proj}`
  if (fresh || !NOTES.has(k)) {
    NOTES.set(k, noteApi(svc, proj, '/notes').then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d) => d.notes || []).catch(() => []))
  }
  return NOTES.get(k)
}
function NoteEdit({ value, onChange, field, rec, ctx }) {
  const svc = field.svc || 'note', proj = field.proj || 'note'
  const title = str(field.title ? field.title(rec || {}) : '').trim()
  const [notes, setNotes] = useState(null)
  const [tone, setTone] = useState('')            // the note service's colour, for its tab
  useEffect(() => { serviceColor(svc).then(setTone) }, [svc])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { let on = true; notesOf(svc, proj).then((n) => { if (on) setNotes(n) }); return () => { on = false } }, [svc, proj])
  const found = notes && (notes.find((n) => value?.id && n.id === value.id) || notes.find((n) => title && n.title === title))
  async function make() {
    setBusy(true); setErr('')
    try {
      const had = (await notesOf(svc, proj, true)).find((n) => n.title === title)
      const r = had ? null : await noteApi(svc, proj, '/notes', { method: 'POST', body: JSON.stringify({ title }) })
      if (r && !r.ok) throw new Error(tr("rk_note_create_failed", r.status))
      const n = had || await r.json()
      onChange({ id: n.id, title: n.title })
      setNotes(await notesOf(svc, proj, true))
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  if (!notes) return <span className="rl-hint">{tr("rk_note_finding")}</span>
  if (found) {
    // 노트 열기: the note's own editor, as a tab beside this record's. Its
    // name goes to the note service itself.
    const open = () => (ctx?.openFrame
      ? ctx.openFrame({ id: `note:${found.id}`, label: found.title, color: tone, src: `/pp/${svc}/${proj}/?solo=${encodeURIComponent(found.id)}` })
      : openInService(svc, proj, found.id))
    return (
      <>
        <button type="button" className="rl-lnk" title={tr("rk_open_in", svc)}
          onClick={() => openInService(svc, proj, found.id)}>{found.title}</button>
        <button type="button" className="rl-btn" onClick={open}>{tr("rk_note_open")}</button>
      </>
    )
  }
  return (
    <>
      <button type="button" className="rl-btn" disabled={!title || busy} onClick={make}>{tr("rk_note_create")}</button>
      {title && <span className="rl-hint">{title}</span>}
      {value?.id && <span className="rl-hint rl-warn">{tr("rk_note_gone")}</span>}
      {err && <span className="rl-hint rl-warn">{err}</span>}
    </>
  )
}
registerType('note', {
  empty: () => null,
  text: (v) => str(v?.title),
  cell: (v, ctx) => (v?.id ? (
    <button type="button" className="rl-lnk" title={v.title}
      onClick={(e) => { e.stopPropagation(); openInService(ctx.field.svc || 'note', ctx.field.proj || 'note', v.id) }}>{tr("rk_note")}</button>
  ) : D),
  Edit: (p) => <NoteEdit {...p} />,
  tidy: (v) => (v?.id ? { id: v.id, title: str(v.title) } : null),
})

// ─── a record that repeats ────────────────────────────────────────────────
/** `type: 'repeat'` — { rule: RRULE text, ex: [days taken out] } or null
 *  (rrule.js). Edited the way a calendar asks it: how often, on which days,
 *  until when; a rule nobody can say that way (one from Google) is shown and
 *  edited as its text. `start` names the field the record starts on. */
function RepeatEdit({ value, onChange, field, rec }) {
  const v = value?.rule ? value : null
  const start = String(rec?.[field.start || 'start'] || '').slice(0, 10)
  const r = v ? parseRule(v.rule) : null
  const sdow = start ? new Date(`${start}T00:00:00Z`).getUTCDay() : 1
  const sdom = start ? Number(start.slice(8)) : 1
  const snth = Math.ceil(sdom / 7)
  // Plain enough for the form: one freq, plain weekdays in a week, one 'nth
  // weekday' or the start's day in a month — anything else is the rule's text.
  const plain = !r || (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq) && !r.bymonth.length
    && (r.freq === 'WEEKLY' ? r.byday.every((x) => !x.n) && !r.bymonthday.length
      : r.freq === 'MONTHLY' ? (r.byday.length <= 1 && r.byday.every((x) => x.n) && !r.bymonthday.length)
        || (!r.byday.length && (!r.bymonthday.length || (r.bymonthday.length === 1 && r.bymonthday[0] === sdom)))
        : !r.byday.length && !r.bymonthday.length))
  const [raw, setRaw] = useState(!plain)
  const put = (rule, ex = v?.ex || []) => onChange(rule ? { rule, ex } : null)
  const build = (o) => {
    const p = { freq: r?.freq || 'WEEKLY', interval: r?.interval || 1, days: r?.byday?.filter((x) => !x.n).map((x) => x.d) || [],
      nth: r?.freq === 'MONTHLY' && r.byday.length ? r.byday[0] : null, until: r?.until || '', count: r?.count || 0, ...o }
    const parts = [`FREQ=${p.freq}`]
    if (p.interval > 1) parts.push(`INTERVAL=${p.interval}`)
    if (p.freq === 'WEEKLY' && p.days.length) parts.push(`BYDAY=${[...new Set(p.days)].sort().map((d) => DAYS[d]).join(',')}`)
    if (p.freq === 'MONTHLY' && p.nth) parts.push(`BYDAY=${p.nth.n}${DAYS[p.nth.d]}`)
    let rule = parts.join(';')
    if (p.until) rule = withUntil(rule, p.until)
    else if (p.count) rule = withCount(rule, p.count)
    return rule
  }
  const freq = r?.freq || ''
  const end = r?.until ? 'until' : r?.count ? 'count' : 'none'
  return (
    <div className="rl-repeat">
      <div className="rl-rrow">
        <select className="rl-in" value={raw ? 'RAW' : freq}
          onChange={(e) => {
            const f = e.target.value
            if (f === 'RAW') { setRaw(true); if (!v) put('FREQ=WEEKLY'); return }
            setRaw(false)
            put(f ? build({ freq: f, days: [], nth: null }) : '')
          }}>
          <option value="">{tr("rk_no_repeat")}</option>
          <option value="DAILY">{tr("rk_every_DAILY")}</option>
          <option value="WEEKLY">{tr("rk_every_WEEKLY")}</option>
          <option value="MONTHLY">{tr("rk_every_MONTHLY")}</option>
          <option value="YEARLY">{tr("rk_every_YEARLY")}</option>
          <option value="RAW">{tr("rk_raw_rule")}</option>
        </select>
        {v && !raw && (
          <>
            <input className="rl-in" type="number" min={1} style={{ width: 56 }} value={r.interval}
              onChange={(e) => put(build({ interval: Math.max(1, Number(e.target.value) || 1) }))} />
            <span className="rl-hint">{tr(`rk_every_unit_${freq}`)}</span>
          </>
        )}
        {v && raw && (
          <input className="rl-in rl-mono" style={{ flex: '1 1 260px', minWidth: 0 }} value={v.rule}
            onChange={(e) => put(e.target.value.replace(/^RRULE:/i, '').trim() || 'FREQ=WEEKLY')} />
        )}
      </div>
      {v && !raw && freq === 'WEEKLY' && (
        <div className="rl-rrow">
          {DAYS.map((_, d) => {
            const on = r.byday.length ? r.byday.some((x) => x.d === d) : d === sdow
            return (
              <button key={d} type="button" className={`rl-btn rl-day${on ? ' on' : ''}`}
                onClick={() => {
                  const cur = r.byday.length ? r.byday.map((x) => x.d) : [sdow]
                  const next = on ? cur.filter((x) => x !== d) : [...cur, d]
                  put(build({ days: next.length ? next : [sdow] }))
                }}>{dow(d)}</button>
            )
          })}
        </div>
      )}
      {v && !raw && freq === 'MONTHLY' && (
        <div className="rl-rrow">
          <select className="rl-in" value={r.byday.length ? 'nth' : 'day'}
            onChange={(e) => put(build({ nth: e.target.value === 'nth' ? { n: snth > 4 ? -1 : snth, d: sdow } : null }))}>
            <option value="day">{tr('rk_monthly_on_day', sdom)}</option>
            <option value="nth">{tr('rk_monthly_on_nth', nth(snth > 4 ? -1 : snth), dow(sdow))}</option>
          </select>
        </div>
      )}
      {v && !raw && (
        <div className="rl-rrow">
          <select className="rl-in" value={end}
            onChange={(e) => {
              const m = e.target.value
              put(m === 'until' ? withUntil(v.rule, start || new Date().toISOString().slice(0, 10))
                : m === 'count' ? withCount(v.rule, 10) : withoutEnd(v.rule))
            }}>
            <option value="none">{tr("rk_no_end")}</option>
            <option value="until">{tr("rk_end_until")}</option>
            <option value="count">{tr("rk_end_count")}</option>
          </select>
          {end === 'until' && (
            <input className="rl-in" type="date" value={r.until} onChange={(e) => put(withUntil(v.rule, e.target.value))} />
          )}
          {end === 'count' && (
            <>
              <input className="rl-in" type="number" min={1} style={{ width: 64 }} value={r.count}
                onChange={(e) => put(withCount(v.rule, Math.max(1, Number(e.target.value) || 1)))} />
              <span className="rl-hint">{tr("rk_times_unit")}</span>
            </>
          )}
        </div>
      )}
      {v && <span className="rl-hint">{describe(v.rule, start)}</span>}
      {v?.ex?.length > 0 && (
        <div className="rl-rrow">
          <span className="rl-hint">{tr("rk_skipped_dates")}</span>
          {v.ex.map((d) => (
            <span key={d} className="rl-tag">{d}
              <button type="button" className="rl-x" title={tr("rk_put_back")} onClick={() => put(v.rule, v.ex.filter((x) => x !== d))}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
registerType('repeat', {
  empty: () => null,
  text: (v) => (v?.rule ? describe(v.rule) : ''),
  Edit: (p) => <RepeatEdit {...p} />,
  tidy: (v) => (v?.rule ? { rule: String(v.rule).replace(/^RRULE:/i, '').trim(), ex: [...new Set(v.ex || [])].sort() } : null),
})
