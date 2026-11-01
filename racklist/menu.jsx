import './strings.js'
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * The service's menu at the left of the title bar — its name, ▾ — and what
 * pops out of it: what the tab can do, OVER the list, one line per kind of
 * thing (<MenuRow>). It has no line of its own, so however many buttons there
 * are, nothing moves.
 *
 *   const m = useRackMenu()
 *   <RackBar menu={<RackMenu m={m} label="Notes" count={picked}>
 *     <MenuRow>…make…</MenuRow><MenuRow>…the selection…</MenuRow>
 *   </RackMenu>} tabs={<RackTabs …/>} />
 *
 * It closes on Esc, on a press outside it, and on a button pressed inside it —
 * but not one marked `data-keep` (a toggle you may want to press twice).
 */
export function useRackMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', off)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', off) }
  }, [open])
  return { open, setOpen, ref }
}

/** One line of the menu — one kind of thing — or nothing when it has none. */
export function MenuRow({ children }) {
  const any = [children].flat(Infinity).some((c) => c !== false && c != null && c !== '')
  return any ? <div className="rl-menu-row">{children}</div> : null
}

/** `label`: the service's name, on a button as wide in every service.
 *  `count`: a number on it (what is picked). `lit`: something tucked in it
 *  is on (a filter). `onToggle` stands in for the button's own (another page's
 *  menu opened from here). `bare`: no button — the menu hangs from the page's top-left,
 *  opened from the page around it. */
export function RackMenu({ m, label = '⋯', count = 0, lit = false, bare = false, onToggle, children }) {
  const box = m.open && (
    <div className="rl-menu" onClick={(e) => { if (e.target.closest('button') && !e.target.closest('[data-keep]')) m.setOpen(false) }}>
      {children}
    </div>
  )
  if (bare) return <div className="rl-menuwrap rl-bare" ref={m.ref}>{box}</div>
  return (
    <span className="rl-menuwrap" ref={m.ref}>
      <button type="button" className={`rl-btn rl-more${m.open ? ' on' : ''}${lit ? ' rl-lit' : ''}`}
        title={tr("rk_more_hint")} aria-expanded={m.open} onClick={onToggle || (() => m.setOpen((o) => !o))}>
        <span className="rl-more-l">{label}</span>
        {count > 0 && <span className="rl-more-n">{count}</span>}
        <span className="rl-more-c">▾</span></button>
      {box}
    </span>
  )
}
