import './strings.js'
import { useEffect, useState } from 'react'
import { PORTAL_BASE, authHeaders } from './portal.js'
import { registerType } from './types.jsx'
import { RackActions } from './actions.jsx'
import { RackField, RackTextRows } from './fields.jsx'
import { tr } from '../i18n.jsx'

/**
 * Files on disk — the rack's one way to say "the material for this is over
 * there". Two field types, one settings page:
 *
 *   { k: 'folder', type: 'folder', get: (r) => r.key, col: 40 }
 *       A FOLDER per record, found by its name: the record named
 *       Academic_20131207_HIM2013 has the folder of that name under a root in
 *       settings.folderRoots. Nothing is stored per record, so a folder made by
 *       hand in Finder is linked the moment it exists.
 *       backend: lilak_portal_auth.store.mount_folders
 *
 *   { k: 'pdf', type: 'file', roots: 'pdfRoots', find: 'citeKey', col: 38 }
 *       ONE FILE per record, stored as { mode: 'path', path } — a path under a
 *       root in settings[roots]. It arrives dropped from Finder, pasted, or
 *       found: `find` names the field the file is named after (JAlmeid_ApJ_1983
 *       → JAlmeid_ApJ_1983.pdf), and the settings page links them all at once.
 *       backend: lilak_portal_auth.store.mount_files
 *
 * A browser cannot open file://… from an http page, so the service reads the
 * files for it — and opening something on the desktop happens on the machine
 * the BACKEND is on, which is why those buttons are offered only when that is
 * this one.
 *
 *   table      ✓ when it is there → a pane: the folder's files, or the file
 *   editor     the path · 열기 · 내려받기 · 폴더에서 보기 · 경로 복사
 *   pane       one file shown, with 새 창 · 내려받기 · 앱에서 열기 ·
 *              폴더에서 보기 · 경로 복사
 *   settings   (a tab, managers) the roots, what is linked, what is left over
 */

const D = '·'
const str = (v) => (v === null || v === undefined ? '' : String(v))
const nfc = (v) => str(v).normalize('NFC')
export const onThisMachine = typeof location !== 'undefined'
  && ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname)

const API = `${PORTAL_BASE}/api/folders`
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString()
/** The file as the service serves it — a plain link works because the portal
 *  reads the token from its cookie on a navigation. */
export const fileSrc = (name, path, download) => `${API}/file?${qs({ name, path, download: download ? 1 : undefined })}`

export const folderPathOf = (name, folders) => (name ? folders?.dirs?.[nfc(name)] || '' : '')
/** Where a new folder of this name would be made: beside the most folders of
 *  its kind (Proposal_… with the proposals), else the first root — the same
 *  rule the backend's /make follows. */
export function homeOf(name, folders) {
  const kind = `${nfc(name).split('_')[0]}_`
  const count = {}
  for (const [n, p] of Object.entries(folders?.dirs || {})) {
    if (n.startsWith(kind)) { const parent = p.slice(0, p.lastIndexOf('/')); count[parent] = (count[parent] || 0) + 1 }
  }
  const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0]
  return best || folders?.roots?.[0] || ''
}

async function post(p, body, say) {
  try {
    const r = await fetch(`${API}${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
    const got = await r.json().catch(() => ({}))
    if (!r.ok) { say?.(got.detail || tr("rk_cannot")); return null }
    return got
  } catch (e) { say?.(String(e.message || e)); return null }
}
/** how: 'open' (the folder, or the file in its own app) or 'reveal' (show the
 *  file where it lives). */
export async function onDesktop(name, path, how, say) {
  const got = await post('/open', { name, path: path || '', how }, say)
  if (got) say?.(how === 'reveal' ? tr("rk_revealed", got.path) : tr("rk_opened", got.path))
}
export async function copyText(text, say) {
  try { await navigator.clipboard.writeText(text); say?.(tr("rk_copied_text", text)) }
  catch { say?.(text) }     // no clipboard: the note line IS the copy
}

/** The folders under the roots — null until the service answers. */
export function useFolders(def) {
  const want = def.item.fields.some((f) => f.type === 'folder')
  const [got, setGot] = useState(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!want) return
    fetch(API, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { roots: [], dirs: {} }))
      .then(setGot).catch(() => setGot({ roots: [], dirs: {} }))
  }, [want, n])
  return [got, () => setN((x) => x + 1)]
}

// ─── the field ────────────────────────────────────────────────────────────
registerType('folder', {
  text: (v, ctx) => (folderPathOf(v, ctx.folders) ? str(v) : ''),
  sort: (v, ctx) => (folderPathOf(v, ctx.folders) ? 0 : null),   // with a folder first
  cell(v, ctx) {
    const path = folderPathOf(v, ctx.folders)
    if (!path) return D
    return (
      <button type="button" className="rl-ok rl-lnk" title={path}
        onClick={(e) => { e.stopPropagation(); ctx.openFolder?.(v) }}>✓</button>
    )
  },
  // Computed from the record's name, so shown rather than edited.
  Show: ({ value, ctx, field }) => <FolderRow name={value} ctx={ctx} field={field} />,
})

function FolderRow({ name, ctx, field }) {
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [cand, setCand] = useState('')     // a folder chosen or dropped, waiting for 연결
  const { folders, say } = ctx
  const path = folderPathOf(name, folders)
  const roots = folders?.roots || []
  useEffect(() => { setCand('') }, [name])
  if (!folders) return <span className="rl-hint">{tr("rk_folders_loading")}</span>
  if (!roots.length) return <span className="rl-hint">{tr("rk_no_folder_roots")}</span>
  if (!name) return <span className="rl-hint">{tr("rk_folder_by_name_hint")}</span>
  if (!path) {
    // Folders no record is named after: the ones that could be this one's.
    const items = ctx.doc?.[ctx.def?.item?.key] || []
    const named = new Set(items.map((r) => nfc(field?.get ? field.get(r, ctx) : r[field?.k])).filter(Boolean))
    const orphans = Object.keys(folders.dirs || {}).filter((d) => !named.has(d)).sort()
    const shown = cand.includes('/') ? cand.split('/').filter(Boolean).pop() : cand
    async function adopt() {
      setBusy(true)
      const got = await post('/adopt', { source: cand, name }, say)
      if (got) { say?.(tr("rk_renamed_and_linked", shown, name)); setCand(''); ctx.reloadFolders?.() }
      setBusy(false)
    }
    return (
      <div className={`rl-rows${over ? ' rl-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false)
          const got = dropped(e)
          if (got.why) say?.(got.why)
          else if (got.dir === false) say?.(tr("rk_is_file_not_folder", got.name))
          else setCand(got.path || got.name)
        }}>
        <span className="rl-hint">{tr("rk_folder_missing", name, homeOf(name, folders))}</span>
        {cand ? (
          <div className="rl-rrow">
            <span className="rl-mono" title={cand}>{shown}</span>
            <span className="rl-hint">→ {name}</span>
            <button type="button" className="rl-btn rl-go" disabled={busy} onClick={adopt}>{tr("rk_rename_and_link")}</button>
            <button type="button" className="rl-btn" onClick={() => setCand('')}>{tr("rk_cancel")}</button>
          </div>
        ) : (
          <div className="rl-rrow">
            <button type="button" className="rl-btn rl-go" disabled={busy} onClick={async () => {
              setBusy(true)
              if (await post('/make', { name }, say)) { say?.(tr("rk_folder_made", name)); ctx.reloadFolders?.() }
              setBusy(false)
            }}>{tr("rk_make_folder")}</button>
            {orphans.length > 0 && (
              <select className="rl-in" value="" onChange={(e) => setCand(e.target.value)}>
                <option value="">{tr("rk_link_existing_folder")}</option>
                {orphans.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>
        )}
        <span className="rl-hint">
          {cand ? tr("rk_folder_will_rename")
            : tr("rk_drop_folder_hint")}
        </span>
      </div>
    )
  }
  return (
    <div className="rl-rows" style={{ minWidth: 0 }}>
      <button type="button" className="rl-path rl-mono" title={tr("rk_copy_path")}
        onClick={() => copyText(path, say)}>{path}</button>
      <div className="rl-rrow">
        <button type="button" className="rl-btn" onClick={() => ctx.openFolder?.(name)}>{tr("rk_open")}</button>
        {onThisMachine && (
          <button type="button" className="rl-btn" onClick={() => onDesktop(name, '', 'open', say)}>{tr("rk_show_in_folder")}</button>
        )}
        <button type="button" className="rl-btn" onClick={() => copyText(path, say)}>{tr("rk_copy_path")}</button>
      </div>
    </div>
  )
}

// ─── the pane ─────────────────────────────────────────────────────────────
// What a browser can show by itself; anything else is downloaded or opened in
// its own app.
const VIEWABLE = /\.(pdf|png|jpe?g|gif|svg|webp|txt|md|csv|json|log|mp4|mov|webm|mp3|wav)$/i
const size = (b) => (b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(0)} KB`
  : b < 1 << 30 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${(b / (1 << 30)).toFixed(1)} GB`)
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10)

/** One folder: its files, and the one you picked. */
export function RackFolder({ name, say }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    setErr('')
    fetch(`${API}/list?${qs({ name })}`, { headers: authHeaders() })
      .then(async (r) => (r.ok ? setList(await r.json()) : setErr((await r.json().catch(() => ({}))).detail || tr("rk_cannot_read"))))
      .catch((e) => setErr(String(e.message || e)))
  }, [name, n])

  if (err) return <p className="rl-msg">{err}</p>
  if (!list) return <p className="rl-msg">{tr("rk_loading")}</p>
  const full = pick ? `${list.path}/${pick}` : list.path

  return (
    <div className="rl-pdf">
      <div className="rl-pdfbar">
        <button type="button" className="rl-path rl-mono" title={tr("rk_copy_path")}
          onClick={() => copyText(full, say)}>{full}</button>
        <div className="rl-pdfacts">
          {pick ? (
            <>
              <button type="button" className="rl-btn" onClick={() => setPick('')}>{tr("rk_back_to_list")}</button>
              <a className="rl-btn" href={fileSrc(name, pick)} target="_blank" rel="noreferrer">{tr("rk_new_window")}</a>
              <a className="rl-btn" href={fileSrc(name, pick, true)} download>{tr("rk_download")}</a>
              {onThisMachine && (
                <>
                  <button type="button" className="rl-btn" onClick={() => onDesktop(name, pick, 'open', say)}>{tr("rk_open_in_app")}</button>
                  <button type="button" className="rl-btn" onClick={() => onDesktop(name, pick, 'reveal', say)}>{tr("rk_show_in_folder")}</button>
                </>
              )}
            </>
          ) : (
            <>
              {onThisMachine && (
                <button type="button" className="rl-btn" onClick={() => onDesktop(name, '', 'open', say)}>{tr("rk_show_in_folder")}</button>
              )}
              <button type="button" className="rl-btn" onClick={() => setN((x) => x + 1)}>{tr("rk_reload")}</button>
            </>
          )}
          <span className="rl-sp" />
          <button type="button" className="rl-btn" onClick={() => copyText(full, say)}>{tr("rk_copy_path")}</button>
        </div>
      </div>
      {pick ? (
        VIEWABLE.test(pick)
          ? <iframe className="rl-pdfview" src={fileSrc(name, pick)} title={pick} />
          : <p className="rl-msg">{onThisMachine ? tr('rk_cannot_show_open_app') : tr('rk_cannot_show_download')}</p>
      ) : (
        <div className="rl-files">
          {list.files.length === 0 && <p className="rl-msg">{tr("rk_empty")}</p>}
          {list.files.map((f) => (
            <button key={f.path} type="button" className="rl-file" onClick={() => setPick(f.path)}
              onDoubleClick={() => onThisMachine && onDesktop(name, f.path, 'open', say)}
              title={onThisMachine ? tr("rk_click_view_dbl_app") : tr("rk_click_view")}>
              <span className="rl-mono">{f.path}</span>
              <span className="rl-dim">{size(f.size)}</span>
              <span className="rl-dim rl-mono">{day(f.mtime)}</span>
            </button>
          ))}
          {list.more && <p className="rl-msg">{tr("rk_shows_2000")}</p>}
        </div>
      )}
    </div>
  )
}

// ─── one file ─────────────────────────────────────────────────────────────
const FAPI = `${PORTAL_BASE}/api`
const filePath = (v) => str(v?.path || v?.name)
export const fileUrl = (path, download) => `${FAPI}/file?${qs({ path, download: download ? 1 : undefined })}`
async function revealFile(path, say) {
  try {
    const r = await fetch(`${FAPI}/reveal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ path }),
    })
    const got = await r.json().catch(() => ({}))
    say?.(r.ok ? tr("rk_opened_in", got.where || tr("rk_file_manager")) : (got.detail || tr("rk_cannot_open")))
  } catch (e) { say?.(String(e.message || e)) }
}
/** Where the file IS, whole: the record keeps a path relative to a root, and
 *  only the service knows which root it was found under. */
async function copyFilePath(path, say) {
  let full = path
  try {
    const r = await fetch(`${FAPI}/realpath?${qs({ path })}`, { headers: authHeaders() })
    if (r.ok) full = (await r.json()).path || path
  } catch { /* the relative path is better than nothing */ }
  copyText(full, say)
}
/** Every file under the roots, by its name without the extension. */
export async function scanFiles() {
  const r = await fetch(`${FAPI}/scan`, { headers: authHeaders() })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || tr("rk_cannot_scan"))
  return (await r.json()).files || {}
}
/** The outermost of several copies is the one linked; the rest are noted. */
const pickHit = (hits) => {
  const sorted = [...hits].sort((a, b) => a.split('/').length - b.split('/').length)
  return { mode: 'path', path: sorted[0], ...(sorted.length > 1 ? { copies: sorted.slice(1) } : {}) }
}
/** A path dropped from Finder, when the browser tells (a file:// URL) —
 *  Chrome and Safari do not, for files; they give only the name. */
const droppedPath = (e) => {
  const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || ''
  const one = uri.split(/\r?\n/).find((x) => x.startsWith('file://')) || uri.trim()
  let p = one
  try { p = one.startsWith('file://') ? decodeURI(one.slice(7)) : one } catch { /* as it came */ }
  return p.startsWith('/') ? p.replace(/\/$/, '') : ''
}
/** What was dropped: its path when the browser says, else its name and
 *  whether it is a folder. Read while the drop event lasts. */
function dropped(e) {
  const path = droppedPath(e)
  if (path) return { path, name: path.split('/').pop() }
  const item = [...(e.dataTransfer.items || [])].find((i) => i.kind === 'file')
  const entry = item?.webkitGetAsEntry?.()
  if (entry) return { name: entry.name, dir: entry.isDirectory }
  const f = e.dataTransfer.files?.[0]
  if (f) return { name: f.name }
  return { why: tr("rk_drop_no_name", [...(e.dataTransfer.types || [])].join(', ') || tr("rk_empty_drop")) }
}

registerType('file', {
  empty: () => null,
  text: (v, ctx) => (filePath(v) ? (ctx.field.label || 'file') : ''),
  cell(v, ctx) {
    const path = filePath(v)
    if (!path) return D
    return (
      <button type="button" className="rl-ok rl-lnk" title={path}
        onClick={(e) => { e.stopPropagation(); ctx.openFile?.(ctx.rec, ctx.field) }}>✓</button>
    )
  },
  Edit: (p) => <FileRow {...p} />,
})

/** A record's file: where it is, and the three ways to say where. A file picker
 *  cannot tell a web page a PATH — only its contents — so the path is dropped
 *  from Finder (a file:// URL), pasted (⌥⌘C copies one), or found by name. */
function FileRow({ value, onChange, field, ctx, rec }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const say = ctx.say
  const path = filePath(value)
  const set = (p) => onChange(p ? { ...(value || {}), mode: 'path', path: p } : null)
  const named = field.find ? str(rec?.[field.find]).trim() : ''

  async function look() {
    if (!named) { say?.(tr("rk_needs_x_to_find", field.find)); return }
    setBusy(true)
    try {
      const hits = (await scanFiles())[named] || []
      if (!hits.length) { say?.(tr("rk_not_in_roots", named)); return }
      onChange(pickHit(hits))
      say?.(hits.length > 1 ? tr("rk_found_n_linked_outer", hits.length) : tr("rk_linked"))
    } catch (e) { say?.(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className={`rl-rows${over ? ' rl-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault(); setOver(false)
        const got = dropped(e)
        if (got.why) { say?.(got.why); return }
        if (got.path) { set(got.path); say?.(tr("rk_got_path")); return }
        // Only the name came: find the file of that name under the roots.
        const stem = got.name.replace(/\.[^.]+$/, '').normalize('NFC')
        try {
          const hits = (await scanFiles())[stem] || []
          if (!hits.length) { say?.(tr("rk_not_found_in_roots", got.name)); return }
          onChange(pickHit(hits))
          say?.(hits.length > 1 ? tr("rk_found_n_linked_outer", hits.length) : tr("rk_linked_x", got.name))
        } catch (err) { say?.(String(err.message || err)) }
      }}>
      <div className="rl-rrow">
        <input className="rl-in rl-mono" style={{ width: '100%', minWidth: 260 }} value={path}
          placeholder={tr("rk_drop_or_paste")}
          onChange={(e) => set(e.target.value)} />
      </div>
      <div className="rl-rrow">
        {path ? (
          <>
            <a className="rl-btn" href={fileUrl(path)} target="_blank" rel="noreferrer">{tr("rk_open")}</a>
            <a className="rl-btn" href={fileUrl(path, true)} download>{tr("rk_download")}</a>
            {onThisMachine && (
              <button type="button" className="rl-btn" onClick={() => revealFile(path, say)}>{tr("rk_show_in_folder")}</button>
            )}
            <button type="button" className="rl-btn" onClick={() => copyFilePath(path, say)}>{tr("rk_copy_path")}</button>
            <button type="button" className="rl-x" title={tr("rk_unlink")} onClick={() => set('')}>×</button>
          </>
        ) : field.find && (
          <button type="button" className="rl-btn rl-go" disabled={busy} onClick={look}>
            {busy ? tr("rk_searching") : tr("rk_find")}
          </button>
        )}
      </div>
      {(value?.copies || []).length > 0 && (
        <span className="rl-hint">{tr("rk_copies_n", value.copies.length, value.copies.join(' · '))}</span>
      )}
    </div>
  )
}

/** One file, read in a pane. */
export function RackFilePane({ value, say }) {
  const path = filePath(value)
  if (!path) return <p className="rl-msg">{tr("rk_no_file_linked")}</p>
  return (
    <div className="rl-pdf">
      <div className="rl-pdfbar">
        <button type="button" className="rl-path rl-mono" title={tr("rk_copy_path")}
          onClick={() => copyFilePath(path, say)}>{path}</button>
        <div className="rl-pdfacts">
          {onThisMachine && (
            <button type="button" className="rl-btn" onClick={() => revealFile(path, say)}>{tr("rk_show_in_folder")}</button>
          )}
          <a className="rl-btn" href={fileUrl(path)} target="_blank" rel="noreferrer">{tr("rk_new_window")}</a>
          <a className="rl-btn" href={fileUrl(path, true)} download>{tr("rk_download")}</a>
          <span className="rl-sp" />
          <button type="button" className="rl-btn" onClick={() => copyFilePath(path, say)}>{tr("rk_copy_path")}</button>
        </div>
      </div>
      {VIEWABLE.test(path)
        ? <iframe className="rl-pdfview" src={fileUrl(path)} title={path} />
        : <p className="rl-msg">{tr("rk_cannot_show_download_only")}</p>}
    </div>
  )
}

// ─── the settings ─────────────────────────────────────────────────────────
/** The settings each field on disk reads its roots from. */
function rootFields(def) {
  return def.item.fields.filter((f) => f.type === 'folder' || f.type === 'file')
    .map((f) => ({ f, key: f.roots || (f.type === 'folder' ? 'folderRoots' : 'fileRoots') }))
}
export const hasRoots = (def) => rootFields(def).length > 0

/** Where the service may read the disk, and what that links. A manager's page:
 *  it is the one setting that decides what the backend will open. A settings
 *  page is a record like any other — change, look, save; a half-typed root is
 *  not a root the service should try to read. */
export function RackSettings({ def, doc, folders, onSave, say, onReload, onOpenFolder }) {
  const fields = rootFields(def)
  const keys = [...new Set(fields.map((x) => x.key))]
  const saved = Object.fromEntries(keys.map((k) => [k, (doc.settings || {})[k] || []]))
  const [roots, setRoots] = useState(saved)
  const sig = JSON.stringify(saved)
  useEffect(() => { setRoots(saved) }, [sig])   // eslint-disable-line react-hooks/exhaustive-deps
  const tidy = (v) => (v || []).map((x) => str(x).trim()).filter(Boolean)
  const dirty = keys.some((k) => tidy(roots[k]).join('\u0000') !== tidy(saved[k]).join('\u0000'))
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(null)
  const items = doc[def.item.key] || []

  async function save() {
    const next = { ...(doc.settings || {}) }
    for (const k of keys) next[k] = tidy(roots[k])
    if (await onSave({ settings: next }, tr("rk_roots_saved"))) onReload?.()
  }
  /** Every record whose file is named after it, linked in one pass. */
  async function linkAll(f) {
    setBusy(true)
    try {
      const files = await scanFiles()
      let linked = 0, already = 0
      const next = items.map((r) => {
        const hits = files[str(r[f.find]).trim()]
        if (!hits?.length) return r
        if (filePath(r[f.k])) { already += 1; return r }
        linked += 1
        return { ...r, [f.k]: pickHit(hits) }
      })
      setFound({ files: Object.keys(files).length, linked, already })
      if (linked) await onSave({ [def.item.key]: next }, tr("rk_linked_files_n", linked, def.unit))
      else say?.(tr("rk_nothing_new_to_link"))
    } catch (e) { say?.(String(e.message || e)) } finally { setBusy(false) }
  }

  const finders = fields.filter(({ f }) => f.type === 'file' && f.find)
  return (
    <div className="rl-edit">
      <RackActions onSave={save} saveDisabled={!dirty} onRevert={() => setRoots(saved)}
        hint={dirty ? tr("rk_unsaved_changes") : ''}
        extra={finders.map(({ f }) => (
          // It reads the roots the SERVICE has, which is why it waits for them to be saved.
          <button key={f.k} type="button" className="rl-btn" disabled={busy || dirty || !tidy(saved[f.roots || 'fileRoots']).length}
            title={dirty ? tr("rk_save_first") : tr("rk_links_when_name_matches", f.find)}
            onClick={() => linkAll(f)}>{busy ? tr("rk_scanning") : tr("rk_scan_and_link")}</button>
        ))} />
      <div className="rl-rec">
        {keys.map((k) => {
          const users = fields.filter((x) => x.key === k).map((x) => x.f)
          const isFolder = users.some((f) => f.type === 'folder')
          return (
            <RackField key={k} label={tr("rk_x_roots", users.map((f) => f.label).join(' · '))}>
              {/* A root is easiest given by dropping the folder from Finder. */}
              <div className="rl-rows" onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const got = dropped(e)
                  // A root needs the whole path, and only some browsers give it.
                  if (!got.path) { say?.(tr("rk_browser_no_path")); return }
                  const p = got.path
                  setRoots((s) => ({ ...s, [k]: [...(s[k] || []).filter((x) => str(x).trim() && x !== p), p] }))
                }}>
              <RackTextRows value={roots[k] || []} add={tr("rk_add_root")} width={560}
                placeholder={isFolder ? '/Users/…/Academic Activities' : '/Users/…/Papers'}
                onChange={(v) => setRoots((s) => ({ ...s, [k]: v }))} />
              <span className="rl-hint">{isFolder ? tr('rk_roots_hint_folders') : tr('rk_roots_hint_files')}</span>
              </div>
            </RackField>
          )
        })}
        {fields.filter(({ f }) => f.type === 'folder').map(({ f }) => {
          const dirs = Object.keys(folders?.dirs || {})
          const named = new Set(items.map((r) => nfc(f.get ? f.get(r, { doc }) : r[f.k])).filter(Boolean))
          const orphans = dirs.filter((d) => !named.has(d)).sort()
          const linked = dirs.length - orphans.length
          return (
            <RackField key={`${f.k}:state`} label={tr("rk_x_links", f.label)}>
              <div className="rl-rows">
                <span className="rl-hint rl-mono">{tr("rk_folder_stats", dirs.length, linked, def.item.noun, Math.max(0, items.length - linked))}</span>
                {orphans.length === 0
                  ? <span className="rl-hint">{tr("rk_no_orphans", def.item.noun)}</span>
                  : <span className="rl-hint">{tr("rk_orphans", def.item.noun)}</span>}
                {orphans.map((d) => (
                  <div key={d} className="rl-rrow">
                    <button type="button" className="rl-lnk rl-mono" onClick={() => onOpenFolder?.(d)}>{d}</button>
                  </div>
                ))}
              </div>
            </RackField>
          )
        })}
        {finders.map(({ f }) => (
          <RackField key={`${f.k}:state`} label={tr("rk_x_links", f.label)}>
            <div className="rl-rows">
              <span className="rl-hint">{tr("rk_above")} <b>{tr("rk_scan_and_link")}</b>{tr("rk_scan_hint", f.find)}</span>
              {found && (
                <span className="rl-hint">{tr("rk_scan_stats", found.files, found.linked, found.already)}</span>
              )}
            </div>
          </RackField>
        ))}
        <RackField label={tr("rk_documents")}>
          <span className="rl-hint rl-mono">
            {def.item.noun} {items.length}
            {def.classes.filter((c) => c.stored).map((c) => ` · ${c.label} ${(doc[c.k] || []).length}`).join('')}
            {fields.filter(({ f }) => f.type === 'file').map(({ f }) => tr("rk_x_linked_n", f.label, items.filter((r) => filePath(r[f.k])).length)).join('')}
            {' · '}version {doc.version}
          </span>
        </RackField>
      </div>
    </div>
  )
}
