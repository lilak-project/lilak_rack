/** Sorting, filling a template, and the values a column offers. */

/** Blanks last whichever way the arrow points: an empty cell is not a value. */
export function bySome(get, dir) {
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
