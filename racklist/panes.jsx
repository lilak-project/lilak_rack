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

/** Which tab a column shows once `id` leaves it: what it was showing, or if that
 *  is the one leaving, the nearest to its left, or else to its right. */
export function shownAfter(list, was, id) {
  const shown = list.find((x) => x.id === was) || list[list.length - 1]
  if (shown?.id !== id) return shown?.id ?? null
  const i = list.indexOf(shown)
  return (list[i - 1] || list[i + 1])?.id ?? null
}

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
        setActive((a) => ({ ...a, [gone.col]: shownAfter(ts.filter((x) => x.col === gone.col), a[gone.col], id),
          [FULL]: shownAfter(ts, a[FULL], id) }))
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
  /** A step along a flow: `t` takes tab `id`'s place (or, open already, is
   *  shown and `id` goes) — once `id` has saved what it had. */
  const step = useCallback(async (id, t) => {
    if (id !== t.id && guards.current[id] && !await guards.current[id]()) return
    setTabs((ts) => {
      const old = ts.find((x) => x.id === id)
      if (!old) return ts
      const had = ts.find((x) => x.id === t.id)
      const to = had ? had.col : old.col
      setActive((a) => ({ ...a, [to]: t.id, [FULL]: t.id }))
      if (had && had !== old) return ts.filter((x) => x !== old).map((x) => (x === had ? { ...x, ...t, col: x.col } : x))
      return ts.map((x) => (x === old ? { ...t, col: old.col } : x))
    })
  }, [])
  /** Every editor, or one column's. */
  const leaveAll = useCallback(async (c) => {
    for (const t of tabs.filter((x) => !c || full || x.col === c)) await leave(t.id)
  }, [tabs, leave, full])

  /** This record to a side of the list (LEFT, RIGHT) — out of FULL, if the
   *  screen was — or every record FULL. */
  const dock = useCallback((id, side) => {
    if (side === FULL) { setActive((a) => ({ ...a, [FULL]: id })); setFull(true); return }
    setFull(false)
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id)
      if (!t || t.col === side) return ts
      setActive((a) => ({ ...a, [side]: id, [t.col]: shownAfter(ts.filter((x) => x.col === t.col), a[t.col], id) }))
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
    tabs, cols, open, close, closeAll, guard, leave, leaveAll, step, dock, dockAll, keep, inCol, current, setCol,
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

export const Icon = ({ children }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">{children}</svg>
)

/** The eye; struck through while the editors are out of sight. */
const EyeIcon = ({ shut }) => (
  <Icon>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" />
    {shut && <path d="M3 13 13 3" />}
  </Icon>
)

/** For the title bar while the editors are out of sight: their strips went with
 *  them, so this is the way back. The number is how many; they stay open,
 *  half-typed text and all, and opening a record brings them back too. Shown,
 *  the eye is on each strip (RackPaneStrip). */
export function RackPaneTools({ panes }) {
  return (
    <button type="button" className="rl-bar-ic on" aria-pressed
      title={tr("rk_show_editors", panes.count)} onClick={() => panes.setHidden(false)}>
      <EyeIcon shut />
      <span className="rl-bar-ic-n">{panes.count}</span>
    </button>
  )
}

/** Close them all: a sheet with an ×, a sheet behind it. */
export const CloseAllIcon = () => (
  <Icon><path d="M4.5 1.5h10v10" /><rect x="1.5" y="4.5" width="10" height="10" rx="1" /><path d="m4.5 7.5 4 4m0-4-4 4" /></Icon>
)
/** Show every tab: some sheets laid out in rows. */
export const AllTabsIcon = () => (
  <Icon><rect x="1.5" y="2.5" width="6" height="4" /><rect x="8.5" y="2.5" width="6" height="4" /><rect x="1.5" y="9.5" width="6" height="4" /></Icon>
)

/** A row of tabs that stays one row and scrolls, until it is asked to show them
 *  all; any press outside `box` folds it again, but for the button that asks
 *  from elsewhere (`data-spread`). `over`: there are more than fit.
 *  `active` is scrolled into view; `again` is anything else that redraws them. */
export function useTabSpread(box, count, active, again) {
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
  }, [box, count, all, again])
  useEffect(() => {
    if (!all) box.current?.querySelector('.rl-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [box, active, all, again])
  useEffect(() => {
    if (!all) return undefined
    const off = () => setAll(false)
    const press = (e) => { if (!box.current?.contains(e.target) && !e.target.closest?.('[data-spread]')) off() }
    document.addEventListener('mousedown', press, true)
    window.addEventListener('blur', off)
    return () => {
      document.removeEventListener('mousedown', press, true)
      window.removeEventListener('blur', off)
    }
  }, [box, all])
  return { all, setAll, over }
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
export function RackPaneStrip({ panes, col, name }) {
  const cur = panes.current(col)
  const at = panes.full ? FULL : cur?.col
  // A tab's name is a READING of the record, not a copy taken when it opened:
  // a record renamed while it is open — a note whose title is typed after the
  // file was made — said `Untitled` on its tab until it was closed and opened
  // again. `name` answers for the ones it knows; the rest keep what they have.
  const tabs = panes.inCol(col).map((t) => {
    const now = name?.(t)
    return now && now !== t.label ? { ...t, label: now } : t
  })
  const box = useRef(null)
  // Which tab was showing when a press began (for the double-click below).
  const was = useRef(null)
  const { all, setAll, over } = useTabSpread(box, tabs.length, cur?.id, panes.hidden)
  return (
    <div className={`rl-strip${all ? ' rl-strip-all' : ''}`} ref={box}>
      {/* The buttons come before the tabs: spread out, the tabs flow round them
          and take the whole width from the second row on (rack.css). Side by
          side, `order` puts them back at the right. */}
      {cur && (
        <span className="rl-where">
          <button type="button" className={`rl-btn rl-pane-btn rl-pane-all${all ? ' on' : ''}`} disabled={!all && !over}
            aria-expanded={all} title={tr(all ? "rk_tabs_one_row" : "rk_tabs_all")} onClick={() => setAll((a) => !a)}>
            <AllTabsIcon />
            <span className="rl-bar-ic-n">{tabs.length}</span>
          </button>
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
          <button type="button" className="rl-btn rl-pane-btn" title={tr("rk_hide_editors")} onClick={() => panes.setHidden(true)}>
            <EyeIcon />
          </button>
          <button type="button" className="rl-btn rl-pane-btn" title={tr("rk_close_col_hint")} onClick={() => panes.leaveAll(col)}>
            <CloseAllIcon />
          </button>
        </span>
      )}
      {/* Two presses anywhere on the strip go full width and back — on a tab
          too, where the first of the two has already moved to that tab. That
          move is undone rather than forbidden: a double-click asked about the
          WIDTH, and it should not cost you the record you were reading. */}
      <div className="rl-strip-tabs" title={tr("rk_dbl_full_width")}
        onPointerDown={(e) => { if (e.detail <= 1) was.current = cur?.id }}
        onDoubleClick={() => {
          if (was.current && was.current !== panes.current(col)?.id) panes.pick(col, was.current)
          panes.setFull(!panes.full)
        }}>
        <RackTabs tabs={tabs} active={cur?.id} opened
          onPick={(id) => panes.pick(col, id)} onClose={panes.leave} />
      </div>
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
