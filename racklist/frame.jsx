import { useEffect, useRef, useState } from 'react'

/**
 * A service's own page inside another service's pane.
 *
 * A guest inside a frame cannot draw outside it: note's toolbox has to stand
 * INSIDE the editor area and push the text over to make room. So a guest may
 * ASK for the room instead —
 *
 *     parent.postMessage({ rack: 'frame-room', px: 360 }, location.origin)
 *
 * — and the frame grows by that much to the right, drawn OVER whatever is
 * beside it (the list, the pane next door). Nothing else is resized, and the
 * frame is not reloaded: it is the same element, styled. `px: 0` gives the
 * room back.
 *
 * A host that does not answer costs the guest nothing — it goes on taking the
 * room out of its own width, which is what it does in here anyway.
 */
export function RackFrame({ src, label, hold }) {
  const box = useRef(null)
  const frame = useRef(null)
  const [room, setRoom] = useState(0)
  const [spot, setSpot] = useState(null)

  // Only this frame's own page may move this frame, and only from our origin.
  useEffect(() => {
    const heard = (e) => {
      if (e.origin !== window.location.origin) return
      if (!frame.current || e.source !== frame.current.contentWindow) return
      if (e.data?.rack !== 'frame-room') return
      const px = Number(e.data.px)
      if (Number.isFinite(px)) setRoom(Math.max(0, Math.min(900, Math.round(px))))
    }
    window.addEventListener('message', heard)
    return () => window.removeEventListener('message', heard)
  }, [])

  // Where it stands while it is standing out of line. Measured from the box it
  // left behind, so dragging the pane's border still moves it.
  useEffect(() => {
    if (!room) { setSpot(null); return undefined }
    const place = () => {
      const r = box.current?.getBoundingClientRect()
      if (r?.width) setSpot({ top: r.top, left: r.left, width: r.width + room, height: r.height })
    }
    place()
    const ro = new ResizeObserver(place)
    if (box.current) ro.observe(box.current)
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('resize', place) }
  }, [room])

  return (
    <div className="rl-frame-box" ref={box}>
      <iframe ref={(el) => { frame.current = el; if (hold) hold.current = el }}
        title={label} src={src} style={spot || undefined}
        className={`rl-frame${spot ? ' rl-frame-over' : ''}`} />
    </div>
  )
}
