import './strings.js'
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { load, save } from './portal.js'

/**
 * The menu at the left of the title bar — 메뉴 ▸. Pressed, a column slides in
 * at the left of the page and pushes everything but the bar over; the button
 * stays where it was, and pressed again the column goes. What the tab can do
 * stands in it, one section per kind of thing (<MenuRow title>).
 *
 *   const m = useRackMenu(projectKey(def.key, 'menu'))
 *   <RackBar open={m.open} menu={<RackMenu m={m} label="메뉴" count={picked} />} … />
 *   <RackRail open={m.open}><MenuRow title="만들기">…</MenuRow></RackRail>
 *
 * It stays open, through a press in it and a change of tab, and is remembered
 * under `key`: the page moves when it opens, so it must not do so every press.
 *
 * A bare page has no bar: the menu is a strip at its top, opened from the page
 * around it. That one has no `key`: Esc shuts it, and so does a button pressed
 * in it, except one marked `data-keep`.
 */
export function useRackMenu(key) {
  const [open, setOpen] = useState(() => !!key && load(key, false))
  const ref = useRef(null)
  useEffect(() => { if (key) save(key, open) }, [key, open])
  useEffect(() => {
    if (!open || key) return undefined
    const off = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', off)
    return () => document.removeEventListener('keydown', off)
  }, [open, key])
  return { open, setOpen, ref }
}

/** One section of the menu — one kind of thing — or nothing when it has none. */
export function MenuRow({ title, children }) {
  const any = [children].flat(Infinity).some((c) => c !== false && c != null && c !== '')
  return any ? (
    <div className="rl-menu-row">
      {title && <b className="rl-menu-t">{title}</b>}
      <div className="rl-menu-btns">{children}</div>
    </div>
  ) : null
}

/** The column. Always there and only as wide as it is open, so it can slide. */
export function RackRail({ open, children }) {
  return (
    <aside className={`rl-rail${open ? ' on' : ''}`}>
      <div className="rl-rail-in rl-menu">{children}</div>
    </aside>
  )
}

/** `label`: what the button says ("메뉴"), on a button as wide in every service.
 *  `count`: a number on it (what is picked). `lit`: something tucked in it
 *  is on (a filter). `onToggle` stands in for the button's own (another page's
 *  menu opened from here). `bare`: no button, only the strip with `children`.
 *  `beside`: what stands right of the button. */
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
        <span className="rl-more-c">{m.open ? '◂' : '▸'}</span></button>
      {beside}
    </>
  )
}
