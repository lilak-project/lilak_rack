import './strings.js'
import { useEffect } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * The title bar of a rack service, in the service's own colour (brandStyle on
 * the root): the service's menu — what the tab can do, under the service's
 * name — then the tabs, then ↻. One part, so every service has the same bar.
 *
 *   <RackBar menu={<RackMenu label="Notes" …/>} tabs={<RackTabs …/>} />
 *
 * ↻ and ⌘R / Ctrl+R reload this service only — inside the portal, the panel,
 * not the portal around it (after a sync, a new build). ⇧⌘R is left to the
 * browser: everything, the hard way.
 */
export function RackBar({ menu = null, tabs = null, children }) {
  useReloadKey()
  return (
    <header className="rl-bar">
      {menu}
      {tabs}
      {children}
      <span className="rl-sp" />
      <button type="button" className="rl-reload" title={tr("rk_reload_service")}
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
