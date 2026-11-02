import './strings.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RackTabs } from './table.jsx'
import { load, save } from './portal.js'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * The editors beside the list: some docked LEFT of it, some RIGHT, or all of
 * them FULL — the list gives up its width and every tab shares one column.
 * With both sides in use the two columns take the whole width, the list hidden.
 *
 * A record you are fixing is not one of the lists, so it has its own tabs. The
 * side a tab is on is the tab's own business (`col`: 0 left, 1 right), so the
 * arrangement is one array and the columns are drawn from it; `full` is the
 * whole screen's.
 *
 * Give it a storage key and the arrangement outlives the page: a record you
 * were in the middle of is still open when you come back from another service
 * in the portal, which unmounts this one. Pass nothing and nothing is kept.
 *
 *   const panes = useEditorPanes(projectKey('rm', 'panes'))
 *   panes.open({ id, label, … })      // whatever the service's tab is
 *   panes.cols.map((c) => …)          // 0 (left of the list) and/or 1 (right);
 *                                     // FULL: the one column FULL, every tab in it
 */
export const LEFT = 0
export const RIGHT = 1
export const FULL = 'full'
const V = 2       // the stored shape: before it, col 0 was the first column right of the list

export function useEditorPanes(key) {
  const was = useMemo(() => {
    const w = (key ? load(key, null) : null) || {}
    // From before the sides: every tab was right of the list.
    return w.v === V ? w : { ...w, tabs: (w.tabs || []).map((t) => ({ ...t, col: RIGHT })),
      active: w.active ? { [RIGHT]: Object.values(w.active).filter(Boolean).at(-1) || null } : {}, col: RIGHT }
  }, [key])
  const [tabs, setTabs] = useState(was.tabs || [])   // [{ …service's own, col }]
  const [active, setActive] = useState(was.active || {})  // { col: id }, and { full: id }
  const [col, setCol] = useState(was.col ?? RIGHT)    // where a new record opens
  const [full, setFull] = useState(!!was.full)       // every tab in one column, the list gone
  const [hidden, setHidden] = useState(!!was.hidden)  // out of sight, still open
  useEffect(() => {
    if (key) save(key, { v: V, tabs, active, col, full, hidden })
  }, [key, tabs, active, col, full, hidden])

  const open = useCallback((t) => {
    setHidden(false)
    setTabs((ts) => {
      const had = ts.find((x) => x.id === t.id)
      const to = had ? had.col : col
      setActive((a) => ({ ...a, [to]: t.id, [FULL]: t.id }))
      return had ? ts : [...ts, { ...t, col: to }]
    })
  }, [col])

  const close = useCallback((id) => {
    setTabs((ts) => {
      const gone = ts.find((x) => x.id === id)
      const left = ts.filter((x) => x.id !== id)
      if (gone) {
        const mine = left.filter((x) => x.col === gone.col)
        setActive((a) => ({ ...a, [gone.col]: mine.length ? mine[mine.length - 1].id : null,
          [FULL]: a[FULL] === id ? (left.length ? left[left.length - 1].id : null) : a[FULL] }))
        if (!mine.length) setCol(left.length ? left[left.length - 1].col : RIGHT)
        if (!left.length) setFull(false)
      }
      return left
    })
  }, [])

  const closeAll = useCallback(() => { setTabs([]); setActive({}); setCol(RIGHT); setFull(false) }, [])

  // Closing by hand (×, close all, ⌘X): an open editor says first whether it
  // could save (`guard`). One that could not stays, and in sight, saying why.
  const guards = useRef({})
  const guard = useCallback((id, fn) => {
    if (fn) guards.current[id] = fn
    else delete guards.current[id]
  }, [])
  const leave = useCallback(async (id) => {
    if (!guards.current[id] || await guards.current[id]()) close(id)
    else setHidden(false)
  }, [close])
  const leaveAll = useCallback(async () => { for (const t of tabs) await leave(t.id) }, [tabs, leave])

  /** This record to a side of the list (LEFT, RIGHT) — out of FULL, if the
   *  screen was — or every record FULL. */
  const dock = useCallback((id, side) => {
    if (side === FULL) { setActive((a) => ({ ...a, [FULL]: id })); setFull(true); return }
    setFull(false)
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id)
      if (!t || t.col === side) return ts
      const left = ts.filter((x) => x.id !== id && x.col === t.col)
      setActive((a) => ({ ...a, [side]: id, [t.col]: left.length ? left[left.length - 1].id : null }))
      return ts.map((x) => (x.id === id ? { ...x, col: side } : x))
    })
    setActive((a) => ({ ...a, [side]: id }))
    setCol(side)
  }, [])

  /** Every record to one side, the one already showing there still showing. */
  const dockAll = useCallback((side) => {
    setFull(false)
    setTabs((ts) => ts.map((x) => ({ ...x, col: side })))
    setCol(side)
  }, [])

  /** A tab for something the service no longer has cannot be shown. */
  const keep = useCallback((alive) => setTabs((ts) => (ts.every(alive) ? ts : ts.filter(alive))), [])

  const cols = useMemo(() => (full && tabs.length ? [FULL]
    : [...new Set(tabs.map((t) => t.col))].sort((a, b) => a - b)), [tabs, full])
  const inCol = useCallback((c) => (c === FULL ? tabs : tabs.filter((t) => t.col === c)), [tabs])
  const current = useCallback((c) => {
    const mine = inCol(c)
    return mine.find((t) => t.id === active[c]) || mine[mine.length - 1] || null
  }, [inCol, active])

  return {
    tabs, cols, open, close, closeAll, guard, leave, leaveAll, dock, dockAll, keep, inCol, current, setCol,
    pick: (c, id) => setActive((a) => ({ ...a, [c]: id })),
    full, setFull, hidden, setHidden, count: tabs.length, showing: tabs.length > 0 && !hidden,
  }
}

/** The second press of a double-click belongs to the double. Left to itself it
 *  moves another tab, or, the first press having taken this column away, lands
 *  on whatever stands there now (a sort header). */
function swallowNextClick() {
  const eat = (e) => e.stopPropagation()
  window.addEventListener('click', eat, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', eat, true), 500)
}

/** The three places an editor can be: a frame with its left part, its whole,
 *  or its right part drawn in. */
const Where = ({ side }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    {side === LEFT && <rect x="1.5" y="2.5" width="5.5" height="11" fill="currentColor" />}
    {side === RIGHT && <rect x="9" y="2.5" width="5.5" height="11" fill="currentColor" />}
    {side === FULL && <rect x="3.5" y="4.5" width="9" height="7" fill="currentColor" />}
  </svg>
)

const Icon = ({ children }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">{children}</svg>
)

/** For the title bar, while any editor is open: put them all out of sight (the
 *  number on the eye is how many; they stay open, half-typed text and all, and
 *  opening a record brings them back), or close them all. */
export function RackPaneTools({ panes }) {
  return (
    <>
      <button type="button" className={`rl-bar-ic${panes.hidden ? ' on' : ''}`} aria-pressed={panes.hidden}
        title={panes.hidden ? tr("rk_show_editors", panes.count) : tr("rk_hide_editors")}
        onClick={() => panes.setHidden(!panes.hidden)}>
        <Icon>
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" />
          {panes.hidden && <path d="M3 13 13 3" />}
        </Icon>
        {panes.hidden && <span className="rl-bar-ic-n">{panes.count}</span>}
      </button>
      <button type="button" className="rl-bar-ic" title={tr("rk_close_editors_hint")} onClick={panes.leaveAll}>
        <Icon><path d="M4.5 1.5h10v10" /><rect x="1.5" y="4.5" width="10" height="10" rx="1" /><path d="m4.5 7.5 4 4m0-4-4 4" /></Icon>
      </button>
    </>
  )
}

/**
 * One editor column's strip: its tabs, and where the record shown is.
 *
 *   ◧  left of the list    ▣  every tab, the whole width    ◨  right of the list
 *
 * The one it is in is filled; pressing another moves it there (FULL takes
 * every tab; a side, pressed in FULL, takes this one there and the rest back
 * to theirs). Double-clicking a side takes every tab there; double-clicking the
 * tabs is FULL and back.
 *
 * The tabs keep to one row, the chosen one scrolled into it. More than fit: the
 * last button lays them all out, until it is pressed again or a press lands
 * anywhere else (in a framed record that reaches this page only as a blur).
 */
export function RackPaneStrip({ panes, col }) {
  const cur = panes.current(col)
  const at = panes.full ? FULL : cur?.col
  const tabs = panes.inCol(col)
  const box = useRef(null)
  const [all, setAll] = useState(false)
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = box.current?.querySelector('.rl-tabs')
    if (!el || all) return undefined
    const read = () => setOver(el.scrollWidth > el.clientWidth)
    read()
    const seen = new ResizeObserver(read)
    seen.observe(el)
    return () => seen.disconnect()
  }, [tabs.length, all])
  useEffect(() => {
    if (!all) box.current?.querySelector('.rl-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [cur?.id, all, panes.hidden])
  useEffect(() => {
    if (!all) return undefined
    const off = () => setAll(false)
    const press = (e) => { if (!box.current?.contains(e.target)) off() }
    document.addEventListener('mousedown', press, true)
    window.addEventListener('blur', off)
    return () => {
      document.removeEventListener('mousedown', press, true)
      window.removeEventListener('blur', off)
    }
  }, [all])
  return (
    <div className={`rl-strip${all ? ' rl-strip-all' : ''}`} ref={box}>
      <div className="rl-strip-tabs" onDoubleClick={() => panes.setFull(!panes.full)}
        title={tr("rk_dbl_full_width")}>
        <RackTabs tabs={tabs} active={cur?.id} opened
          onPick={(id) => panes.pick(col, id)} onClose={panes.leave} />
      </div>
      {cur && (
        <span className="rl-where">
          {[[LEFT, tr("rk_dock_left")], [FULL, tr("rk_full_width")], [RIGHT, tr("rk_dock_right")]].map(([side, title]) => (
            <button key={side} type="button" className={`rl-btn rl-pane-btn${at === side ? ' on' : ''}`} title={title}
              onClick={() => {
                if (side !== FULL) swallowNextClick()
                if (side === FULL && panes.full) panes.setFull(false)
                else panes.dock(cur.id, side)
              }}
              onDoubleClick={side === FULL ? undefined : () => panes.dockAll(side)}>
              <Where side={side} />
            </button>
          ))}
          <button type="button" className={`rl-btn rl-pane-btn${all ? ' on' : ''}`} disabled={!all && !over}
            aria-expanded={all} title={tr(all ? "rk_tabs_one_row" : "rk_tabs_all")} onClick={() => setAll((a) => !a)}>
            <Icon><rect x="1.5" y="2.5" width="6" height="4" /><rect x="8.5" y="2.5" width="6" height="4" /><rect x="1.5" y="9.5" width="6" height="4" /></Icon>
          </button>
        </span>
      )}
    </div>
  )
}

/** Where the panes stand around the list: the LEFT column before it, the RIGHT
 *  (or FULL) one after it. And where the resize handle goes: beside the list
 *  (one side), or between the two (both sides, the list hidden). None while the
 *  editors are not shown. */
export function paneLayout(panes, showList, showEdit = true) {
  const left = panes.cols.filter((c) => c === LEFT)
  const right = panes.cols.filter((c) => c !== LEFT)
  // Without the list, editors on both sides still share a border to drag: `mid`.
  const handle = !showEdit ? null : !showList ? (left.length && right.length ? 'mid' : null)
    : left.length ? 'left' : right.length ? 'right' : null
  return { left, right, handle }
}

/** The styles and handle for that layout: { left, list, right } styles and the
 *  handle to put { before, after } the list. */
export function paneStyles(lay, split) {
  if (lay.handle === 'left') return { left: split.leftStyle, list: split.rightStyle, before: split.handleProps }
  if (lay.handle === 'mid') return { left: split.leftStyle, right: split.rightStyle, before: split.handleProps }
  if (lay.handle === 'right') return { list: split.leftStyle, right: split.rightStyle, after: split.handleProps }
  return {}
}
