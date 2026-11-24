import './strings.js'
import { useEffect, useState } from 'react'
import { tr, currentLang } from 'lilak-ui/i18n.jsx'
import Icon from 'lilak-ui/icons.jsx'
import { PORTAL_BASE, PORTAL_SERVICE, authHeaders, isManager } from './portal.js'
import { copyText } from './files.jsx'

/**
 * The browsing tab: a folder on the host, its folders and files, for a person to pick one and
 * the service to carry on with it. Any rack service opens it:
 *
 *   openBrowse(ctx, { title, want: 'dir' | 'file', start, pickLabel, onPick(path), from: the button pressed })
 *
 * opens an editor tab (kind 'browse') beside the one that asked; picking calls onPick and closes
 * it. Opened with no request (a tab left from before a reload) it only browses.
 *
 * Where it may look is the service's to say (backend: rackstore.browse.mount_browse): the allowed
 * folders in its settings, each one approved by the portal for this service. Their list, and the
 * saved shortcuts, are edited here; a portal manager also answers the portal's approvals here
 * (/api/admin/reach), for the folders this service asked about.
 */

const requests = new Map()
/** Is someone waiting for this browsing tab's pick (opened since the page loaded)? */
export const browseAsked = (key) => requests.has(key)
let next = 1
export function openBrowse(ctx, req = {}) {
  const key = `b${Date.now().toString(36)}${next++}`
  requests.set(key, req)
  ctx.openEdit({ id: `browse:${key}`, kind: 'browse', who: key, label: req.title || tr('rk_browse'), col: otherSide(req.from) })
  return key
}

/** The editor column across from the one asking (the button pressed is in it), when there is room:
 *  that column is open already, or the window is wide. Else the same column. */
function otherSide(from) {
  const at = (from || document.activeElement)?.closest?.('.rl-epane')?.dataset.col
  if (at == null || at === 'full') return undefined
  const other = Number(at) === 0 ? 1 : 0
  const open = !!document.querySelector(`.rl-epane[data-col="${other}"]`)
  return open || window.innerWidth >= 1600 ? other : undefined
}

const API = `${PORTAL_BASE}/api/browse`
const ask = async (url, init) => {
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}lang=${currentLang()}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Lang': currentLang(), ...authHeaders(), ...(init?.headers || {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.detail || `${r.status}`)
  return body
}
const size = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`)
const day = (t) => (t ? new Date(t * 1000).toLocaleString([], { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const last = (p) => String(p || '').split('/').filter(Boolean).pop() || '/'

/** The portal's answer for this service's outside paths (a portal manager's view; others get none). */
function useReach() {
  const [got, setGot] = useState(null)
  const read = () => ask('/api/admin/reach').then((r) => setGot((r.services || []).find((s) => s.name === PORTAL_SERVICE.name) || { paths: [] }))
    .catch(() => setGot(false))
  useEffect(() => { if (isManager()) read() }, [])
  const put = (path, status) => ask('/api/admin/reach/paths', { method: 'POST', body: JSON.stringify({ service: PORTAL_SERVICE.name, path, status }) }).then(read)
  const drop = (path) => ask('/api/admin/reach/paths', { method: 'DELETE', body: JSON.stringify({ service: PORTAL_SERVICE.name, path }) }).then(read)
  return [got, put, drop]
}

/** The allowed folders (as set, which the portal approved) and the portal's own list for this service. */
function Access({ at, keep, again, say }) {
  const [root, setRoot] = useState('')
  const [reach, put, drop] = useReach()
  const saved = at.saved?.length ? at.saved : at.roots
  // The portal's word on each (reach_status, for everyone): approved | waiting | blocked | unreachable.
  const status = (p) => at.status?.[p] || (reach ? (reach.paths || []).find((x) => x.path === p)?.status : null)
  const run = (f) => f().catch((e) => say(e.message))
  return (
    <div className="rl-browse-access">
      <div className="rl-browse-h">{tr('rk_browse_roots')}</div>
      <p className="rl-msg">{tr('rk_browse_roots_say')}</p>
      {[...new Set([...saved, ...at.roots])].map((r) => {
        const ok = at.roots.includes(r), st = status(r)
        return (
          <div key={r} className={`rl-browse-root${ok ? '' : ' wait'}`}>
            <Icon name={ok ? 'check-circle' : 'warning-circle'} size={14} />
            <span className="rl-mono">{r}</span>
            <span className="rl-dim">{ok ? tr('rk_browse_ok') : st === 'blocked' ? tr('rk_browse_blocked') : st === 'unreachable' ? tr('rk_browse_unreachable') : st === 'outside' ? tr('rk_browse_shallow') : st === 'held' ? tr('rk_browse_held') : tr('rk_browse_wait')}</span>
            {reach && !ok && <button type="button" className="rl-btn" onClick={() => run(() => put(r, 'approved').then(() => keep({})))}>{tr('rk_browse_approve')}</button>}
            {st === 'held' && <button type="button" className="rl-btn" title={tr('rk_browse_again_hint')}
              onClick={() => run(() => again(r))}>{tr('rk_browse_again')}</button>}
            <button type="button" className="rl-btn" disabled={!saved.includes(r)} title={tr('rk_browse_root_drop')}
              onClick={() => run(() => keep({ roots: saved.filter((y) => y !== r) }))}>✕</button>
            {/* What a portal manager wrote, holding it: read before asking again. */}
            {(at.info?.[r]?.comments || []).map((c, i) => (
              <p key={i} className="rl-msg rl-browse-said">{tr('rk_browse_said')}: {c.text} <span className="rl-dim">— {c.by}{c.at ? `, ${new Date(c.at * 1000).toLocaleString()}` : ''}</span></p>
            ))}
          </div>
        )
      })}
      <div className="rl-browse-root">
        <input className="rl-in rl-mono" value={root} placeholder="/Volumes/data" onChange={(e) => setRoot(e.target.value)} />
        <button type="button" className="rl-btn" disabled={!root.trim()} onClick={() => run(() => keep({ roots: [...saved, root.trim()] }).then(() => setRoot('')))}>{tr('rk_browse_root_add')}</button>
      </div>
      {reach && (reach.paths || []).length > 0 && (<>
        <div className="rl-browse-h">{tr('rk_browse_portal')}</div>
        <p className="rl-msg">{tr('rk_browse_portal_say')}</p>
        {reach.paths.map((x) => (
          <div key={x.path} className={`rl-browse-root ${x.status}`}>
            <Icon name={x.status === 'approved' ? 'check-circle' : x.status === 'blocked' ? 'x' : 'warning-circle'} size={14} />
            <span className="rl-mono" title={x.why || ''}>{x.path}</span>
            <span className="rl-dim">{tr(`rk_browse_${x.status === 'approved' ? 'ok' : x.status === 'blocked' ? 'blocked' : 'wait'}`)}</span>
            {x.status !== 'approved' && <button type="button" className="rl-btn" onClick={() => run(() => put(x.path, 'approved').then(() => keep({})))}>{tr('rk_browse_approve')}</button>}
            {x.status !== 'blocked' && <button type="button" className="rl-btn" onClick={() => run(() => put(x.path, 'blocked').then(() => keep({})))}>{tr('rk_browse_block')}</button>}
            <button type="button" className="rl-btn" title={tr('rk_browse_portal_drop')} onClick={() => run(() => drop(x.path).then(() => keep({})))}>✕</button>
          </div>
        ))}
      </>)}
      {reach === false && isManager() && <p className="rl-msg">{tr('rk_browse_portal_none')}</p>}
    </div>
  )
}

export function RackBrowse({ etab, api }) {
  const req = requests.get(etab.who) || {}
  const want = req.want || 'dir'
  const [at, setAt] = useState(null)
  const [said, setSaid] = useState('')
  const [note, setNote] = useState('')        // a plain word (copied …), not a warning
  const [access, setAccess] = useState(false)
  // Nothing to look in yet (no allowed folder, or none approved): the panel to set them opens.
  const go = (path) => ask(`${API}?path=${encodeURIComponent(path || '')}`).then((r) => { setAt(r); setSaid(''); setNote(''); if (!r.path) setAccess(true) }).catch((e) => setSaid(e.message))
  const keep = (what) => ask(`${API}/places`, { method: 'PUT', body: JSON.stringify(what) }).then((r) => setAt((a) => ({ ...a, ...r })))
  useEffect(() => {
    // A browsing tab back from before a reload has lost who asked: nothing would take what is picked, so it goes.
    if (!requests.has(etab.who)) { api?.closeEdit?.(etab.id); return }
    go(req.start || '')
  }, [etab.who])   // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (path) => { req.onPick?.(path); requests.delete(etab.who); api?.closeEdit?.(etab.id) }
  const places = at?.places || []
  const saved = !!at && places.some((x) => x.path === at.path)
  const say = (m) => setSaid(m)

  return (
    <div className="rl-pdf rl-browse">
      <div className="rl-pdfbar">
        <div className="rl-pdfacts">
          <button type="button" className="rl-btn" disabled={!at?.up} title={tr('rk_browse_up')} onClick={() => go(at.up)}><Icon name="caret-up" size={14} /></button>
          <button type="button" className="rl-path rl-mono" title={tr('rk_copy_path')} onClick={() => at && copyText(at.path, setNote)}>{at?.path || '…'}</button>
        </div>
        {/* The pick first, where the eye starts; the tab's own tools at the right. */}
        <div className="rl-pdfacts">
          {want === 'dir' && req.onPick && <button type="button" className="rl-btn rl-go" disabled={!at} onClick={() => pick(at.path)}>{req.pickLabel || tr('rk_browse_pick_dir')}</button>}
          <button type="button" className="rl-btn" disabled={!at || saved} title={tr('rk_browse_place_add')}
            onClick={() => keep({ places: [...places, { path: at.path, label: last(at.path) }] }).catch((e) => say(e.message))}>
            <Icon name="star" size={14} weight={saved ? 'fill' : 'regular'} /></button>
          <span className="rl-sp" />
          <button type="button" className="rl-btn" onClick={() => go(at?.path)}>{tr('rk_reload')}</button>
          <button type="button" className={`rl-btn${access ? ' on' : ''}`} onClick={() => setAccess(!access)}><Icon name="key" size={14} /> {tr('rk_browse_roots')}</button>
        </div>
      </div>
      {said && <p className="rl-msg rl-bad">{said}</p>}
      {note && !said && <p className="rl-msg rl-browse-note">{note}</p>}
      {at && !at.path && <p className="rl-msg">{tr('rk_browse_none')}</p>}
      <div className="rl-browse-body">
        <nav className="rl-browse-side">
          <div className="rl-browse-h">{tr('rk_browse_marks')}</div>
          {(at?.roots || []).map((r) => (
            <button key={`r${r}`} type="button" className={`rl-browse-mark root${at?.path === r ? ' on' : ''}`} title={r} onClick={() => go(r)}><Icon name="home" size={14} /><span>{last(r)}</span></button>
          ))}
          {places.map((x) => (
            <div key={`p${x.path}`} className={`rl-browse-mark place${at?.path === x.path ? ' on' : ''}`}>
              <button type="button" title={x.path} onClick={() => go(x.path)}><Icon name="star" size={14} weight="fill" /><span>{x.label}</span></button>
              <button type="button" className="rl-browse-x" title={tr('rk_browse_place_drop')}
                onClick={() => keep({ places: places.filter((y) => y.path !== x.path) }).catch((e) => say(e.message))}><Icon name="x" size={11} /></button>
            </div>
          ))}
        </nav>
        {access && at ? <Access at={at} keep={(w) => keep(w).then(() => go(at.path))} again={(path) => ask(`${API}/again`, { method: 'POST', body: JSON.stringify({ path }) }).then(() => go(at.path))} say={say} /> : (
          <div className="rl-files">
            {at && !at.dirs.length && !at.files.length && <p className="rl-msg">{tr('rk_empty')}</p>}
            {at?.up && (
              <button type="button" className="rl-file rl-browse-dir" title={at.up} onClick={() => go(at.up)}>
                <span><Icon name="folder" size={15} /> ..</span><span className="rl-dim" /><span className="rl-dim" />
              </button>
            )}
            {at?.dirs.map((d) => (
              <button key={`d${d.name}`} type="button" className="rl-file rl-browse-dir" onClick={() => go(`${at.path}/${d.name}`)}>
                <span><Icon name="folder" size={15} /> {d.name}</span><span className="rl-dim" /><span className="rl-dim rl-mono">{day(d.mtime)}</span>
              </button>
            ))}
            {at?.files.map((f) => (
              <button key={`f${f.name}`} type="button" className={`rl-file rl-browse-f${want === 'file' && req.onPick ? '' : ' rl-browse-still'}`}
                onClick={() => (want === 'file' && req.onPick ? pick(`${at.path}/${f.name}`) : copyText(`${at.path}/${f.name}`, setNote))}>
                <span><Icon name="file" size={15} /> {f.name}</span><span className="rl-dim">{size(f.size)}</span><span className="rl-dim rl-mono">{day(f.mtime)}</span>
              </button>
            ))}
            {at?.more && <p className="rl-msg">{tr('rk_shows_2000')}</p>}
          </div>
        )}
      </div>
      {req.onPick && <p className="rl-msg rl-browse-foot">{want === 'file' ? tr('rk_browse_pick_file_say') : tr('rk_browse_pick_dir_say')}</p>}
    </div>
  )
}
