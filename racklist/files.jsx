import { useEffect, useState } from 'react'
import { PORTAL_BASE, authHeaders } from './portal.js'
import { registerType } from './types.jsx'
import { RackActions } from './actions.jsx'
import { RackField, RackTextRows } from './fields.jsx'

/**
 * A record's folder on disk, and the files in it — the rack's one way to say
 * "the material for this is over there".
 *
 *   { k: 'folder', label: '폴더', type: 'folder', get: (r) => r.key, col: 40 }
 *
 * The naming convention IS the link: the record whose name is
 * Academic_20131207_HIM2013 has the folder of that name under a root the
 * project lists (settings.folderRoots). Nothing is stored per record, so a
 * folder made by hand in Finder is linked the moment it exists.
 *
 * The backend half is lilak_portal_auth.store.mount_folders; the generator
 * mounts it when a declaration has a folder field. A browser cannot open
 * file://… from an http page, so the service reads the files for it — and
 * opening something on the desktop happens on the machine the BACKEND is on,
 * which is why those buttons are offered only when that is this one.
 *
 *   table      ✓ when the folder is there → the folder pane
 *   editor     the path · 열기 · 폴더에서 보기 · 경로 복사 (or 폴더 만들기)
 *   pane       the files; one picked is shown, with 새 창 · 내려받기 ·
 *              앱에서 열기 · 폴더에서 보기 · 경로 복사
 *   설정        the roots, and the folders no record is named after
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
  Show: ({ value, ctx }) => <FolderRow name={value} ctx={ctx} />,
})

function FolderRow({ name, ctx }) {
  const [busy, setBusy] = useState(false)
  const { folders, say } = ctx
  const path = folderPathOf(name, folders)
  const roots = folders?.roots || []
  if (!folders) return <span className="rl-hint">폴더 목록을 읽는 중…</span>
  if (!roots.length) return <span className="rl-hint">폴더 루트가 정해지지 않았습니다 — 설정에서 정합니다.</span>
  if (!name) return <span className="rl-hint">이름이 정해지면 그 이름의 폴더와 연결됩니다.</span>
  if (!path) {
    return (
      <div className="rl-rows">
        <span className="rl-hint">{roots[0]} 안에 '{name}' 폴더가 없습니다.</span>
        <div className="rl-rrow">
          <button type="button" className="rl-btn rl-go" disabled={busy} onClick={async () => {
            setBusy(true)
            if (await post('/make', { name }, say)) { say?.(`폴더를 만들었습니다 — ${name}`); ctx.reloadFolders?.() }
            setBusy(false)
          }}>폴더 만들기</button>
        </div>
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

// ─── the settings ─────────────────────────────────────────────────────────
/** Where the folders are. A settings page is a record like any other: change,
 *  look, save — a half-typed root is not a root the service should read. */
export function RackFolderRoots({ doc, folders, names, onSave, onReload, onOpen }) {
  const saved = (doc.settings || {}).folderRoots || []
  const [roots, setRoots] = useState(saved)
  useEffect(() => { setRoots(saved) }, [saved.join('\u0000')])   // eslint-disable-line react-hooks/exhaustive-deps
  const tidy = (v) => v.map((x) => str(x).trim()).filter(Boolean)
  const dirty = tidy(roots).join('\u0000') !== tidy(saved).join('\u0000')
  const dirs = Object.keys(folders?.dirs || {})
  const named = new Set(names.map(nfc))
  const orphans = dirs.filter((d) => !named.has(d)).sort()
  const linked = dirs.length - orphans.length

  return (
    <div className="rl-edit">
      <RackActions onSave={async () => {
        if (await onSave({ settings: { ...(doc.settings || {}), folderRoots: tidy(roots) } }, '폴더 루트를 저장했습니다.')) onReload()
      }} saveDisabled={!dirty} onRevert={() => setRoots(saved)}
        hint={dirty ? '저장하지 않은 변경이 있습니다.' : ''} />
      <div className="rl-rec">
        <RackField label="폴더 루트">
          <RackTextRows value={roots} add="+ 루트" placeholder="/Users/…/Academic Activities" onChange={setRoots} width={560} />
          <span className="rl-hint">
            이 폴더들 바로 아래의 폴더가 같은 이름의 항목과 연결됩니다. 그 안의 파일만 서비스가 읽습니다.
          </span>
        </RackField>
        <RackField label="연결">
          <span className="rl-hint rl-mono">
            폴더 {dirs.length} · 연결 {linked} · 폴더 없는 항목 {Math.max(0, names.length - linked)}
          </span>
        </RackField>
        <RackField label="주인 없는 폴더">
          <div className="rl-rows">
            {orphans.length === 0 && <span className="rl-hint">없음 — 모든 폴더가 항목과 연결되어 있습니다.</span>}
            {orphans.map((d) => (
              <div key={d} className="rl-rrow">
                <button type="button" className="rl-lnk rl-mono" onClick={() => onOpen(d)}>{d}</button>
              </div>
            ))}
            {orphans.length > 0 && <span className="rl-hint">항목의 이름이나 폴더 이름을 고치면 연결됩니다.</span>}
          </div>
        </RackField>
      </div>
    </div>
  )
}
