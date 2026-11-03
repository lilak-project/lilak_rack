import './strings.js'
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * The menu at the left of the title bar — 메뉴 ▾. Pressed, what the tab can do
 * takes the TABS' place in the bar, one group per kind of thing (<MenuRow>),
 * the groups set apart; pressed again (or Esc), the tabs come back. It covers
 * nothing, so a filter can be chosen in the table while its buttons stay up.
 *
 *   const m = useRackMenu()
 *   <RackBar menu={<RackMenu m={m} label="메뉴" count={picked}>
 *     <MenuRow>…make…</MenuRow><MenuRow>…the selection…</MenuRow>
 *   </RackMenu>} tabs={m.open ? null : <RackTabs …/>} />
 *
 * A button pressed in it closes it — but not one marked `data-keep` (a toggle
 * you may want to press twice, the filter's own).
 */
export function useRackMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', off)
    return () => document.removeEventListener('keydown', off)
  }, [open])
  return { open, setOpen, ref }
}

/** One group of the menu — one kind of thing — or nothing when it has none. */
export function MenuRow({ children }) {
  const any = [children].flat(Infinity).some((c) => c !== false && c != null && c !== '')
  return any ? <div className="rl-menu-row">{children}</div> : null
}

/** `label`: what the button says ("메뉴"), on a button as wide in every service.
 *  `count`: a number on it (what is picked). `lit`: something tucked in it
 *  is on (a filter). `onToggle` stands in for the button's own (another page's
 *  menu opened from here). `bare`: no button — the menu is a strip at the top
 *  of the page, opened from the page around it. `beside`: what stands right of
 *  the button, open or shut. */
export function RackMenu({ m, label = '⋯', count = 0, lit = false, bare = false, onToggle, beside = null, children }) {
  const box = m.open && (
    <div className="rl-menu" onClick={(e) => { if (e.target.closest('button') && !e.target.closest('[data-keep]')) m.setOpen(false) }}>
      {children}
    </div>
  )
  if (bare) return box || null
  return (
    <>
      <button type="button" className={`rl-btn rl-more${m.open ? ' on' : ''}${lit ? ' rl-lit' : ''}`}
        title={tr("rk_more_hint")} aria-expanded={m.open} onClick={onToggle || (() => m.setOpen((o) => !o))}>
        <span className="rl-more-l">{label}</span>
        {count > 0 && <span className="rl-more-n">{count}</span>}
        <span className="rl-more-c">{m.open ? '▸' : '▾'}</span></button>
      {beside}
      {box}
    </>
  )
}
