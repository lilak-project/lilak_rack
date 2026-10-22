import './strings.js'
import { asSorts } from './sort.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tr } from '../i18n.jsx'

/**
 * The table shell: one column template, a sticky head, draggable edges.
 *
 * The head and every row read the SAME `cols`, so a column is a column all the
 * way down, whatever the reader drags it to. Nothing here knows what the rows
 * are about — cells arrive as a { key: value } map.
 */
const sortRank = (sort, k) => asSorts(sort).findIndex((s) => s.k === k)

export function RackTable({ cols, onDrag, head, sort, onSort, facet, children }) {
  const tmpl = `${cols.map((c) => `${c.w}px`).join(' ')} 1fr`
  // When the table is wider than the room it has — a narrow window, or the
  // editor taking half — the columns that fall off the end are reached by the
  // arrows at the edges rather than by a scrollbar lying across the rows.
  const body = useRef(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const look = useCallback(() => {
    const el = body.current
    if (!el) return
    const more = el.scrollWidth - el.clientWidth
    const next = { left: el.scrollLeft > 2, right: more > 2 && el.scrollLeft < more - 2 }
    // Only when it changed: this runs after every commit, and a setState that
    // always fires is a render loop.
    setEdge((cur) => (cur.left === next.left && cur.right === next.right ? cur : next))
  }, [])
  // After every commit, because the thing that changes the width is usually a
  // render — the editor opening beside the list. A ResizeObserver was tried
  // and does not fire for that in every embedding.
  useLayoutEffect(look)
  useEffect(() => {
    const el = body.current
    if (!el) return undefined
    el.addEventListener('scroll', look)
    const ro = new ResizeObserver(look)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', look); ro.disconnect() }
  }, [look])
  const slide = (dir) => {
    const el = body.current
    if (!el) return
    // One column at a time, from where we are: a fixed number of pixels lands
    // mid-column and reads as a broken table.
    let x = 0
    const stops = cols.map((c) => { x += c.w; return x })
    const at = el.scrollLeft
    const next = dir > 0 ? stops.find((s) => s > at + 2)
      : [...stops].reverse().find((s) => s < at - 2) ?? 0
    // Plain, not smooth: a smooth scroll is a nicety that some embeddings
    // drop on the floor, and then the arrow does nothing at all.
    el.scrollLeft = Math.max(0, next ?? at)
  }
  return (
    <div className="rl-tab-wrap">
      {edge.left && (
        <button type="button" className="rl-edge rl-edge-l" title={tr("rk_left_column")}
          onClick={() => slide(-1)}>‹</button>
      )}
      {edge.right && (
        <button type="button" className="rl-edge rl-edge-r" title={tr("rk_right_column")}
          onClick={() => slide(1)}>›</button>
      )}
      <div className="rl-tab-body" ref={body}>
      <div className="rl-row rl-head" style={{ gridTemplateColumns: tmpl }}>
        {cols.map((c) => (
          <span key={c.k}
            className={`${c.k === 'num' ? 'rl-gut' : 'rl-c'}`
              + `${c.num ? ' rl-num' : ''}${c.k === 'chk' ? ' rl-chk' : ''}`}>
            {c.k === 'chk' && head ? (
              <input type="checkbox" checked={head.all}
                ref={(el) => { if (el) el.indeterminate = !head.all && head.some }}
                onChange={head.onAll} aria-label={tr("rk_select_all")} />
            ) : facet && !c.fix ? (
              // In filter mode the label stops sorting and starts choosing
              // which column you are picking values from.
              <button type="button" className={`rl-sort rl-facet${facet.col === c.k ? ' on' : ''}`}
                onClick={() => facet.onPick(c.k)}>
                {c.label}
                {facet.count(c.k) > 0 && <i className="rl-arrow">{facet.count(c.k)}</i>}
              </button>
            ) : onSort && !c.fix ? (
              // The label IS the sort control: press it again and the arrow
              // turns over.
              <button type="button" className="rl-sort" onClick={() => onSort(c.k)}>
                {c.label}
                {/* The one it is ordered by wears the arrow; the ones it falls
                    back on wear their place in the stack, so a column you
                    sorted three clicks ago still says it is doing something. */}
                {sortRank(sort, c.k) === 0 && (
                  <i className="rl-arrow">{asSorts(sort)[0].dir > 0 ? '↑' : '↓'}</i>
                )}
                {sortRank(sort, c.k) > 0 && (
                  <i className="rl-arrow rl-dim">{sortRank(sort, c.k) + 1}</i>
                )}
              </button>
            ) : c.label}
            {!c.fix && <i className="rl-grip" onMouseDown={(e) => {
              e.preventDefault(); e.stopPropagation(); onDrag(c.k, e.clientX, c.w)
            }} />}
          </span>
        ))}
        <span className="rl-c" />
      </div>
      {children}
      </div>
    </div>
  )
}

/** The words the search box asked for, lit where a cell shows them. */
function lit(text, q) {
  const low = text.toLowerCase()
  const k = q.toLowerCase()
  if (!k || !low.includes(k)) return text
  const out = []
  let i = 0
  for (let j = low.indexOf(k); j >= 0; j = low.indexOf(k, i)) {
    if (j > i) out.push(text.slice(i, j))
    out.push(<mark key={j} className="rl-hl">{text.slice(j, j + k.length)}</mark>)
    i = j + k.length
  }
  if (i < text.length) out.push(text.slice(i))
  return out
}

/** One line. `mark` lights the search's words in the cells that show them.
 *  `tone` marks a column's colour class by key, e.g.
 *  { name: 'ink', journal: 'dim' } — the service says which, not this file. */
export function RackRow({ cols, cell, tone = {}, className, onClick, onContextMenu, mark }) {
  const tmpl = `${cols.map((c) => `${c.w}px`).join(' ')} 1fr`
  const show = (v) => (mark && typeof v === 'string' ? lit(v, mark) : v)
  return (
    <div className={`rl-row ${className || ''}`} style={{ gridTemplateColumns: tmpl }}
      onClick={onClick} onContextMenu={onContextMenu}>
      {cols.map((c) => (
        <span key={c.k}
          className={`${c.k === 'num' ? 'rl-gut' : 'rl-c'}`
            + `${c.k === 'chk' ? ' rl-chk' : ''}${c.num ? ' rl-num' : ''}`
            + `${tone[c.k] ? ` rl-${tone[c.k]}` : ''}`}>
          {show(cell[c.k])}
        </span>
      ))}
      <span className="rl-c" />
    </div>
  )
}

/** A strip of tabs. `fixed` are the ones that are always there (no ×); the rest
 *  carry one, and wear a different colour so you can tell before you look. */
export function RackTabs({ tabs, active, onPick, onClose, fixed = [], opened = false }) {
  return (
    <div className="rl-tabs">
      {tabs.map((t) => {
        const isFixed = !opened && fixed.some((f) => f === t.id || f?.id === t.id)
        return (
          <span key={t.id} className={`rl-tab${isFixed ? '' : ' rl-opened'}${t.id === active ? ' on' : ''}`}
            style={t.color ? { '--tone': t.color } : undefined}>
            <button type="button" className="rl-tabname" onClick={() => onPick(t.id)}>{t.label}</button>
            {!isFixed && onClose && (
              <button type="button" className="rl-x" title={tr("rk_close")}
                onClick={() => onClose(t.id)} aria-label={tr("rk_close_named", t.label)}>×</button>
            )}
          </span>
        )
      })}
    </div>
  )
}
