import './strings.js'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { tr } from 'lilak-ui/i18n.jsx'

/** `%` lines, folded away.
 *
 *  A manuscript carries as much commented-out text as text — a paragraph
 *  somebody cut and did not throw away, a figure from the last version, the
 *  template's own instructions. None of it compiles, and all of it is in the
 *  way of reading what does.
 *
 *  Folding, not hiding: the lines are the file's own and nothing here rewrites
 *  them. A run of them becomes one marker saying how many there were.
 */
export const setFoldComments = StateEffect.define()

/** A line that is ALL comment. `x = 1 % note` is not one — half a line folded
 *  away is a line nobody can read. */
const COMMENT = /^\s*%/

/** Folded away: not a chip saying how many, a RULE saying something is here.
 *  A chip is a thing to read, and the whole point was to stop reading these. */
class Folded extends WidgetType {
  constructor(n) { super(); this.n = n }
  eq(other) { return other.n === this.n }
  toDOM() {
    const b = document.createElement('span')
    b.className = 'nt-folded'
    b.title = tr("nt_cmt_folded", this.n)
    return b
  }
  ignoreEvent() { return false }
}

/** Where the runs of comment lines are: [{ from, to, n }]. */
const runs = (doc) => {
  const out = []
  let from = 0
  let n = 0
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i)
    if (COMMENT.test(line.text)) {
      if (!n) from = line.from
      n += 1
    } else if (n) {
      out.push({ from, to: doc.line(i - 1).to, n })
      n = 0
    }
  }
  if (n) out.push({ from, to: doc.line(doc.lines).to, n })
  return out
}

const decorate = (state, on) => (!on ? Decoration.none : Decoration.set(
  runs(state.doc).map((r) => Decoration.replace({ block: true, widget: new Folded(r.n) }).range(r.from, r.to)),
  true))

export const commentFold = StateField.define({
  create: () => ({ on: false, deco: Decoration.none }),
  update(cur, tx) {
    const on = tx.effects.reduce((v, e) => (e.is(setFoldComments) ? !!e.value : v), cur.on)
    if (on === cur.on && !tx.docChanged) return cur
    return { on, deco: decorate(tx.state, on) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

/** The comment lines themselves, for the tool's list: [{ n, text }]. The `%`
 *  signs are dropped — what is worth reading is what was written after them. */
export const comments = (body) => {
  const out = []
  String(body || '').split('\n').forEach((text, i) => {
    // The `%` and one space after it go; the spaces further in stay, because
    // a commented-out `\item` is indented for a reason. Trailing space goes —
    // `%   ` is an empty line, and the tool draws those as a dash.
    if (COMMENT.test(text)) out.push({ n: i + 1, text: text.replace(/^[ \t]*%+[ \t]?/, '').trimEnd() })
  })
  return out
}
