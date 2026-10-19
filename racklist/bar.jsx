import { useEffect } from 'react'
import { PORTAL_PROJECT } from './portal.js'

/**
 * The title bar of a rack service — its name and how many, the project, and ↻.
 * In the service's own colour (brandStyle on the root). One part, so every
 * service has the same bar and the same way to reload itself.
 *
 *   <RackBar title="노트" count="12개" />
 *
 * ↻ and ⌘R / Ctrl+R reload this service only — inside the portal, the panel,
 * not the portal around it (after a sync, a new build). ⇧⌘R is left to the
 * browser: everything, the hard way.
 */
export function RackBar({ title, count, project = PORTAL_PROJECT, children }) {
  useReloadKey()
  return (
    <header className="rl-bar">
      <b>{title}</b>
      {count ? <span className="rl-n">{count}</span> : null}
      {children}
      <span className="rl-sp" />
      <span className="rl-n">{project}</span>
      <button type="button" className="rl-reload" title="이 서비스만 새로고침 (⌘R)"
        onClick={() => window.location.reload()}>↻</button>
    </header>
  )
}

/** ⌘R / Ctrl+R reloads this page only (⇧ left to the browser). */
export function useReloadKey() {
  useEffect(() => {
    const on = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        window.location.reload()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}
