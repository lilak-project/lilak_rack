import '../strings.js'
import { useEffect, useRef, useState } from 'react'
import { load, save } from 'racklist'
import { press } from './press.js'
import { tr } from 'lilak-ui'

/** 도구함 — a note's tools, hanging off the side of ITS editor tab.
 *
 *  Not a pane and not a column. Both were tried:
 *
 *  - a column inside the pane cut the pane in half — the text squeezed, the
 *    tab strip hid tabs, and making room moved everything else on screen;
 *  - a pane of its own stood in the tab strip as though it were another
 *    record, and needed the editor's ctx carried across two panes.
 *
 *  So: a panel of its own, drawn OVER whatever is beside the editor. Nothing
 *  else is resized — it covers, it does not push. It belongs to this one
 *  editor, so moving to another tab takes it away with the editor, and that
 *  tab opens and shuts its own.
 *
 *  `position: fixed`, because the pane clips (`.rl-epane { overflow: hidden }`)
 *  and this hangs outside it. Top and bottom are the PANE's, so it stands
 *  exactly as tall as the tab it belongs to.
 *
 *  Where there is no room beside the pane — the tab is full width, or this
 *  note is a guest in another service's frame — it stands inside the pane's
 *  edge and the editor is pushed over by its width: covering the text is no
 *  use to anybody. Inside a frame it also ASKS the host for that much room
 *  (`frame-room`, racklist/frame.jsx); a host that answers draws the frame
 *  wider over its own list, and the push then costs the text nothing. A host
 *  that does not answer costs us nothing either.
 */
const WIDE = 'nt-toolbox-w'
const WIDTHS = [320, 620]

/** A toolbox: a box with a handle. Drawn, not an emoji — it sits in a bar with
 *  text and has to match its weight. */
const Box = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M6 3.5h4v2M2.5 5.5h11v7h-11zM2.5 8.5h11" fill="none"
      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

/** Wider / narrower: two walls and the arrows between them, pointing out when
 *  there is room to take and in when there is room to give. An arrow alone
 *  said "go there", which is not what this does. */
const Span = ({ out }) => (
  <svg viewBox="0 0 16 16" width="14" height="12" aria-hidden="true">
    <path d="M1.5 2.5v11M14.5 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.3" />
    {out ? (
      <path d="M4.5 8h-2.5M11.5 8h2.5M5.5 5.5 3 8l2.5 2.5M10.5 5.5 13 8l-2.5 2.5"
        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    ) : (
      <path d="M3.5 8h3M12.5 8h-3M5 5.5 7.5 8 5 10.5M11 5.5 8.5 8 11 10.5"
        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    )}
  </svg>
)

export default function Toolbox({ anchor, kit, at, onPick, onShut, onPush, ctx }) {
  const [spot, setSpot] = useState(null)
  // ONE width for the toolbox, whatever tool is open: a panel that resized
  // itself as you looked through its tabs was a panel that would not sit
  // still. The button in the bar is the only thing that changes it.
  const [wide, setWide] = useState(() => (Number(load(WIDE, WIDTHS[0])) === WIDTHS[1] ? WIDTHS[1] : WIDTHS[0]))
  useEffect(() => { save(WIDE, wide) }, [wide])
  const pushed = useRef(0)
  // Asking the host for room. Only from inside a frame, and only our origin.
  const beg = (px) => {
    if (window.parent === window) return
    try { window.parent.postMessage({ rack: 'frame-room', px }, window.location.origin) } catch { /* no host */ }
  }

  useEffect(() => {
    const place = () => {
      // The EDITOR's own box, top and bottom — not the pane's.
      //
      // The tab strip above it belongs to the app that owns the tabs, and
      // this note is shown two ways: in its own list (the strip is note's own
      // and could be drawn over) and inside another service's frame
      // (`?solo=`, where the strip is the host's, in another document, and
      // cannot be reached at all). Standing where the EDITOR stands is the
      // one answer that looks the same both times.
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const box = { top: r.top, height: r.height }
      let next
      if (window.innerWidth - r.right >= wide) next = { ...box, left: r.right }
      else if (r.left >= wide) next = { ...box, right: Math.max(0, window.innerWidth - r.left) }
      // No room either side (a full-width tab): stand inside its edge and let
      // the editor be pushed over.
      else next = { ...box, left: Math.max(0, r.right - wide), push: true }
      const want = next.push ? wide : 0
      if (want !== pushed.current) { pushed.current = want; onPush?.(want); beg(want) }
      setSpot(next)
    }
    place()
    const ro = new ResizeObserver(place)
    if (anchor.current) ro.observe(anchor.current)
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor, wide, onPush])

  // Shut, pushed or not, the editor gets its width back — and the host its room.
  useEffect(() => () => { if (pushed.current) { onPush?.(0); beg(0) } }, [onPush])

  if (!spot) return null
  const { push, ...style } = spot
  return (
    <div className="nt-toolbox" style={{ ...style, width: wide }}>
      {/* Its own title bar, as tall as the pane's tab strip beside it, so the
          two read as one row. What it is, and the two things it can do. */}
      <div className="nt-toolbox-bar">
        <Box />
        <span className="nt-toolbox-name">{tr("nt_box_title")}</span>
        <span className="rl-sp" />
        <button type="button" className="rl-btn nt-toolbox-btn nt-toolbox-span"
          title={tr(wide === WIDTHS[1] ? "nt_box_narrow" : "nt_box_wide")}
          {...press(() => setWide(wide === WIDTHS[1] ? WIDTHS[0] : WIDTHS[1]))}>
          <Span out={wide !== WIDTHS[1]} />
        </button>
        <button type="button" className="rl-btn nt-toolbox-btn" title={tr("nt_box_fold")}
          {...press(onShut)}>×</button>
      </div>
      <div className="rl-tabs nt-toolbox-tabs">
        {kit.map((t) => {
          const mark = t.badge?.(ctx)
          return (
            <span key={t.id} className={`rl-tab${at?.id === t.id ? ' on' : ''}`}>
              <button type="button" className="rl-tabname" {...press(() => onPick(t.id))}>
                {tr(t.label)}{mark ? <i className="nt-dot">{mark === 'dot' ? '●' : mark}</i> : null}
              </button>
            </span>
          )
        })}
      </div>
      <div className="nt-toolbox-body">{at ? <at.Body {...ctx} /> : null}</div>
    </div>
  )
}
