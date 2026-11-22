import { useEffect, useRef, useState } from 'react'
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * A photo field's two windows: the camera (a viewfinder in the page, so a
 * desktop's webcam works too, not only a phone's camera app) and the editor
 * (turn a quarter, drag a box and cut). Both give back a data URL and are drawn
 * over everything, like the photo at its own size.
 *
 * The camera needs a secure page (HTTPS or localhost) and, inside the portal,
 * a frame that allows it (`allow="camera"`); where it cannot start, `canCamera()`
 * is false and the field hands the phone its own camera app instead.
 */
export const canCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export function RackCamera({ onShot, onClose }) {
  const video = useRef(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stream = null
    let gone = false
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (gone) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) }
      })
      .catch((e) => setErr(tr("rk_cam_failed", e?.message || e)))
    return () => { gone = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [])
  function snap() {
    const v = video.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    onShot(c.toDataURL('image/jpeg', 0.9))
  }
  return (
    <div className="rl-over" onClick={onClose}>
      <div className="rl-over-box" onClick={(e) => e.stopPropagation()}>
        {err ? <p className="rl-hint">{err}</p> : <video ref={video} className="rl-over-view" playsInline muted />}
        <div className="rl-over-bar">
          {!err && <button type="button" className="rl-btn rl-go" onClick={snap}>{tr("rk_cam_snap")}</button>}
          <button type="button" className="rl-btn" onClick={onClose}>{tr("rk_close")}</button>
        </div>
      </div>
    </div>
  )
}

/** Turn and cut a picture. The work happens on a full-size canvas off screen;
 *  the one shown is that, scaled to fit, with the box drawn over it. */
export function RackPhotoEdit({ src, onSave, onClose }) {
  const work = useRef(null)
  const view = useRef(null)
  const drag = useRef(null)
  const [box, setBox] = useState(null)      // in work pixels
  const [ready, setReady] = useState(false)
  const [, redraw] = useState(0)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d').drawImage(img, 0, 0)
      work.current = c
      setReady(true)
    }
    img.src = src
  }, [src])

  useEffect(() => {
    const w = work.current
    const v = view.current
    if (!ready || !w || !v) return
    const s = Math.min((window.innerWidth * 0.86) / w.width, (window.innerHeight * 0.62) / w.height, 1)
    v.width = Math.max(1, Math.round(w.width * s))
    v.height = Math.max(1, Math.round(w.height * s))
    const g = v.getContext('2d')
    g.drawImage(w, 0, 0, v.width, v.height)
    if (box) {
      const [x, y, bw, bh] = [box.x * s, box.y * s, box.w * s, box.h * s]
      g.fillStyle = 'rgba(0,0,0,.45)'
      g.fillRect(0, 0, v.width, y)
      g.fillRect(0, y, x, bh)
      g.fillRect(x + bw, y, v.width - x - bw, bh)
      g.fillRect(0, y + bh, v.width, v.height - y - bh)
      g.strokeStyle = '#fff'
      g.lineWidth = 2
      g.strokeRect(x + 1, y + 1, bw - 2, bh - 2)
    }
  })

  const at = (e) => {
    const b = view.current.getBoundingClientRect()
    const s = work.current.width / b.width
    return { x: (e.clientX - b.left) * s, y: (e.clientY - b.top) * s }
  }
  function down(e) {
    if (!ready) return
    e.preventDefault()
    view.current.setPointerCapture?.(e.pointerId)
    drag.current = at(e)
    setBox(null)
  }
  function move(e) {
    const a = drag.current
    if (!a) return
    const p = at(e)
    const w = work.current
    const x = Math.max(0, Math.min(a.x, p.x))
    const y = Math.max(0, Math.min(a.y, p.y))
    const bw = Math.min(w.width, Math.max(a.x, p.x)) - x
    const bh = Math.min(w.height, Math.max(a.y, p.y)) - y
    if (bw > 4 && bh > 4) setBox({ x, y, w: bw, h: bh })
  }
  function turn() {
    const w = work.current
    const c = document.createElement('canvas')
    c.width = w.height
    c.height = w.width
    const g = c.getContext('2d')
    g.translate(c.width / 2, c.height / 2)
    g.rotate(Math.PI / 2)
    g.drawImage(w, -w.width / 2, -w.height / 2)
    work.current = c
    setBox(null)
    redraw((n) => n + 1)
  }
  function cut() {
    if (!box) return
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(box.w))
    c.height = Math.max(1, Math.round(box.h))
    c.getContext('2d').drawImage(work.current, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height)
    work.current = c
    setBox(null)
  }
  return (
    <div className="rl-over" onClick={onClose}>
      <div className="rl-over-box" onClick={(e) => e.stopPropagation()}>
        <canvas ref={view} className="rl-over-view rl-over-cut"
          onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null }}
          onPointerCancel={() => { drag.current = null }} />
        <span className="rl-hint">{tr(box ? "rk_edit_cut_hint" : "rk_edit_drag_hint")}</span>
        <div className="rl-over-bar">
          <button type="button" className="rl-btn" disabled={!ready} onClick={turn}>{tr("rk_edit_turn")}</button>
          <button type="button" className="rl-btn" disabled={!box} onClick={cut}>{tr("rk_edit_cut")}</button>
          <button type="button" className="rl-btn rl-go" disabled={!ready}
            onClick={() => onSave(work.current.toDataURL('image/jpeg', 0.85))}>{tr("rk_photo_apply")}</button>
          <button type="button" className="rl-btn" onClick={onClose}>{tr("rk_close")}</button>
        </div>
      </div>
    </div>
  )
}
