import { useCallback, useMemo, useState } from 'react'
import { RackTabs } from './table.jsx'

/**
 * The editor beside the list, in one or two columns.
 *
 * A record you are fixing is not one of the lists, so it has its own tabs; two
 * records open side by side is a second column of them. The column a tab is in
 * is the tab's own business (`col`), so the arrangement is one array and the
 * panes are drawn from it.
 *
 *   const panes = useEditorPanes()
 *   panes.open({ id, label, … })      // whatever the service's tab is
 *   panes.cols.map((c) => <div className="rl-pane rl-epane">
 *       <RackPaneStrip panes={panes} col={c} />
 *       … the editor for panes.current(c) …
 *   </div>)
 */
export function useEditorPanes() {
  const [tabs, setTabs] = useState([])            // [{ …service's own, col }]
  const [active, setActive] = useState({})        // { col: id }
  const [col, setCol] = useState(0)               // where a new record opens
  const [full, setFull] = useState(false)         // the list gives up its width

  const open = useCallback((t) => {
    setTabs((ts) => {
      const had = ts.find((x) => x.id === t.id)
      const to = had ? had.col : col
      setActive((a) => ({ ...a, [to]: t.id }))
      return had ? ts : [...ts, { ...t, col: to }]
    })
  }, [col])

  const close = useCallback((id) => {
    setTabs((ts) => {
      const gone = ts.find((x) => x.id === id)
      const left = ts.filter((x) => x.id !== id)
      if (gone) {
        const mine = left.filter((x) => x.col === gone.col)
        setActive((a) => ({ ...a, [gone.col]: mine.length ? mine[mine.length - 1].id : null }))
        if (!mine.length) setCol(left.length ? left[left.length - 1].col : 0)
      }
      return left
    })
  }, [])

  const closeAll = useCallback(() => { setTabs([]); setActive({}); setCol(0) }, [])

  /** Send a record to the other side — which is how the second column comes to
   *  exist, and how it stops existing when its last record leaves. */
  const move = useCallback((id) => {
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id)
      if (!t) return ts
      const far = Math.max(...ts.map((x) => x.col))
      const to = t.col >= far ? t.col - 1 : t.col + 1
      const left = ts.filter((x) => x.id !== id && x.col === t.col)
      setActive((a) => ({ ...a, [to]: id, [t.col]: left.length ? left[left.length - 1].id : null }))
      setCol(to)
      return ts.map((x) => (x.id === id ? { ...x, col: to } : x))
    })
  }, [])

  /** A tab for something the service no longer has cannot be shown. */
  const keep = useCallback((alive) => setTabs((ts) => (ts.every(alive) ? ts : ts.filter(alive))), [])

  const cols = useMemo(() => [...new Set(tabs.map((t) => t.col))].sort((a, b) => a - b), [tabs])
  const inCol = useCallback((c) => tabs.filter((t) => t.col === c), [tabs])
  const current = useCallback((c) => {
    const mine = tabs.filter((t) => t.col === c)
    return mine.find((t) => t.id === active[c]) || mine[0] || null
  }, [tabs, active])

  return {
    tabs, cols, open, close, closeAll, move, keep, inCol, current, setCol,
    pick: (c, id) => setActive((a) => ({ ...a, [c]: id })),
    full, setFull, count: tabs.length, showing: cols.length > 0,
  }
}

/** A square, and a square with its left third taken: what the list gives up. */
const Expand = ({ on }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1"
      fill="none" stroke="currentColor" strokeWidth="1.3" />
    {on && <path d="M6 2.5 V13.5" stroke="currentColor" strokeWidth="1.3" />}
  </svg>
)

/**
 * One editor column's strip: its tabs, and the two things a reader may want to
 * do with the column itself.
 *
 *   ← / →   send this record to the other side (the arrow points AWAY from the
 *           side this column stands on, which is where the record will land)
 *   ▭       take the list's width as well, or give it back
 */
export function RackPaneStrip({ panes, col }) {
  const cur = panes.current(col)
  const last = panes.cols[panes.cols.length - 1]
  const toLeft = col === last
  return (
    <div className="rl-strip">
      <div className="rl-strip-tabs" onDoubleClick={() => panes.setFull(!panes.full)}
        title="두 번 눌러 전체 너비">
        <RackTabs tabs={panes.inCol(col)} active={cur?.id} opened
          onPick={(id) => panes.pick(col, id)} onClose={panes.close} />
      </div>
      {cur && (
        <button type="button" className="rl-btn rl-pane-btn" onClick={() => panes.move(cur.id)}
          title={toLeft ? '왼쪽으로 보내기' : '오른쪽으로 보내기'}>{toLeft ? '←' : '→'}</button>
      )}
      <button type="button" className="rl-btn rl-pane-btn" onClick={() => panes.setFull(!panes.full)}
        title={panes.full ? '목록 다시 보기' : '전체 너비'}>
        <Expand on={panes.full} />
      </button>
    </div>
  )
}
