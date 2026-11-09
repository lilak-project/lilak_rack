/**
 * Uploaded files — a field that holds them and a tab that gathers them.
 *
 *   { k: 'files', label: '첨부', type: 'uploads' }        a record's own files
 *   <RackService def={def} slots={{ tabs: [filesTab('files')] }} />
 *
 * The bytes live on the service (rackstore's mount_uploads, under the project's
 * uploads/ folder); a record keeps only { id, name, size, type, at, by }. So a
 * service needs `mount_uploads(app, DATA / "uploads")` in its backend to use it.
 * The inline `files` type (types.jsx) stays for small files that should travel
 * inside the record itself.
 *
 * The tab lists every file of every item, newest first, as a table or — for
 * pictures — a gallery that opens one at a time, ← → to move, Esc to close.
 */
import { useMemo, useRef, useState } from 'react'
import { addStrings, tr } from 'lilak-ui/i18n.jsx'
import Lightbox from 'lilak-ui/components/Lightbox.jsx'
import { PORTAL_BASE, authHeaders, projectKey } from './portal.js'
import { registerType } from './types.jsx'
import { RackTable, RackRow } from './table.jsx'
import { useColumnWidths, useViewportWidth } from './hooks.js'
import './uploads.css'

addStrings({
  ko: {
    up_add: '+ 파일', up_adding: '올리는 중…', up_none: '없음', up_failed: (n, why) => `${n}: 올리지 못했습니다 (${why}).`,
    up_remove: '이 항목에서 빼기', up_table: '표', up_gallery: '갤러리', up_find: '파일 이름·항목으로 찾기',
    up_name: '파일', up_size: '크기', up_of: '항목', up_when: '올린 때', up_by: '올린 사람',
    up_count: (n) => `파일 ${n}개`, up_no_files: '아직 올린 파일이 없습니다.', up_no_pictures: '그림이 없습니다.',
    up_download: '내려받기',
  },
  en: {
    up_add: '+ file', up_adding: 'uploading…', up_none: 'none', up_failed: (n, why) => `${n}: upload failed (${why}).`,
    up_remove: 'remove from this item', up_table: 'table', up_gallery: 'gallery', up_find: 'find by file or item',
    up_name: 'file', up_size: 'size', up_of: 'item', up_when: 'uploaded', up_by: 'by',
    up_count: (n) => `${n} files`, up_no_files: 'No files uploaded yet.', up_no_pictures: 'No pictures.',
    up_download: 'download',
  },
})

const list = (v) => (Array.isArray(v) ? v.filter((f) => f && f.id) : [])
const size = (n) => (!n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const isPicture = (f) => String(f.type || '').startsWith('image/')

/** Where a stored file is read from (download: as a file rather than shown). */
export const uploadUrl = (f, download) =>
  `${PORTAL_BASE}/api/uploads/${f.id}/${encodeURIComponent(f.name)}${download ? '?download=1' : ''}`

/** One file to the service; answers what a record keeps of it. */
export async function uploadFile(file) {
  const r = await fetch(`${PORTAL_BASE}/api/uploads?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', ...authHeaders() },
  })
  const got = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(got.detail || r.status)
  return got
}

function Uploads({ value, onChange, ctx }) {
  const pick = useRef(null)
  const [busy, setBusy] = useState(false)
  const files = list(value)
  async function add(e) {
    const got = [...(e.target.files || [])]
    e.target.value = ''
    setBusy(true)
    const added = []
    for (const f of got) {
      try { added.push(await uploadFile(f)) } catch (err) { ctx?.say?.(tr('up_failed', f.name, err.message)) }
    }
    setBusy(false)
    if (added.length) onChange([...files, ...added])
  }
  return (
    <div className="rl-up">
      {files.length === 0 && <span className="rl-hint">{tr('up_none')}</span>}
      {files.map((f) => (
        <div key={f.id} className="rl-up-row">
          {isPicture(f) ? <img className="rl-up-thumb" src={uploadUrl(f)} alt="" loading="lazy" /> : <span className="rl-up-kind">{(f.name.split('.').pop() || '').slice(0, 4)}</span>}
          <a className="rl-up-name" href={uploadUrl(f)} target="_blank" rel="noreferrer">{f.name}</a>
          <span className="rl-hint">{size(f.size)}</span>
          <button type="button" className="rl-x" title={tr('up_remove')}
            onClick={() => onChange(files.filter((x) => x.id !== f.id))}>×</button>
        </div>
      ))}
      <div>
        <button type="button" className="rl-btn" disabled={busy} onClick={() => pick.current?.click()}>
          {busy ? tr('up_adding') : tr('up_add')}
        </button>
        <input ref={pick} type="file" multiple hidden onChange={add} />
      </div>
    </div>
  )
}

registerType('uploads', {
  empty: () => [],
  text: (v) => list(v).map((f) => f.name).join(' '),
  cell: (v) => (list(v).length ? `📎 ${list(v).length}` : ''),
  sort: (v) => list(v).length || null,
  Edit: (p) => <Uploads {...p} />,
})

/** Every file of every item, newest first: { f, rec }. */
export function filesOf(def, doc, field) {
  const out = []
  for (const rec of doc?.[def.item.key] || []) for (const f of list(rec[field])) out.push({ f, rec })
  return out.sort((a, b) => String(b.f.at || '').localeCompare(String(a.f.at || '')))
}

const FILE_COLS = [
  { k: 'num', w: 40, min: 30, fix: true, label: '#' },
  { k: 'name', w: 320, min: 120, label: tr('up_name') },
  { k: 'of', w: 260, min: 80, label: tr('up_of') },
  { k: 'size', w: 70, min: 50, label: tr('up_size'), num: true, drop: 900 },
  { k: 'when', w: 130, min: 80, label: tr('up_when'), drop: 1000 },
  { k: 'by', w: 140, min: 60, label: tr('up_by'), drop: 1100 },
]

/** The tab: the files in the rack table every list is drawn with, or a gallery
 *  of the pictures. */
export function RackFiles({ api, field }) {
  const { def, doc, openItem } = api
  const idk = def.item.id || 'id'
  const labelOf = (rec) => {
    const l = def.item.label
    return (typeof l === 'function' ? l(rec) : rec[l || 'name']) || rec[idk] || ''
  }
  const [view, setView] = useState('table')
  const [q, setQ] = useState('')
  const [at, setAt] = useState(-1)
  const all = useMemo(() => filesOf(def, doc, field), [def, doc, field])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = all.filter(({ f, rec }) => {
    const hay = `${f.name} ${labelOf(rec)}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  const pictures = rows.filter(({ f }) => isPicture(f))
  const open = (rec) => openItem?.(rec[idk], rec)
  const shown = at >= 0 ? pictures[at] : null
  const { drag, sized } = useColumnWidths(projectKey('files', 'cols'), FILE_COLS)
  const vw = useViewportWidth()
  const cols = sized(FILE_COLS, vw)

  return (
    <div className="rl-files">
      <div className="rl-files-bar">
        <input className="rl-files-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('up_find')} />
        <span className="rl-hint">{tr('up_count', rows.length)}</span>
        <span className="rl-files-views">
          {['table', 'gallery'].map((v) => (
            <button key={v} type="button" className={`rl-btn${view === v ? ' rl-go' : ''}`} onClick={() => setView(v)}>
              {tr(v === 'table' ? 'up_table' : 'up_gallery')}
            </button>
          ))}
        </span>
      </div>

      {view === 'table' && (
        <RackTable cols={cols} onDrag={drag('')}>
          {rows.map(({ f, rec }, i) => (
            <RackRow key={f.id} cols={cols} className="rl-hit" tone={{ size: 'dim', when: 'dim', by: 'dim' }} cell={{
              num: i + 1,
              name: (
                <span className="rl-files-name">
                  {isPicture(f) && <img className="rl-up-thumb" src={uploadUrl(f)} alt="" loading="lazy" />}
                  <a href={uploadUrl(f)} target="_blank" rel="noreferrer">{f.name}</a>
                  <a className="rl-hint" href={uploadUrl(f, true)} title={tr('up_download')}>↓</a>
                </span>),
              of: <button type="button" className="rl-lnk" onClick={() => open(rec)}>{labelOf(rec)}</button>,
              size: size(f.size),
              when: String(f.at || '').slice(0, 16).replace('T', ' '),
              by: f.by || '',
            }} />
          ))}
          {rows.length === 0 && <p className="rl-msg">{tr('up_no_files')}</p>}
        </RackTable>
      )}

      {view === 'gallery' && (pictures.length === 0 ? <p className="rl-msg">{tr('up_no_pictures')}</p> : (
        <div className="rl-gallery-scroll"><div className="rl-gallery">
          {pictures.map(({ f, rec }, i) => (
            <figure key={f.id} className="rl-gallery-cell">
              <button type="button" onClick={() => setAt(i)}><img src={uploadUrl(f)} alt={f.name} loading="lazy" /></button>
              <figcaption>
                <span>{f.name}</span>
                <button type="button" className="rl-linkish" onClick={() => open(rec)}>{labelOf(rec)}</button>
              </figcaption>
            </figure>
          ))}
        </div></div>
      ))}

      <Lightbox open={!!shown} src={shown ? uploadUrl(shown.f) : ''} alt={shown?.f.name}
        caption={shown ? `${shown.f.name} · ${labelOf(shown.rec)}` : ''} index={at} count={pictures.length}
        onClose={() => setAt(-1)}
        onPrev={pictures.length > 1 ? () => setAt((i) => (i - 1 + pictures.length) % pictures.length) : undefined}
        onNext={pictures.length > 1 ? () => setAt((i) => (i + 1) % pictures.length) : undefined} />
    </div>
  )
}

/** A service's own tab for the files of one of its `uploads` fields. */
export const filesTab = (field, { id = 'files', label } = {}) =>
  ({ id, label: label || tr('up_name'), render: (api) => <RackFiles api={api} field={field} /> })
