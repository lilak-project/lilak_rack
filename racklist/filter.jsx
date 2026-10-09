import { useCallback, useMemo, useState } from 'react'
import { facetOf, passesFilter } from './sort.js'

/**
 * Filtering, the RACK way, in one place so every list service does it the same.
 *
 * It has a MODE. In it the column labels stop sorting and start choosing which
 * column you are picking values from; the values arrive as rows of the same
 * table, with how many each would keep, and the picks pile up across columns
 * until they are applied. AND across columns, OR inside one.
 *
 * The one search box searches the values on offer while the mode is on — a
 * column with two thousand values is not a list you scroll.
 *
 *   const f = useFacetFilter(scope, SORTERS, { sel: VIEW.fsel, on: VIEW.fon })
 *   <FilterBar f={f} />                     // on the command line
 *   <RackTable facet={f.tableFacet} …>      // labels become value pickers
 *     <FacetRows f={f} />                   // the values, while the mode is on
 */
export function useFacetFilter(scope, sorters, initial = {}) {
  const [mode, setMode] = useState(false)
  const [col, setCol] = useState(null)
  const [sel, setSel] = useState(initial.sel || {})
  const [on, setOn] = useState(!!initial.on)
  const [find, setFind] = useState('')

  const chosen = useCallback((k) => sel[k] || [], [sel])
  const total = Object.values(sel).reduce((t, v) => t + v.length, 0)

  // Counted over the tab's own rows, not the filtered ones: a value that would
  // empty the list is still worth seeing.
  const all = useMemo(() => facetOf(scope, sorters[col]), [scope, sorters, col])
  const facet = useMemo(() => {
    const q = find.trim().toLowerCase()
    return q ? all.filter((x) => x.v.toLowerCase().includes(q)) : all
  }, [all, find])

  const toggle = useCallback((v) => setSel((s) => {
    const cur = s[col] || []
    return { ...s, [col]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }
  }), [col])

  const start = useCallback(() => { setMode(true); setFind('') }, [])
  const pick = useCallback((k) => { setCol(k); setFind('') }, [])
  const apply = useCallback(() => { setMode(false); setFind(''); setOn(total > 0) }, [total])
  const cancel = useCallback(() => { setMode(false); setFind('') }, [])
  const clear = useCallback(() => { setOn(false); setSel({}); setCol(null); setFind('') }, [])

  /** Does this record pass what has been applied? */
  const passes = useCallback((r) => passesFilter(r, sel, sorters), [sel, sorters])
  /** What RackTable needs to turn its labels into value pickers. */
  const tableFacet = mode ? { col, count: (k) => chosen(k).length, onPick: pick } : null

  return { mode, col, sel, on, find, setFind, setSel, setOn, facet, total, chosen,
           toggle, start, pick, apply, cancel, clear, passes, tableFacet }
}

/** The three states on the command line: choose, applied, off. */
export function FilterBar({ f, labels = {} }) {
  const L = {
    choose: '필터 선택', apply: '필터 적용', cancel: '취소',
    off: '필터 풀기', edit: '필터 고치기', hint: '레이블을 눌러 종류를 고르세요.',
    ...labels,
  }
  if (f.mode) {
    return (
      <>
        <button type="button" className="rl-btn rl-go" onClick={f.apply}>
          {L.apply}{f.total ? ` (${f.total})` : ''}
        </button>
        <button type="button" className="rl-btn" onClick={f.cancel}>{L.cancel}</button>
        <span className="rl-hint">{L.hint}</span>
      </>
    )
  }
  if (f.on) {
    return (
      <>
        <button type="button" className="rl-btn rl-danger" onClick={f.clear}>{L.off}</button>
        <button type="button" className="rl-btn" onClick={f.start}>{L.edit}</button>
      </>
    )
  }
  return <button type="button" className="rl-btn" onClick={f.start}>{L.choose}</button>
}

/** The values on offer, as rows of the table they will filter. */
export function FacetRows({ f, labels = {} }) {
  const L = {
    pickCol: '위의 레이블을 눌러 어떤 종류로 걸를지 고르세요.',
    empty: '이 열에는 값이 없습니다.',
    none: '찾는 값이 없습니다.',
    ...labels,
  }
  if (!f.mode) return null
  if (!f.col) return <p className="rl-msg">{L.pickCol}</p>
  if (f.facet.length === 0) {
    return <p className="rl-msg">{f.find.trim() ? L.none : L.empty}</p>
  }
  return f.facet.map(({ v, count }, i) => {
    const on = f.chosen(f.col).includes(v)
    return (
      <div key={v} className={`rl-row rl-frow rl-hit${on ? ' on' : ''}`}
        onClick={() => f.toggle(v)}>
        <span className="rl-chk">
          <input type="checkbox" checked={on} tabIndex={-1} readOnly aria-label={`${v} 고르기`} />
        </span>
        <span className="rl-gut">{i + 1}</span>
        <span className="rl-c rl-ink">{v}</span>
        <span className="rl-c rl-num">{count}</span>
      </div>
    )
  })
}
