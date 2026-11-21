/**
 * Service command mode — the user's note "명령모드". The portal turns it on and
 * off (`lilak:cmd {on}`: Esc once from the cover); while it is on, vi keys move
 * through the page instead of typing:
 *
 *   j / k (↓ ↑)   the highlighted row of the list in view      gg / G  first / last
 *   { / }          ten rows up / down                           Enter   open it
 *   h / l (← →)   the previous / next tab                      /       the search box
 *   m             the menu                                      1 2 3   sort by that column
 *   (n new, Space chat, Esc → the sidebar's mode are the portal's and useRackKeys')
 *
 * It works on the page as drawn (rows .rl-row.rl-hit, tabs .rl-tabname, column
 * heads .rl-sort) so every rack service gets it without wiring of its own.
 */
import { useEffect, useRef } from 'react'

const seen = (n) => !!n && n.offsetParent !== null
const listPane = () => [...document.querySelectorAll('.rl-pane:not(.rl-epane)')].find(seen) || document
const rows = () => [...listPane().querySelectorAll('.rl-tab-body .rl-row.rl-hit')].filter(seen)
const tabs = () => [...listPane().querySelectorAll('.rl-tabs .rl-tab')].filter(seen)

export function useCmdKeys({ findRef, onMenu } = {}) {
  const on = useRef(false)
  const at = useRef(-1)
  const g = useRef(0)
  const fns = useRef({})
  fns.current = { findRef, onMenu }
  useEffect(() => {
    const paint = () => {
      document.querySelectorAll('.rl-cmd-at').forEach((n) => n.classList.remove('rl-cmd-at'))
      const r = rows()
      if (!on.current || !r.length) return
      at.current = Math.max(0, Math.min(r.length - 1, at.current))
      r[at.current].classList.add('rl-cmd-at')
      r[at.current].scrollIntoView({ block: 'nearest' })
    }
    const msg = (e) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'lilak:cmd') return
      on.current = !!e.data.on
      if (on.current && at.current < 0) at.current = 0
      paint()
    }
    const key = (e) => {
      if (!on.current || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const k = e.key
      const take = () => { e.preventDefault(); e.stopPropagation() }
      const move = (i) => { take(); at.current = i; paint() }
      if (k === 'g') { take(); if (Date.now() - g.current < 600) { g.current = 0; move(0) } else g.current = Date.now(); return }
      g.current = 0
      if (k === 'j' || k === 'ArrowDown') return move(at.current + 1)
      if (k === 'k' || k === 'ArrowUp') return move(at.current - 1)
      if (k === 'G') return move(rows().length - 1)
      if (k === '}') return move(at.current + 10)
      if (k === '{') return move(at.current - 10)
      if (k === 'h' || k === 'l' || k === 'ArrowLeft' || k === 'ArrowRight') {
        const t = tabs()
        if (!t.length) return
        take()
        const i = t.findIndex((x) => x.classList.contains('on'))
        const next = t[Math.max(0, Math.min(t.length - 1, i + (k === 'h' || k === 'ArrowLeft' ? -1 : 1)))]
        next?.querySelector('.rl-tabname')?.click()
        at.current = 0
        setTimeout(paint, 0)
        return
      }
      if (k === 'Enter') {
        const r = rows()[at.current]
        if (!r) return
        take()
        // A row opens with the right button (a left click only picks it).
        r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }))
        return
      }
      if (k === '/') { take(); fns.current.findRef?.current?.focus(); fns.current.findRef?.current?.select?.(); return }
      if (k === 'm') { take(); fns.current.onMenu?.(); return }
      if (/^[1-9]$/.test(k)) {
        const s = [...listPane().querySelectorAll('.rl-head .rl-sort:not(.rl-facet)')].filter(seen)[Number(k) - 1]
        if (s) { take(); s.click(); setTimeout(paint, 0) }
      }
    }
    window.addEventListener('message', msg)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('message', msg); window.removeEventListener('keydown', key, true) }
  }, [])
}
