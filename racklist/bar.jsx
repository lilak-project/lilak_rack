import './strings.js'
import { useEffect, useRef } from 'react'
import { AllTabsIcon, CloseAllIcon, useTabSpread } from './panes.jsx'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * The title bar of a rack service, in the service's own colour (brandStyle on
 * the root): the menu — what the tab can do — then the tabs, then `tools`
 * (the editors' buttons), show all the tabs, close them, ↻ and `last` (⚙). One
 * part, so every service has the same bar.
 *
 *   <RackBar menu={<RackMenu label="메뉴" …/>} tabs={<RackTabs …/>} tools={<RackPaneTools …/>}
 *     tabCount={n} activeTab={id} onCloseTabs={close} canCloseTabs={opened > 0} />
 *
 * The tabs keep to one row and scroll; shown all, they take the whole width from
 * the second row on, as an editor column's do.
 *
 * ↻ and ⌘R / Ctrl+R reload this service only — inside the portal, the panel,
 * not the portal around it (after a sync, a new build). ⇧⌘R is left to the
 * browser: everything, the hard way.
 */
export function RackBar({ menu = null, tabs = null, tools = null, tabCount = 0, activeTab, onCloseTabs, canCloseTabs, beforeReload = null, last = null, children }) {
  useReloadKey()
  const box = useRef(null)
  const { all, setAll, over } = useTabSpread(box, tabCount, activeTab, !!tabs)
  return (
    <header className={`rl-bar${all && tabs ? ' rl-bar-all' : ''}`} ref={box}>
      {menu}
      {/* Before the tabs, so they can flow round it; `order` puts it at the right. */}
      <span className="rl-bar-end">
        {tools}
        {tabs && tabCount > 0 && (
          <button type="button" className={`rl-bar-ic rl-bar-count${all ? ' on' : ''}`} disabled={!all && !over}
            aria-expanded={all} title={tr(all ? "rk_tabs_one_row" : "rk_tabs_all")} onClick={() => setAll((a) => !a)}>
            <AllTabsIcon />
            <span className="rl-bar-ic-n">{tabCount}</span>
          </button>
        )}
        {tabs && onCloseTabs && (
          <button type="button" className="rl-bar-ic" disabled={!canCloseTabs} title={tr("rk_close_tabs_hint")} onClick={onCloseTabs}>
            <CloseAllIcon />
          </button>
        )}
        {beforeReload}
        <button type="button" className="rl-reload" title={tr("rk_reload_service")}
          onClick={() => window.location.reload()}>↻</button>
        {last}
      </span>
      {tabs}
      {children}
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
