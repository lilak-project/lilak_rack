import { useEffect, useMemo, useRef, useState } from 'react'
import { RackTextRows } from './fields.jsx'
import { authHeaders } from './portal.js'

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
function Input({ value, onChange, field, type = 'text', width }) {
  return (
    <input className={`rl-in${field.mono ? ' rl-mono' : ''}`} type={type}
      style={{ width: field.width || width }} value={str(value)}
      placeholder={field.placeholder || ''}
      onChange={(e) => onChange(e.target.value)} />
  )
}

/** `href: (v) => url` puts a link beside it (a doi → doi.org). */
registerType('text', {
  Edit: (p) => (
    <>
      <Input {...p} width={320} />
      {p.field.href && str(p.value).trim() && (
        <a className="rl-hint" href={p.field.href(str(p.value).trim())} target="_blank" rel="noreferrer">열기</a>
      )}
    </>
  ),
  tidy: (v) => str(v).trim(),
})

registerType('longtext', {
  cell: (v) => (str(v).split('\n')[0] || D),
  Edit: ({ value, onChange, field }) => (
    <textarea className="rl-in" rows={field.rows || 3} style={{ width: '100%', minWidth: 260 }}
      value={str(value)} placeholder={field.placeholder || ''}
      onChange={(e) => onChange(e.target.value)} />
  ),
})

registerType('number', {
  // Numbers sort as numbers: 9 before 10, and a blank last rather than first.
  sort: (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v)),
  Edit: (p) => <Input {...p} type="number" width={100} />,
  tidy: (v) => (v === '' || v === null || v === undefined ? '' : Number(v)),
})

/** '과' after a final consonant, '와' after a vowel: 행사 시작과, 마감일과… */
const withGwa = (w) => {
  const c = str(w).trim().slice(-1).charCodeAt(0)
  return `${w}${c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? '과' : '와'}`
}

/** `same: 'start'` puts a button beside it that copies that field's date —
 *  a talk on the first day, a trip as long as the meeting. */
registerType('date', {
  // ISO dates already sort as text; the cell keeps the date part only.
  text: (v) => str(v).slice(0, 10),
  Edit: (p) => {
    const from = p.field.same
    const src = from && (p.ctx?.def?.item?.fields || []).find((f) => f.k === from)
    const v = from ? str(p.rec?.[from]) : ''
    return (
      <>
        <Input {...p} type="date" width={150} />
        {from && (
          <button type="button" className="rl-btn" disabled={!v || v === str(p.value)}
            title={v ? `${v}` : `${src?.label || from}이(가) 비어 있습니다`}
            onClick={() => p.onChange(v)}>{withGwa(src?.label || from)} 같음</button>
        )}
      </>
    )
  },
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
      <Input value={value} onChange={onChange} field={field} type="url" width={320} />
      {/^https?:\/\//.test(str(value)) && (
        <a className="rl-hint" href={str(value)} target="_blank" rel="noreferrer">열기</a>
      )}
    </>
  ),
})

registerType('email', { Edit: (p) => <Input {...p} type="email" width={260} /> })

registerType('check', {
  empty: () => false,
  text: (v) => (v ? '✓' : ''),
  Edit: ({ value, onChange, field }) => (
    <label className="rl-hint">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.hint || ''}
    </label>
  ),
})

/** One of a fixed set — `options: ['paper', 'thesis']` or [[value, label]]. */
registerType('select', {
  text(v, ctx) {
    const o = (ctx.field.options || []).find((x) => (Array.isArray(x) ? x[0] : x) === v)
    return Array.isArray(o) ? o[1] : str(v)
  },
  Edit: ({ value, onChange, field }) => (
    <select className="rl-in" value={str(value)} onChange={(e) => onChange(e.target.value)}>
      {!field.required && <option value="">—</option>}
      {(field.options || []).map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o]
        return <option key={v} value={v}>{l}</option>
      })}
    </select>
  ),
})

// ─── names a record wears ─────────────────────────────────────────────────
/** The names already in use for this field (or in the class it points at),
 *  offered when typing — a tag or a class is a word others already use, not a
 *  thing to create first. */
function namesFor(field, ctx) {
  const recs = field.of ? (ctx.doc?.[field.of] || []) : []
  const fromClass = recs.map((r) => r.name).filter(Boolean)
  const items = ctx.doc?.[ctx.def?.item?.key] || []
  const used = items.flatMap((r) => list(r[field.k]))
  return [...new Set([...fromClass, ...used.map(str).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'ko'))
}

/** Chips, a box to add one, and the names in use on offer. Leaving the box is
 *  as good as pressing the button: a name typed and then saved used to vanish
 *  without a word. */
function Chips({ value, onChange, field, ctx, single }) {
  const [add, setAdd] = useState('')
  const vals = list(value)
  const options = useMemo(() => namesFor(field, ctx), [field, ctx])
  const id = `rl-dl-${field.k}`
  const put = () => {
    const t = add.trim()
    if (!t) return
    if (single) onChange(t)
    else if (!vals.includes(t)) onChange([...vals, t])
    setAdd('')
  }
  return (
    <div className="rl-rows">
      <div className="rl-rrow">
        {vals.map((t) => (
          <span key={t} className="rl-tag">
            {/* A name that is a record of a stored class opens that record. */}
            {field.of && ctx.openClass && (ctx.doc?.[field.of] || []).some((r) => r.name === t)
              ? <button type="button" className="rl-lnk" onClick={() => ctx.openClass(field.of, t)}>{t}</button>
              : t}
            <button type="button" className="rl-x" title="떼기"
              onClick={() => onChange(single ? '' : vals.filter((x) => x !== t))}>×</button>
          </span>
        ))}
        {vals.length === 0 && <span className="rl-hint">없음</span>}
      </div>
      {(!single || vals.length === 0) && (
        <div className="rl-rrow">
          <input className="rl-in" style={{ width: 220 }} list={id} value={add}
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
registerType('tags', {
  empty: () => [],
  text: (v) => nonBlank(v).join(' '),
  Edit: (p) => <Chips {...p} />,
  tidy: (v) => [...new Set(nonBlank(v))],
})

/** One name from a class (`of: 'journals'`) — a record the service keeps a
 *  list of. A name not in it is allowed and stays text until it is added. */
registerType('class', {
  text(v, ctx) {
    const rec = (ctx.doc?.[ctx.field.of] || []).find((r) => r.name === v)
    return str(ctx.field.show && rec ? rec[ctx.field.show] || v : v)
  },
  Edit: (p) => <Chips {...p} single />,
  tidy: (v) => str(v).trim(),
})

/** Several names from a class. */
registerType('classes', {
  empty: () => [],
  text: (v) => nonBlank(v).join(', '),
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
        {rows.length === 0 && <span className="rl-hint">없음</span>}
        {rows.map((e, i) => (
          <div key={i} className="rl-rrow">
            {subs.map((s) => {
              const T = typeOf(s)
              return <T.Edit key={s.k} value={e?.[s.k]} field={{ ...s, width: s.width || 140 }}
                ctx={{ ...ctx, field: s }} onChange={(v) => put(i, s.k, v)} />
            })}
            <button type="button" className="rl-x" title="이 줄 지우기"
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
  r.onerror = () => rej(new Error('읽지 못했습니다.'))
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
      if (f.size > cap) { ctx.say?.(`${f.name} 은 ${kb(cap)}보다 큽니다 — 문서 전체가 매번 저장되므로 받지 않습니다.`); continue }
      added.push({ name: f.name, type: f.type, size: f.size, data: await dataUrl(f) })
    }
    if (added.length) onChange([...files, ...added])
  }
  return (
    <div className="rl-rows">
      {files.length === 0 && <span className="rl-hint">없음</span>}
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="rl-rrow">
          <button type="button" className="rl-btn" onClick={() => download(f.data, f.name)}>{f.name}</button>
          <span className="rl-hint">{f.size ? kb(f.size) : ''}</span>
          <button type="button" className="rl-x" title="지우기"
            onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="rl-btn" onClick={() => pick.current?.click()}>+ 파일</button>
      <input ref={pick} type="file" multiple hidden accept={field.accept} onChange={add} />
      <span className="rl-hint">한 개 {kb(cap)}까지.</span>
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
  return rec ? labelWith(t.label)(rec) : (typeof link === 'object' && link?.label) || '(없는 항목)'
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
  const name = (l) => (l.id ? options.find((o) => o.id === l.id)?.label : null) || l.label || '(없는 항목)'
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
    <div className="rl-rows">
      <div className="rl-rrow">
        {links.map((l) => (
          <span key={l.id || `name:${l.label}`} className={`rl-tag${l.id ? '' : ' rl-unlinked'}`}
            title={l.id ? '' : '연결된 항목 없이 이름만'}>
            {t.local && l.id && ctx.openItem
              ? <button type="button" className="rl-lnk" onClick={() => ctx.openItem(l.id)}>{name(l)}</button>
              : name(l)}
            <button type="button" className="rl-x" title="연결 끊기"
              onClick={() => onChange(field.many ? links.filter((x) => x !== l) : null)}>×</button>
          </span>
        ))}
        {links.length === 0 && <span className="rl-hint">{t.svc ? `${t.svc} 의 항목과 연결` : '없음'}</span>}
      </div>
      {(field.many || links.length === 0) && (
        <div className="rl-rrow">
          <input className="rl-in" style={{ width: 280 }} list={id} value={q}
            placeholder={options.length ? '찾아서 고르기' : '읽는 중…'}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); put() } }} />
          <datalist id={id}>{options.map((o) => <option key={o.id} value={o.label} />)}</datalist>
          <button type="button" className="rl-btn" onClick={put} disabled={!byLabel.has(q.trim())}>연결</button>
          {field.names && q.trim() && !byLabel.has(q.trim()) && (
            <button type="button" className="rl-btn" onClick={putName}>이름만 적기</button>
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
registerType('refs', {
  empty: () => [],
  text(v, ctx) { return list(v).map((l) => refLabelOf(l, ctx.field, ctx)).filter(Boolean).join(', ') },
  cell(v, ctx) { const n = list(v).length; return n ? `${this.text(v, ctx)}` : D },
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
        {ids.length === 0 && <span className="rl-hint">비어 있습니다 — 표에서 고른 뒤 "목록에 넣기"로 담습니다.</span>}
        {ids.map((id) => {
          const r = byId.get(id)
          return (
            <div key={id} className="rl-rrow">
              {r ? <button type="button" className="rl-lnk rl-mono" onClick={() => ctx.openItem?.(id)}>{itemLabel(def, r)}</button>
                : <span className="rl-hint">(없는 항목 {id})</span>}
              {r && field.show && <span className="rl-hint">{field.show(r)}</span>}
              <button type="button" className="rl-x" title="목록에서 빼기 (항목은 그대로)"
                onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
            </div>
          )
        })}
        {ids.length > 0 && <span className="rl-hint">{ids.length}개</span>}
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
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('읽지 못했습니다.')) }
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
      if (data.length > SHOT_CAP * 1.4) { ctx.say?.('사진이 너무 큽니다.'); return }
      onChange(data)
    } catch (e) { ctx.say?.(String(e.message || e)) }
  }
  return (
    <span className="rl-shot">
      {value ? (
        <button type="button" className="rl-shot-img" title="크게 보기" onClick={() => setBig(true)}>
          <img src={value} alt={field.label} />
        </button>
      ) : <span className="rl-shot-img is-empty">없음</span>}
      <span className="rl-shot-line">
        <span className="rl-hint">{field.placeholder || field.label}</span>
        <button type="button" className="rl-btn" onClick={() => pick.current?.click()}>{value ? '바꾸기' : '추가'}</button>
        {value && <button type="button" className="rl-x" title="지우기" onClick={() => onChange('')}>×</button>}
      </span>
      <input ref={pick} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f) }} />
      {big && (
        <button type="button" className="rl-lightbox" onClick={() => setBig(false)} title="닫기">
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
