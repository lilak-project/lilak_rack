import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useColumnWidths, useViewportWidth, useSelection, useFindKey, useNote,
  useViewState, usePaneSplit,
} from './hooks.js'
import { useEditorPanes } from './panes.jsx'
import { useFacetFilter } from './filter.jsx'
import { projectKey } from './portal.js'

/**
 * useRackList — the WIRING every rack-list service was copying by hand.
 *
 * The kit had the parts (the table, the tabs, the filter, the panes) but each
 * service still spelled out the same hundred lines to connect them: read the
 * stored view, hold the tabs, size the columns, sort, filter, search, select,
 * split the panes, write the view back. Four services, four copies, and the
 * fifth was going to be a fifth.
 *
 * What stays with the SERVICE is what it is about: where its records come from
 * (`scopeOf`) and what its search looks at (`search`). Everything else is the
 * same job every time.
 *
 *   const L = useRackList({
 *     key: 'nt',                         // storage prefix: nt.view.<project> …
 *     fixed: FIXED,                      // the tabs that are always there
 *     sorters: SORTERS,                  // column key → accessor, or (tab) => that
 *     idOf: (r) => r.id,                 // what a selection holds — pass a STABLE function
 *     cols: { '': COLS, 'c:': CLS_COLS },// column sets, by width-key prefix
 *     sort: { k: 'date', dir: -1 },      // the order a tab has before you click
 *     clsSort: { k: 'count', dir: -1 },
 *     scopeOf: useCallback((tab, sort) => […], [data]),   // MEMOISE this
 *     search: (rec, q) => …,             // what the search box matches
 *     remember: { tscope },              // anything else to keep per project
 *   })
 *
 * `scopeOf` must be memoised by the caller: it is what ties the hook to the
 * service's own data, and an identity that changes every render would re-sort
 * and re-filter the list on every keystroke.
 */
const byId = (r) => r.id      // a constant, so the selection is not rebuilt every render

export function useRackList(cfg) {
  const {
    key, fixed, sorters: sortersIn = {}, cols = {}, scopeOf, search, remember,
    idOf = byId,
    sort: sort0 = null, clsSort: clsSort0 = { k: 'name', dir: 1 },
    firstTab = fixed?.[0]?.id,
  } = cfg

  const [view, saveView] = useViewState(projectKey(key, 'view'))
  const [tabs, setTabs] = useState(() => [...fixed,
    ...(view.tabs || []).filter((t) => t?.id && !fixed.some((f) => f.id === t.id))])
  const [active, setActive] = useState(view.active || firstTab)
  const [sort, setSort] = useState(view.sort ?? sort0)
  const [clsSort, setClsSort] = useState(view.clsSort || clsSort0)
  const [query, setQuery] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useNote()

  const panes = useEditorPanes(projectKey(key, 'panes'))
  const split = usePaneSplit(projectKey(key, 'split'))
  // Editors on BOTH sides of the list: each its own share, the list the rest.
  const sides = {
    left: usePaneSplit(projectKey(key, 'splitL'), 30, { min: 15, max: 42 }),
    right: usePaneSplit(projectKey(key, 'splitR'), 30, { edge: 'right', min: 15, max: 42 }),
  }
  const vw = useViewportWidth()
  const every = useMemo(() => Object.values(cols).flat(), [cols])   // eslint-disable-line react-hooks/exhaustive-deps
  const { drag, sized } = useColumnWidths(projectKey(key, 'cols'), every)
  const findRef = useRef(null)
  useFindKey(findRef)

  const tab = tabs.find((t) => t.id === active) || tabs[0]

  /** One column set at its current widths, minus what this window is too narrow
   *  for. `prefix` is the set's own width key — '' for the records, 'c:' for
   *  the classes — so two tables remember two widths for a column named alike.
   *  `set` picks which columns when one key serves two tables (authors and the
   *  other classes share 'c:' widths but not columns). */
  const colsOf = useCallback((prefix = '', set) => sized(set || cols[prefix] || [], vw, prefix),
    [sized, vw, cols])                                             // eslint-disable-line react-hooks/exhaustive-deps

  // The service sorts its own scope — a numbered reference list keeps its
  // numbers, a My-List-like tab keeps the order things were added — so the sort
  // is handed IN rather than applied on top. That is also what keeps the hook
  // and the service from needing each other in the same breath.
  const scope = useMemo(() => (scopeOf ? scopeOf(tab, sort) : []), [scopeOf, tab, sort])
  // Two kinds of tab may sort and filter by different columns, so the sorters
  // can depend on the tab.
  const sorters = useMemo(() => (typeof sortersIn === 'function' ? sortersIn(tab) : sortersIn),
    [sortersIn, tab])
  const filter = useFacetFilter(scope, sorters, { sel: view.fsel, on: view.fon })

  const rows = useMemo(() => {
    const kept = filter.on ? scope.filter(filter.passes) : scope
    const q = query.trim().toLowerCase()
    if (!q || !search) return kept
    return kept.filter((r) => search(r, q))
  }, [scope, filter.on, filter.passes, query, search])

  // What a selection holds is whatever names a record — `id` usually, but an
  // asset is known by its 자산번호 and has no other.
  const keys = useMemo(() => rows.map((r) => ({ id: idOf(r) })), [rows, idOf])
  const sel = useSelection(keys)
  const chosen = useMemo(() => rows.filter((r) => sel.picked.has(idOf(r))), [rows, sel.picked, idOf])

  // How this project was left. The four fixed tabs are not worth storing, and
  // picking mode is not a state you come back to — only the applied filter is.
  // `remember` is whatever else the service wants kept — its own scopes, its
  // own switches. It rides along rather than being a second effect.
  const extra = JSON.stringify(remember || null)
  useEffect(() => {
    saveView({
      tabs: tabs.filter((t) => !fixed.some((f) => f.id === t.id)),
      active, sort, clsSort, fsel: filter.sel, fon: filter.on, ...(remember || {}),
    })
  }, [tabs, active, sort, clsSort, filter.sel, filter.on, extra])  // eslint-disable-line react-hooks/exhaustive-deps

  // A tab you opened for something the document no longer has cannot be shown,
  // and neither can one of a KIND this service no longer has. The service says
  // which survive; until its data is in, nothing is pruned.
  const keepTabs = useCallback((alive) => setTabs((ts) => {
    const left = ts.filter((t) => fixed.some((f) => f.id === t.id) || alive(t))
    return left.length === ts.length ? ts : left
  }), [fixed])
  useEffect(() => {
    if (!tabs.some((t) => t.id === active)) setActive(firstTab)
  }, [tabs, active, firstTab])

  const openTab = useCallback((t) => {
    setTabs((ts) => (ts.some((x) => x.id === t.id) ? ts : [...ts, t]))
    setActive(t.id)
  }, [])
  /** Closing the tab you are on lands on `to` — the first tab unless the
   *  service knows a better one (a list's own tab goes back to the lists). */
  const closeTab = useCallback((id, to = firstTab) => {
    setTabs((ts) => ts.filter((t) => t.id !== id))
    setActive((a) => (a === id ? to : a))
  }, [firstTab])
  const closeOpened = useCallback(() => { setTabs(fixed); setActive(firstTab) }, [fixed, firstTab])

  // The editor takes the right half when there is room for both; below that it
  // has the width to itself while it is open.
  const showEdit = panes.showing
  const showList = !showEdit || (vw >= (panes.cols.length > 1 ? 1500 : 1180) && !panes.full)

  return {
    // what was stored, for the state a service keeps of its own
    view,
    // the tabs
    tabs, tab, active, setActive, openTab, closeTab, closeOpened, keepTabs, opened: tabs.length - fixed.length,
    // the table
    colsOf, drag, sort, setSort, clsSort, setClsSort,
    // what is in it
    scope, rows, filter, query, setQuery, findRef,
    // what you picked
    ...sel, chosen,
    // the panes and the frame
    panes, split, sides, vw, showList, showEdit,
    // the line at the foot
    note, setNote, err, setErr,
  }
}
