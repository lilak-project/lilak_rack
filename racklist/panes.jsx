import './strings.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RackTabs } from './table.jsx'
import { load, save } from './portal.js'
import { tr } from '../i18n.jsx'

/**
 * The editors beside the list: some docked LEFT of it, some RIGHT, or all of
 * them FULL — the list gives up its width and every tab shares one column.
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
  useEffect(() => {
    if (key) save(key, { v: V, tabs, active, col, full })
  }, [key, tabs, active, col, full])

  const open = useCallback((t) => {
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
    tabs, cols, open, close, closeAll, dock, keep, inCol, current, setCol,
    pick: (c, id) => setActive((a) => ({ ...a, [c]: id })),
    full, setFull, count: tabs.length, showing: tabs.length > 0,
  }
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

/**
 * One editor column's strip: its tabs, and where the record shown is.
 *
 *   ◧  left of the list    ▣  every tab, the whole width    ◨  right of the list
 *
 * The one it is in is filled; pressing another moves it there (FULL takes
 * every tab; a side, pressed in FULL, takes this one there and the rest back
 * to theirs). Double-clicking the tabs is FULL and back.
 */
export function RackPaneStrip({ panes, col }) {
  const cur = panes.current(col)
  const at = panes.full ? FULL : cur?.col
  return (
    <div className="rl-strip">
      <div className="rl-strip-tabs" onDoubleClick={() => panes.setFull(!panes.full)}
        title={tr("rk_dbl_full_width")}>
        <RackTabs tabs={panes.inCol(col)} active={cur?.id} opened
          onPick={(id) => panes.pick(col, id)} onClose={panes.close} />
      </div>
      {cur && (
        <span className="rl-where">
          {[[LEFT, tr("rk_dock_left")], [FULL, tr("rk_full_width")], [RIGHT, tr("rk_dock_right")]].map(([side, title]) => (
            <button key={side} type="button" className={`rl-btn rl-pane-btn${at === side ? ' on' : ''}`} title={title}
              onClick={() => (side === FULL && panes.full ? panes.setFull(false) : panes.dock(cur.id, side))}>
              <Where side={side} />
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

/** Where the panes stand around the list: the LEFT column before it, the RIGHT
 *  (or FULL) one after it, and which side the list's resize handle is on —
 *  only with editors on one side of a list that is showing. */
export function paneLayout(panes, showList) {
  const left = panes.cols.filter((c) => c === LEFT)
  const right = panes.cols.filter((c) => c !== LEFT)
  const handle = !showList ? null : left.length && right.length ? 'both' : left.length ? 'left' : right.length ? 'right' : null
  return { left, right, handle }
}

/** The styles and handles for that layout: `split` (one side) and `sides`
 *  (both — useRackList's): { left, list, right } styles and the handles to put
 *  { before, after } the list. */
export function paneStyles(lay, split, sides) {
  if (lay.handle === 'both') {
    return { left: sides.left.leftStyle, list: { flex: '1 1 auto', minWidth: 0 }, right: sides.right.edgeStyle,
      before: sides.left.handleProps, after: sides.right.handleProps }
  }
  if (lay.handle === 'left') return { left: split.leftStyle, list: split.rightStyle, before: split.handleProps }
  if (lay.handle === 'right') return { list: split.leftStyle, right: split.rightStyle, after: split.handleProps }
  return {}
}
