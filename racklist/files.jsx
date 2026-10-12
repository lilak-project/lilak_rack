import { useEffect, useState } from 'react'
import { PORTAL_BASE, authHeaders } from './portal.js'
import { registerType } from './types.jsx'
import { RackActions } from './actions.jsx'
import { RackField, RackTextRows } from './fields.jsx'

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

async function post(p, body, say) {
  try {
    const r = await fetch(`${API}${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
    const got = await r.json().catch(() => ({}))
    if (!r.ok) { say?.(got.detail || '할 수 없습니다.'); return null }
    return got
  } catch (e) { say?.(String(e.message || e)); return null }
}
/** how: 'open' (the folder, or the file in its own app) or 'reveal' (show the
 *  file where it lives). */
export async function onDesktop(name, path, how, say) {
  const got = await post('/open', { name, path: path || '', how }, say)
  if (got) say?.(how === 'reveal' ? `폴더에서 보여줍니다 — ${got.path}` : `열었습니다 — ${got.path}`)
}
export async function copyText(text, say) {
  try { await navigator.clipboard.writeText(text); say?.(`복사했습니다 — ${text}`) }
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
  if (!folders) return <span className="rl-hint">폴더 목록을 읽는 중…</span>
  if (!roots.length) return <span className="rl-hint">폴더 루트가 정해지지 않았습니다 — settings 탭에서 정합니다.</span>
  if (!name) return <span className="rl-hint">이름이 정해지면 그 이름의 폴더와 연결됩니다.</span>
  if (!path) {
    // Folders no record is named after: the ones that could be this one's.
    const items = ctx.doc?.[ctx.def?.item?.key] || []
    const named = new Set(items.map((r) => nfc(field?.get ? field.get(r, ctx) : r[field?.k])).filter(Boolean))
    const orphans = Object.keys(folders.dirs || {}).filter((d) => !named.has(d)).sort()
    const shown = cand.includes('/') ? cand.split('/').filter(Boolean).pop() : cand
    async function adopt() {
      setBusy(true)
      const got = await post('/adopt', { source: cand, name }, say)
      if (got) { say?.(`'${shown}' → '${name}' 로 바꿔 연결했습니다.`); setCand(''); ctx.reloadFolders?.() }
      setBusy(false)
    }
    return (
      <div className={`rl-rows${over ? ' rl-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const p = droppedPath(e); if (p) setCand(p.replace(/\/$/, '')) }}>
        <span className="rl-hint">{roots[0]} 안에 '{name}' 폴더가 없습니다.</span>
        {cand ? (
          <div className="rl-rrow">
            <span className="rl-mono" title={cand}>{shown}</span>
            <span className="rl-hint">→ {name}</span>
            <button type="button" className="rl-btn rl-go" disabled={busy} onClick={adopt}>이름 바꿔 연결</button>
            <button type="button" className="rl-btn" onClick={() => setCand('')}>취소</button>
          </div>
        ) : (
          <div className="rl-rrow">
            <button type="button" className="rl-btn rl-go" disabled={busy} onClick={async () => {
              setBusy(true)
              if (await post('/make', { name }, say)) { say?.(`폴더를 만들었습니다 — ${name}`); ctx.reloadFolders?.() }
              setBusy(false)
            }}>폴더 만들기</button>
            {orphans.length > 0 && (
              <select className="rl-in" value="" onChange={(e) => setCand(e.target.value)}>
                <option value="">있는 폴더에 연결…</option>
                {orphans.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>
        )}
        <span className="rl-hint">
          {cand ? '그 폴더의 이름이 바뀝니다 (안의 파일은 그대로).'
            : 'Finder에서 폴더를 끌어다 놓아도 됩니다 — 루트 안의 폴더면 이 이름으로 바꿔 연결합니다.'}
        </span>
      </div>
    )
  }
  return (
    <div className="rl-rows" style={{ minWidth: 0 }}>
      <button type="button" className="rl-path rl-mono" title="경로 복사"
        onClick={() => copyText(path, say)}>{path}</button>
      <div className="rl-rrow">
        <button type="button" className="rl-btn" onClick={() => ctx.openFolder?.(name)}>열기</button>
        {onThisMachine && (
          <button type="button" className="rl-btn" onClick={() => onDesktop(name, '', 'open', say)}>폴더에서 보기</button>
        )}
        <button type="button" className="rl-btn" onClick={() => copyText(path, say)}>경로 복사</button>
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
      .then(async (r) => (r.ok ? setList(await r.json()) : setErr((await r.json().catch(() => ({}))).detail || '읽을 수 없습니다.')))
      .catch((e) => setErr(String(e.message || e)))
  }, [name, n])

  if (err) return <p className="rl-msg">{err}</p>
  if (!list) return <p className="rl-msg">읽는 중…</p>
  const full = pick ? `${list.path}/${pick}` : list.path

  return (
    <div className="rl-pdf">
      <div className="rl-pdfbar">
        <button type="button" className="rl-path rl-mono" title="경로 복사"
          onClick={() => copyText(full, say)}>{full}</button>
        <div className="rl-pdfacts">
          {pick ? (
            <>
              <button type="button" className="rl-btn" onClick={() => setPick('')}>← 목록</button>
              <a className="rl-btn" href={fileSrc(name, pick)} target="_blank" rel="noreferrer">새 창</a>
              <a className="rl-btn" href={fileSrc(name, pick, true)} download>내려받기</a>
              {onThisMachine && (
                <>
                  <button type="button" className="rl-btn" onClick={() => onDesktop(name, pick, 'open', say)}>앱에서 열기</button>
                  <button type="button" className="rl-btn" onClick={() => onDesktop(name, pick, 'reveal', say)}>폴더에서 보기</button>
                </>
              )}
            </>
          ) : (
            <>
              {onThisMachine && (
                <button type="button" className="rl-btn" onClick={() => onDesktop(name, '', 'open', say)}>폴더에서 보기</button>
              )}
              <button type="button" className="rl-btn" onClick={() => setN((x) => x + 1)}>새로 읽기</button>
            </>
          )}
          <span className="rl-sp" />
          <button type="button" className="rl-btn" onClick={() => copyText(full, say)}>경로 복사</button>
        </div>
      </div>
      {pick ? (
        VIEWABLE.test(pick)
          ? <iframe className="rl-pdfview" src={fileSrc(name, pick)} title={pick} />
          : <p className="rl-msg">브라우저가 보여줄 수 없는 형식입니다 — 내려받거나{onThisMachine ? ' 앱에서 여세요' : ' 하세요'}.</p>
      ) : (
        <div className="rl-files">
          {list.files.length === 0 && <p className="rl-msg">비어 있습니다.</p>}
          {list.files.map((f) => (
            <button key={f.path} type="button" className="rl-file" onClick={() => setPick(f.path)}
              onDoubleClick={() => onThisMachine && onDesktop(name, f.path, 'open', say)}
              title={onThisMachine ? '누르면 보기, 두 번 누르면 앱에서 열기' : '누르면 보기'}>
              <span className="rl-mono">{f.path}</span>
              <span className="rl-dim">{size(f.size)}</span>
              <span className="rl-dim rl-mono">{day(f.mtime)}</span>
            </button>
          ))}
          {list.more && <p className="rl-msg">2000개까지만 보입니다.</p>}
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
    say?.(r.ok ? `${got.where || '파일 관리자'}에서 열었습니다.` : (got.detail || '열 수 없습니다.'))
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
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '훑을 수 없습니다.')
  return (await r.json()).files || {}
}
/** The outermost of several copies is the one linked; the rest are noted. */
const pickHit = (hits) => {
  const sorted = [...hits].sort((a, b) => a.split('/').length - b.split('/').length)
  return { mode: 'path', path: sorted[0], ...(sorted.length > 1 ? { copies: sorted.slice(1) } : {}) }
}
/** A path dropped from Finder arrives as a file:// URL. */
const droppedPath = (e) => {
  const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || ''
  const one = uri.split(/\r?\n/).find((x) => x.startsWith('file://')) || uri.trim()
  try { return one.startsWith('file://') ? decodeURI(one.slice(7)) : one } catch { return one }
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
    if (!named) { say?.(`${field.find} 이(가) 있어야 찾을 수 있습니다.`); return }
    setBusy(true)
    try {
      const hits = (await scanFiles())[named] || []
      if (!hits.length) { say?.(`허용 루트에 ${named} 이(가) 없습니다.`); return }
      onChange(pickHit(hits))
      say?.(hits.length > 1 ? `${hits.length}개 찾음 — 가장 바깥 것을 연결했습니다.` : '연결했습니다.')
    } catch (e) { say?.(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className={`rl-rows${over ? ' rl-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false)
        const p = droppedPath(e)
        if (p) { set(p); say?.('경로를 받았습니다 — 허용 루트 안이어야 열립니다.') }
      }}>
      <div className="rl-rrow">
        <input className="rl-in rl-mono" style={{ width: '100%', minWidth: 260 }} value={path}
          placeholder="Finder에서 끌어다 놓거나 경로를 붙여넣으세요"
          onChange={(e) => set(e.target.value)} />
      </div>
      <div className="rl-rrow">
        {path ? (
          <>
            <a className="rl-btn" href={fileUrl(path)} target="_blank" rel="noreferrer">열기</a>
            <a className="rl-btn" href={fileUrl(path, true)} download>내려받기</a>
            {onThisMachine && (
              <button type="button" className="rl-btn" onClick={() => revealFile(path, say)}>폴더에서 보기</button>
            )}
            <button type="button" className="rl-btn" onClick={() => copyFilePath(path, say)}>경로 복사</button>
            <button type="button" className="rl-x" title="연결 끊기" onClick={() => set('')}>×</button>
          </>
        ) : field.find && (
          <button type="button" className="rl-btn rl-go" disabled={busy} onClick={look}>
            {busy ? '찾는 중…' : '찾기'}
          </button>
        )}
      </div>
      {(value?.copies || []).length > 0 && (
        <span className="rl-hint">사본 {value.copies.length}개: {value.copies.join(' · ')}</span>
      )}
    </div>
  )
}

/** One file, read in a pane. */
export function RackFilePane({ value, say }) {
  const path = filePath(value)
  if (!path) return <p className="rl-msg">파일이 연결되어 있지 않습니다.</p>
  return (
    <div className="rl-pdf">
      <div className="rl-pdfbar">
        <button type="button" className="rl-path rl-mono" title="경로 복사"
          onClick={() => copyFilePath(path, say)}>{path}</button>
        <div className="rl-pdfacts">
          {onThisMachine && (
            <button type="button" className="rl-btn" onClick={() => revealFile(path, say)}>폴더에서 보기</button>
          )}
          <a className="rl-btn" href={fileUrl(path)} target="_blank" rel="noreferrer">새 창</a>
          <a className="rl-btn" href={fileUrl(path, true)} download>내려받기</a>
          <span className="rl-sp" />
          <button type="button" className="rl-btn" onClick={() => copyFilePath(path, say)}>경로 복사</button>
        </div>
      </div>
      {VIEWABLE.test(path)
        ? <iframe className="rl-pdfview" src={fileUrl(path)} title={path} />
        : <p className="rl-msg">브라우저가 보여줄 수 없는 형식입니다 — 내려받으세요.</p>}
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
    if (await onSave({ settings: next }, '허용 루트를 저장했습니다.')) onReload?.()
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
      if (linked) await onSave({ [def.item.key]: next }, `${linked}${def.unit}에 파일을 연결했습니다.`)
      else say?.('새로 연결할 것이 없습니다.')
    } catch (e) { say?.(String(e.message || e)) } finally { setBusy(false) }
  }

  const finders = fields.filter(({ f }) => f.type === 'file' && f.find)
  return (
    <div className="rl-edit">
      <RackActions onSave={save} saveDisabled={!dirty} onRevert={() => setRoots(saved)}
        hint={dirty ? '저장하지 않은 변경이 있습니다.' : ''}
        extra={finders.map(({ f }) => (
          // It reads the roots the SERVICE has, which is why it waits for them to be saved.
          <button key={f.k} type="button" className="rl-btn" disabled={busy || dirty || !tidy(saved[f.roots || 'fileRoots']).length}
            title={dirty ? '먼저 저장하세요' : `파일 이름이 ${f.find}와 같으면 연결합니다`}
            onClick={() => linkAll(f)}>{busy ? '훑는 중…' : '루트를 훑어 연결'}</button>
        ))} />
      <div className="rl-rec">
        {keys.map((k) => {
          const users = fields.filter((x) => x.key === k).map((x) => x.f)
          const isFolder = users.some((f) => f.type === 'folder')
          return (
            <RackField key={k} label={`${users.map((f) => f.label).join(' · ')} 루트`}>
              {/* A root is easiest given by dropping the folder from Finder. */}
              <div className="rl-rows" onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const p = droppedPath(e).replace(/\/$/, '')
                  if (p) setRoots((s) => ({ ...s, [k]: [...(s[k] || []).filter((x) => str(x).trim() && x !== p), p] }))
                }}>
              <RackTextRows value={roots[k] || []} add="+ 루트" width={560}
                placeholder={isFolder ? '/Users/…/Academic Activities' : '/Users/…/Papers'}
                onChange={(v) => setRoots((s) => ({ ...s, [k]: v }))} />
              <span className="rl-hint">
                {isFolder ? '이 폴더들 바로 아래의 폴더가 같은 이름의 항목과 연결됩니다. ' : ''}
                이 폴더들 안의 파일만 서비스가 읽습니다. 심볼릭 링크를 풀어 확인하므로 루트 밖을 가리키는 링크는 거부됩니다.
                {' '}Finder에서 폴더를 여기로 끌어다 놓으면 루트로 들어갑니다. 루트를 바꿔도 폴더는 옮겨지지 않습니다{isFolder ? ' — 새 폴더는 첫 번째 루트에 만들어집니다' : ''}.
              </span>
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
            <RackField key={`${f.k}:state`} label={`${f.label} 연결`}>
              <div className="rl-rows">
                <span className="rl-hint rl-mono">
                  폴더 {dirs.length} · 연결 {linked} · 폴더 없는 {def.item.noun} {Math.max(0, items.length - linked)}
                </span>
                {orphans.length === 0
                  ? <span className="rl-hint">주인 없는 폴더 없음 — 모든 폴더가 {def.item.noun}과(와) 연결되어 있습니다.</span>
                  : <span className="rl-hint">주인 없는 폴더 — {def.item.noun}의 이름이나 폴더 이름을 고치면 연결됩니다:</span>}
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
          <RackField key={`${f.k}:state`} label={`${f.label} 연결`}>
            <div className="rl-rows">
              <span className="rl-hint">
                위의 <b>루트를 훑어 연결</b>이 저장된 루트를 훑어, 이름이 {f.find}와 같은 파일을 연결합니다.
              </span>
              {found && (
                <span className="rl-hint">
                  파일 {found.files}개 · 새로 연결 {found.linked} · 이미 있던 것 {found.already}
                </span>
              )}
            </div>
          </RackField>
        ))}
        <RackField label="문서">
          <span className="rl-hint rl-mono">
            {def.item.noun} {items.length}
            {def.classes.filter((c) => c.stored).map((c) => ` · ${c.label} ${(doc[c.k] || []).length}`).join('')}
            {fields.filter(({ f }) => f.type === 'file').map(({ f }) => ` · ${f.label} 연결 ${items.filter((r) => filePath(r[f.k])).length}`).join('')}
            {' · '}version {doc.version}
          </span>
        </RackField>
      </div>
    </div>
  )
}
