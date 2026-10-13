/** Sorting, filling a template, and the values a column offers. */

/** Blanks last whichever way the arrow points: an empty cell is not a value.
 *  A missing getter leaves the order alone: a service whose tabs sort by
 *  different sets of columns will ask for one tab's column on another's rows,
 *  and a comparator that throws takes the whole page down with it. */
export function bySome(get, dir) {
  if (typeof get !== 'function') return () => 0
  return (a, b) => {
    const x = get(a), y = get(b)
    const xe = x === null || x === undefined || x === ''
    const ye = y === null || y === undefined || y === ''
    if (xe || ye) return xe && ye ? 0 : (xe ? 1 : -1)
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
    return String(x).localeCompare(String(y), 'ko') * dir
  }
}

/** `{column} …` with the record's own values. A token nobody knows is left
 *  standing rather than blanked, so a typo is visible. */
export const fill = (tpl, rec, tokens) => String(tpl).replace(/\{([^{}]+)\}/g, (m, k) => {
  const f = tokens[k.trim()]
  return f ? String(f(rec) ?? '') : m
})

/** The values on offer for one column, and how many rows each would keep.
 *  Counted over the whole scope, not the filtered rows: a value that would
 *  empty the list is still worth seeing. */
export function facetOf(recs, get) {
  if (!get) return []
  const n = new Map()
  for (const r of recs) {
    const v = String(get(r) ?? '')
    if (v) n.set(v, (n.get(v) || 0) + 1)
  }
  return [...n.entries()].map(([v, count]) => ({ v, count }))
    .sort((x, y) => y.count - x.count || x.v.localeCompare(y.v, 'ko'))
}

/** Every selected value must match, column by column: AND across columns,
 *  OR inside one. An empty column is not a constraint. */
export const passesFilter = (rec, fsel, sorters) => Object.entries(fsel).every(([k, vals]) =>
  !vals.length || vals.includes(String(sorters[k]?.(rec) ?? '')))

/** The sort STACK. Clicking a column sorts by it and keeps what you sorted by
 *  before as the tiebreaker, so name → affiliation → core comes out ordered by
 *  core, then affiliation, then name. Clicking the same column again turns it
 *  over without disturbing the rest. */
export const asSorts = (sort) => (Array.isArray(sort) ? sort : (sort ? [sort] : []))
export const bumpSort = (sort, k, depth = 4) => {
  const list = asSorts(sort)
  const was = list.find((s) => s.k === k)
  return [{ k, dir: was ? -was.dir : 1 }, ...list.filter((s) => s.k !== k)].slice(0, depth)
}
/** One comparator out of the stack. `sorters` is a map or a (key) => accessor;
 *  `tie` decides what equal rows do, which is where a list's own order goes. */
export const byKeys = (sort, sorters, tie) => (a, b) => {
  for (const s of asSorts(sort)) {
    const get = typeof sorters === 'function' ? sorters(s.k) : sorters[s.k]
    if (!get) continue
    const r = bySome(get, s.dir || 1)(a, b)
    if (r) return r
  }
  return tie ? tie(a, b) : 0
}
