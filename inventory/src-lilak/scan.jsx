import './strings.js'
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { RackActions, RackField, isManager, load, newId, portalUser, save } from 'racklist'
import { canAdd } from './settings.jsx'

/**
 * What a sticker's QR (or barcode) says → its 자산번호. A code may hold the
 * number alone, a URL with it (?assetId=… or …/202500051), or words around it;
 * a run of digits that IS an asset wins over the first one.
 */
export function assetNumber(text, have = new Set()) {
  const v = String(text || '').trim()
  if (!v) return ''
  if (have.has(v)) return v
  const q = v.match(/[?&](?:assetId|asset|id|no|number)=([A-Za-z0-9_-]+)/i)
  if (q) return q[1]
  const runs = v.match(/[0-9]{2,}/g) || []
  return runs.find((r) => have.has(r)) || runs[0] || v
}

const KEPT = 'am2.scan'     // what was scanned stays through a reload

/** The scan tab: the camera reads one sticker after another into a list here,
 *  and the list is ticked or saved as a list. Photos and typed numbers (or a
 *  barcode gun, which types) go into the same list. */
export function ScanPane({ api, etab }) {
  const { doc } = api
  const assets = doc?.assets || []
  const mgr = isManager()
  const byId = new Map(assets.filter((a) => mgr || !a.hidden).map((a) => [a.assetId, a]))
  const have = new Set(byId.keys())
  const haveRef = useRef(have)
  haveRef.current = have

  const [got, setGot] = useState(() => load(KEPT, []))
  const keep = (next) => { setGot(next); save(KEPT, next) }
  const gotRef = useRef(got)
  gotRef.current = got
  const add = (texts) => {
    const fresh = []
    for (const t of texts) {
      const n = assetNumber(t, haveRef.current)
      if (n && !gotRef.current.includes(n) && !fresh.includes(n)) fresh.push(n)
    }
    if (!fresh.length) { api.setNote(tr("as_scan_again")); return }
    keep([...fresh, ...gotRef.current])
    api.setNote(fresh.length === 1 ? tr("as_scan_got", fresh[0]) : tr("as_scan_got_n", fresh.length))
  }
  const addRef = useRef(add)
  addRef.current = add

  // The live camera. One code is read again and again while it is in view, so a
  // number already in the list is passed over quietly.
  const [on, setOn] = useState(true)
  const [err, setErr] = useState('')
  const view = `am2-scan-${etab.id.replace(/\W/g, '')}`
  useEffect(() => {
    if (!on) return undefined
    if (!window.isSecureContext) { setErr(tr("as_scan_https")); return undefined }
    let cam = null
    let gone = false
    let last = ''
    setErr('')
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (gone) return
      cam = new Html5Qrcode(view, { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } })
      return cam.start({ facingMode: 'environment' }, {
        fps: 10,
        qrbox: (w, h) => { const s = Math.round(Math.min(w, h) * 0.7); return { width: s, height: s } },
        videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 },
          advanced: [{ focusMode: 'continuous' }] },
      }, (text) => {
        if (text === last) return
        last = text
        const n = assetNumber(text, haveRef.current)
        if (!gotRef.current.includes(n)) addRef.current([text])
      }).then(() => { if (gone) cam.stop().catch(() => {}) })
    }).catch((e) => { if (!gone) setErr(tr("as_scan_cam_failed", e?.message || e)) })
    return () => {
      gone = true
      // stop() throws while the camera is still starting; it is stopped once started (above).
      try { cam?.stop().catch(() => {}) } catch { /* not running yet */ }
    }
  }, [on, view])

  const [busy, setBusy] = useState(false)
  async function fromPhotos(files) {
    if (!files.length) return
    setBusy(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const reader = new Html5Qrcode(`${view}-file`, { verbose: false })
      const texts = []
      for (const f of files) {
        try { texts.push(await reader.scanFile(f, false)) } catch { /* no code in this one */ }
      }
      if (texts.length) add(texts); else api.setNote(tr("as_scan_none"))
    } finally { setBusy(false) }
  }

  const [typed, setTyped] = useState('')
  const found = got.filter((n) => have.has(n))
  const mayAdd = canAdd(doc)
  async function makeList() {
    if (!found.length || busy) return
    setBusy(true)
    const d = new Date()
    const name = tr("as_scan_list_name", d.toLocaleString('sv').slice(0, 16))   // local 'YYYY-MM-DD HH:MM'
    try {
      const rec = { id: newId(), name, type: 'save', location: '', assetIds: found,
        user: portalUser()?.email || '', createdAt: d.toISOString() }
      if (await api.commit({ records: [rec, ...(doc.records || [])] }, tr("as_list_made", name, found.length))) keep([])
    } finally { setBusy(false) }
  }

  return (
    <div className="rl-edit">
      <RackActions onClose={() => api.closeEdit(etab.id)}
        extra={<>
          <button type="button" className="rl-btn rl-go" disabled={busy || !found.length} onClick={makeList}>{tr("as_make_list_n", found.length)}</button>
          <button type="button" className="rl-btn" disabled={!found.length}
            onClick={() => { api.setPicked(new Set(found)); api.setNote(tr("as_ticked_n", found.length)) }}>{tr("as_tick_n", found.length)}</button>
          <button type="button" className="rl-btn" disabled={!got.length} onClick={() => keep([])}>{tr("as_scan_clear")}</button>
        </>} />
      <div className="rl-rec">
        <RackField label={tr("as_scan_camera")}>
          <div className="rl-rows">
            {on && !err && <div id={view} style={{ width: 'min(100%, 420px)' }} />}
            {err && <span className="rl-hint">{err}</span>}
            <span className="rl-shot-line">
              <button type="button" className={`rl-btn${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setOn(!on)}>{tr(on ? "as_scan_cam_off" : "as_scan_cam_on")}</button>
              <label className="rl-btn">
                {busy ? tr("as_scan_reading") : tr("as_scan_photos")}
                <input type="file" accept="image/*" multiple hidden disabled={busy}
                  onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; fromPhotos(f) }} />
              </label>
            </span>
            <div id={`${view}-file`} hidden />
          </div>
        </RackField>
        <RackField label={tr("as_scan_type")}>
          <form className="rl-shot-line" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { add([typed]); setTyped('') } }}>
            <input className="rl-in" value={typed} inputMode="numeric" placeholder={tr("as_scan_type_hint")}
              onChange={(e) => setTyped(e.target.value)} />
            <button type="submit" className="rl-btn" disabled={!typed.trim()}>{tr("as_scan_put")}</button>
          </form>
        </RackField>
        <RackField label={tr("as_scan_got_label", got.length)}>
          <div className="rl-rows">
            {!got.length && <span className="rl-hint">{tr("as_scan_empty")}</span>}
            {got.map((n) => {
              const a = byId.get(n)
              return (
                <div key={n} className="rl-rrow">
                  {a ? <button type="button" className="rl-btn" onClick={() => api.openItem(n)}>{n}</button> : <span className="rl-hint">{n}</span>}
                  <span>{a ? [a.name, a.location].filter(Boolean).join(' · ') : tr("as_scan_unknown")}</span>
                  {!a && mayAdd && !assets.some((x) => x.assetId === n) && (
                    <button type="button" className="rl-btn" onClick={() => api.openItem(null, null, { assetId: n })}>{tr("as_scan_register")}</button>
                  )}
                  <button type="button" className="rl-x" title={tr("as_scan_drop")} onClick={() => keep(got.filter((x) => x !== n))}>×</button>
                </div>
              )
            })}
          </div>
        </RackField>
      </div>
    </div>
  )
}
