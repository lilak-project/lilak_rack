/**
 * The table shell: one column template, a sticky head, draggable edges.
 *
 * The head and every row read the SAME `cols`, so a column is a column all the
 * way down, whatever the reader drags it to. Nothing here knows what the rows
 * are about — cells arrive as a { key: value } map.
 */
export function RackTable({ cols, onDrag, head, sort, onSort, facet, children }) {
  const tmpl = `${cols.map((c) => `${c.w}px`).join(' ')} 1fr`
  return (
    <div className="rl-tab-body">
      <div className="rl-row rl-head" style={{ gridTemplateColumns: tmpl }}>
        {cols.map((c) => (
          <span key={c.k}
            className={`${c.k === 'num' ? 'rl-gut' : 'rl-c'}`
              + `${c.num ? ' rl-num' : ''}${c.k === 'chk' ? ' rl-chk' : ''}`}>
            {c.k === 'chk' && head ? (
              <input type="checkbox" checked={head.all}
                ref={(el) => { if (el) el.indeterminate = !head.all && head.some }}
                onChange={head.onAll} aria-label="전체 선택" />
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
                {sort?.k === c.k && <i className="rl-arrow">{sort.dir > 0 ? '↑' : '↓'}</i>}
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
  )
}

/** One line. `tone` marks a column's colour class by key, e.g.
 *  { name: 'ink', journal: 'dim' } — the service says which, not this file. */
export function RackRow({ cols, cell, tone = {}, className, onClick, onContextMenu }) {
  const tmpl = `${cols.map((c) => `${c.w}px`).join(' ')} 1fr`
  return (
    <div className={`rl-row ${className || ''}`} style={{ gridTemplateColumns: tmpl }}
      onClick={onClick} onContextMenu={onContextMenu}>
      {cols.map((c) => (
        <span key={c.k}
          className={`${c.k === 'num' ? 'rl-gut' : 'rl-c'}`
            + `${c.k === 'chk' ? ' rl-chk' : ''}${c.num ? ' rl-num' : ''}`
            + `${tone[c.k] ? ` rl-${tone[c.k]}` : ''}`}>
          {cell[c.k]}
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
          <span key={t.id} className={`rl-tab${isFixed ? '' : ' rl-opened'}${t.id === active ? ' on' : ''}`}>
            <button type="button" className="rl-tabname" onClick={() => onPick(t.id)}>{t.label}</button>
            {!isFixed && onClose && (
              <button type="button" className="rl-x" title="닫기"
                onClick={() => onClose(t.id)} aria-label={`${t.label} 닫기`}>×</button>
            )}
          </span>
        )
      })}
    </div>
  )
}
