/** A note changed in two places at once: here, while it was being written, and
 *  somewhere else (a to-do ticked in the list, the recorder, an agent, a
 *  sync). The save is refused (409) and the two are put together instead of
 *  one being thrown away — line by line against the copy both started from.
 *
 *  Where both changed the same lines, BOTH are kept (mine, then theirs) and
 *  `clash` says so: a line written twice can be seen and deleted, a line lost
 *  cannot be got back.
 */

/** Which line of `b` each line of `a` is, where they are the same (a longest
 *  common subsequence; the same head and tail are skipped first, which is
 *  nearly all of a note). `null` when what is left is too much to compare.
 *  ponytail: a table of n×m, capped at 4e6 cells (2000 changed lines a side);
 *  Myers' diff if a note ever gets there. */
function match(a, b) {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1
  const n = a.length - p - s, m = b.length - p - s
  if (n * m > 4e6) return null
  const w = m + 1
  const t = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      t[i * w + j] = a[p + i] === b[p + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    }
  }
  const at = new Map()
  for (let i = 0; i < p; i += 1) at.set(i, i)
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[p + i] === b[p + j]) { at.set(p + i, p + j); i += 1; j += 1 }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i += 1
    else j += 1
  }
  for (let k = 0; k < s; k += 1) at.set(a.length - s + k, b.length - s + k)
  return at
}

const same = (x, y) => x.length === y.length && x.every((l, i) => l === y[i])

/** `{ text, clash }`: `mine` and `theirs`, both made from `base`, as one text.
 *  `lost` (with `clash`): too big to compare, so `mine` is kept as it is. */
export function merge3(base, mine, theirs) {
  if (mine === base) return { text: theirs, clash: false }
  if (theirs === base || theirs === mine) return { text: mine, clash: false }
  const B = base.split('\n'), M = mine.split('\n'), T = theirs.split('\n')
  const inMine = match(B, M), inTheirs = match(B, T)
  if (!inMine || !inTheirs) return { text: mine, clash: true, lost: true }
  const out = []
  let clash = false
  const settle = (b, m, t) => {
    if (same(m, b)) out.push(...t)
    else if (same(t, b) || same(m, t)) out.push(...m)
    else { clash = true; out.push(...m, ...t) }
  }
  // A line of the base that both still have is a place to stand; what lies
  // between two of them is settled as one piece.
  let i = 0, im = 0, it = 0
  for (let s = 0; s <= B.length; s += 1) {
    const end = s === B.length
    if (!end && !(inMine.has(s) && inTheirs.has(s))) continue
    const em = end ? M.length : inMine.get(s), et = end ? T.length : inTheirs.get(s)
    settle(B.slice(i, s), M.slice(im, em), T.slice(it, et))
    if (!end) { out.push(B[s]); i = s + 1; im = em + 1; it = et + 1 }
  }
  return { text: out.join('\n'), clash }
}

const json = (v) => JSON.stringify(v || {})

/** The note to go on with after a refused save: the body merged, and each of
 *  the title, the date and the fields mine if I changed it, theirs if not. */
export function rebase(base, mine, theirs) {
  const body = merge3(String(base.body || ''), String(mine.body || ''), String(theirs.body || ''))
  return {
    note: {
      ...theirs,
      title: mine.title === base.title ? theirs.title : mine.title,
      date: (mine.date || '') === (base.date || '') ? theirs.date : mine.date,
      fields: json(mine.fields) === json(base.fields) ? theirs.fields : mine.fields,
      body: body.text,
    },
    clash: body.clash,
    lost: !!body.lost,
  }
}

/** `text` into a CodeMirror view, changing only what differs: the caret and
 *  the scroll stay where they are unless they were inside the part replaced. */
export function retext(view, text) {
  const cur = view.state.doc.toString()
  if (cur === text) return
  const max = Math.min(cur.length, text.length)
  let p = 0
  while (p < max && cur.charCodeAt(p) === text.charCodeAt(p)) p += 1
  let s = 0
  while (s < max - p && cur.charCodeAt(cur.length - 1 - s) === text.charCodeAt(text.length - 1 - s)) s += 1
  view.dispatch({ changes: { from: p, to: cur.length - s, insert: text.slice(p, text.length - s) } })
}
