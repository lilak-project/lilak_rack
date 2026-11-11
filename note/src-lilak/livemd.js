import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { ViewPlugin } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import katex from 'katex'
import { tr } from 'lilak-ui/i18n.jsx'
import { openTab as open } from './api.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Rendered } from './reading.jsx'
import { headingNumbers, figureOf, figureList, isAudio, isProject, isAuthor, onProjChoices, onAuthorChoices, mathFences, overdue, commentSpans, highlightSpans, arrowSpans, MATH, FIGURE_RE, URGENT_RE } from './marks.js'

/** Markdown drawn on top of the text that IS the file.
 *
 *  Nothing here changes a character: the document stays exactly what the note
 *  says, and these are decorations over it — a heading is bigger, `**굵게**`
 *  loses its stars, `#태그` wears its chip. The line the caret is on shows its
 *  marks again, so what you edit is always the real text (the way Obsidian's
 *  live preview does it).
 *
 *  That is the whole point of the source editor: the picture is paint, and the
 *  file underneath is never rewritten.
 */

/** Marks that are hidden while the caret is elsewhere, and the node they wear. */
const PAINT = {
  StrongEmphasis: 'nt-cm-strong',
  Emphasis: 'nt-cm-em',
  Strikethrough: 'nt-cm-del',
  InlineCode: 'nt-code',
}
const MARKS = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark',
  'QuoteMark', 'LinkMark', 'URL'])

const TAG = /(^|[\s(])#(?![0-9]+(?![^\s#.,;:!?()[\]{}'"]))([^\s#.,;:!?()[\]{}'"]+)/g
const PROJ = /(^|[\s(])\+(?![0-9]+(?![^\s#+.,;:!?()[\]{}'"]))([^\s#+.,;:!?()[\]{}'"]+)/g
const AUTH = /(^|[\s(])@(?![0-9]+(?![^\s#+@.,;:!?()[\]{}'"]))([^\s#+@.,;:!?()[\]{}'"]+)/g
const DATE = /(»|📅|✓|✅)\s*(\d{4}-\d{1,2}-\d{1,2})/g
const WIKI = /(?<!!)\[\[([^\]]+)\]\]/g
const TASK = /^(\s*[-*]\s+)\[([ xX])\]/
/** A list item, and how far in it sits. */
const ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s/

/** A list item's line: how far in it sits, and how wide its marker is.
 *
 *  `pad` is the step for an item under another one — which steps further in
 *  than its spaces alone say, and whose text drops ONE size, however deep it
 *  goes after that. `wide` is the marker and the space after it (`- `, `12. `),
 *  which the line HANGS by: a wrapped line starts where the words started, not
 *  under the bullet, because the bullet marks the item and the second line is
 *  not a new one. In `ch` because that is what a character is wide. */
export const item = (text) => {
  const m = ITEM.exec(text)
  if (!m) return null
  const depth = Math.min(Math.floor(m[1].replace(/\t/g, '  ').length / 2), 6)
  return { depth, pad: depth > 0 ? 14 + depth * 12 : 0, at: m[1].length, wide: m[0].length - m[1].length }
}
/** A row of a table: its pipes only line up in a fixed-width face. */
const ROW = /^\s*\|/

/** A formula, set. The source stays in the file and comes back the moment the
 *  caret is on its line — like every other mark here, the picture is paint.
 *
 *  KaTeX is already in this app for the read view and for `.tex` notes, so
 *  there is nothing to add: the same two lines, in the editor. */
class Formula extends WidgetType {
  constructor(tex, block, flow = false) { super(); this.tex = tex; this.block = block; this.flow = flow }
  eq(o) { return o.tex === this.tex && o.block === this.block && o.flow === this.flow }
  toDOM() {
    const s = document.createElement('span')
    s.className = `${this.block ? 'nt-cm-math nt-cm-math-block' : 'nt-cm-math'}${this.flow ? ' nt-cm-math-flow' : ''}`
    // `throwOnError: false` draws what it could not read in red, in place —
    // which is the answer while something is half-typed.
    try { s.innerHTML = katex.renderToString(this.tex, { throwOnError: false, displayMode: this.block }) }
    catch { s.textContent = this.tex }
    return s
  }
  ignoreEvent() { return false }
}

/** Nothing, drawn: where a list item's words begin (see below). */
class Hold extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement('span'); s.className = 'nt-cm-gap'; return s }
  ignoreEvent() { return true }
}

/** `->`, drawn as the arrow it is read as. */
class Arrow extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement('span'); s.textContent = '→'; return s }
  ignoreEvent() { return false }
}

/** A picture in the note is two things on the screen, and neither is the
 *  text any more:
 *
 *  - the BAR, drawn in place of the markup (`![[a.png|420]]`): which figure
 *    this is, the file, and the only thing anyone changes about it — its
 *    size. It is atomic: the caret cannot get into it, a click on it lands the
 *    caret at its right, and Backspace there takes the whole picture off in
 *    one press, because that is what the bar IS — one thing.
 *  - the PICTURE, a block under that line. It stays under the line whether the
 *    bar or the raw markup is shown above it.
 *
 *  The markup comes back ONLY through the bar's 편집 button (the `raw` field).
 *  Not when the caret arrives — a caret comes to read as often as to write —
 *  and not when a button is pressed: a size written by the bar is the note
 *  changing, not the note being typed in. It goes again when the caret leaves
 *  the line.
 */

/** The markup being edited by hand: where it starts, or -1. Set by 편집,
 *  carried along through edits, ended when the caret goes to another line. */
const setRaw = StateEffect.define()
const raw = StateField.define({
  create: () => -1,
  update(pos, tr) {
    for (const e of tr.effects) if (e.is(setRaw)) return e.value
    if (pos < 0) return pos
    pos = Math.min(tr.changes.mapPos(pos), tr.state.doc.length)
    const line = tr.state.doc.lineAt(pos).number
    return tr.state.doc.lineAt(tr.state.selection.main.head).number === line ? pos : -1
  },
})

/** Where the markup is, read from where the widget's DOM stands: the bar
 *  stands in it, the picture stands at the end of its line — either way the
 *  markup is on that line, and the text itself says exactly where. `null`
 *  when it is not (the note changed under the widget): then nothing is done,
 *  which is the right amount. */
function markupAt(view, dom, want) {
  let at
  try { at = view.posAtDOM(dom) } catch { return null }
  if (at == null || at < 0) return null
  const doc = view.state.doc
  for (const p of [at, Math.max(0, at - 1)]) {
    const line = doc.lineAt(Math.min(p, doc.length))
    const i = line.text.indexOf(want)
    if (i >= 0) return { from: line.from + i, to: line.from + i + want.length, line }
  }
  return null
}

/** The markup rewritten with this width, or with none (`px` 0). */
/** How much smaller than the page a slide is drawn in this pane (SourceArea
 *  `--nt-k`), 1 everywhere else. A written width means the page's pixels. */
const zoomOf = (view) => parseFloat(view.dom.parentElement?.style.getPropertyValue('--nt-k')) || 1

function writeWidth(view, dom, markup, px) {
  const at = markupAt(view, dom, markup)
  if (!at) return
  view.dispatch({ changes: { from: at.from, to: at.to, insert: figureOf(markup).sized(px) } })
}

/** The caret to the right of the markup — where it lands when the bar or the
 *  picture is pressed. The bar is atomic, so this is as near as it gets. */
function caretAfter(view, dom, markup) {
  const at = markupAt(view, dom, markup)
  if (!at) return
  view.dispatch({ selection: { anchor: at.to }, scrollIntoView: true })
  view.focus()
}

/** The picture this bar is over: the block right under the bar's line. Found
 *  through the DOM because the two are separate widgets; `null` until it is
 *  drawn. */
const pictureUnder = (bar) => bar.closest('.cm-line')?.nextElementSibling?.querySelector?.('img.nt-embed') || null

/** A file that is not a picture (`![[paper.pdf]]`): a link, in the markup's place. */
class FileLink extends WidgetType {
  constructor(spec, src) { super(); this.spec = spec; this.src = src }
  eq(other) { return other.spec === this.spec }
  toDOM() {
    // A recording plays where it is written.
    if (isAudio(this.spec)) {
      const au = document.createElement('audio')
      au.className = 'nt-audio'
      au.controls = true
      au.preload = 'none'
      au.src = this.src(this.spec)
      return au
    }
    const a = document.createElement('a')
    a.className = 'nt-file'
    a.href = this.src(this.spec)
    a.textContent = this.spec
    a.addEventListener('mousedown', (e) => { e.preventDefault(); open(a.href) })
    return a
  }
  ignoreEvent() { return true }
}

/** A heading's number (`numbered` notes): drawn, never in the file. */
class HeadNo extends WidgetType {
  constructor(no) { super(); this.no = no }
  eq(other) { return other.no === this.no }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'nt-cm-headno'
    el.textContent = this.no
    return el
  }
}

class Bar extends WidgetType {
  constructor(markup, n) { super(); this.markup = markup; this.n = n }
  eq(other) { return other.markup === this.markup && other.n === this.n }
  toDOM(view) {
    const { name, w } = figureOf(this.markup)
    const bar = document.createElement('span')
    bar.className = 'nt-fig-bar'
    const cell = (cls, text, title) => {
      const el = document.createElement('span')
      el.className = `nt-fig-c ${cls}`
      el.textContent = text
      if (title) el.title = title
      bar.appendChild(el)
      return el
    }
    const button = (cls, text, title, fn) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `nt-fig-c nt-fig-do ${cls}`
      b.textContent = text
      b.title = title
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); fn() })
      bar.appendChild(b)
      return b
    }
    cell('nt-fig-n', tr('nt_fig_n', this.n))
    cell('nt-fig-name', name.split('/').pop(), name)
    // The text, to be edited by hand — the one way back to it.
    button('nt-fig-edit', tr('nt_fig_edit'), tr('nt_fig_edit_hint'), () => {
      const at = markupAt(view, bar, this.markup)
      if (!at) return
      view.dispatch({ effects: setRaw.of(at.from), selection: { anchor: at.to }, scrollIntoView: true })
      view.focus()
    })
    /** How wide the picture is NOW: as written, or as drawn under the bar. */
    const wide = () => w || Math.round((pictureUnder(bar)?.getBoundingClientRect().width || 0) / zoomOf(view)) || 400
    const write = (px) => writeWidth(view, bar, this.markup, px)
    // A quarter either way. Wider than the column shows nothing more (the
    // picture stops at the column's edge whatever is written), so + stops there.
    button('nt-fig-less', '−', tr('nt_img_out'), () => write(Math.max(40, wide() / 1.25)))
    button('nt-fig-more', '+', tr('nt_img_in'), () => write(Math.min((view.contentDOM.clientWidth || 9e3) / zoomOf(view), wide() * 1.25)))
    const px = document.createElement('input')
    px.type = 'number'
    px.className = 'nt-fig-c nt-fig-px'
    px.min = '40'
    px.step = '10'
    px.title = tr('nt_img_px')
    if (w) px.value = String(w)
    else {
      // No width written: the box still says how wide it IS, in the dim
      // colour of a thing read rather than set. The picture is drawn after
      // the bar, so it is asked a moment later, and once more when it has
      // had time to load. ponytail: two looks, not a listener.
      px.classList.add('nt-fig-auto')
      const look = () => { if (!px.value && document.activeElement !== px) { const n = wide(); if (n !== 400) px.value = String(n) } }
      requestAnimationFrame(look)
      setTimeout(look, 400)
      px.addEventListener('focus', () => { px.classList.remove('nt-fig-auto') })
    }
    px.addEventListener('mousedown', (e) => e.stopPropagation())
    px.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); px.blur() } })
    px.addEventListener('change', () => write(Math.max(0, Number(px.value) || 0)))
    bar.appendChild(px)
    button('nt-fig-fit', tr('nt_img_auto'), tr('nt_img_auto_hint'), () => write(0))
    // Pressed anywhere else on it: the caret to its right.
    bar.addEventListener('mousedown', (e) => { e.preventDefault(); caretAfter(view, bar, this.markup) })
    return bar
  }
  // Everything on the bar is the bar's: nothing here is a place in the text.
  ignoreEvent() { return true }
}

/** The picture, under its line. Drag the corner and the width is written
 *  into the markup above — once, when the button comes up. */
class Picture extends WidgetType {
  constructor(markup, n, src) { super(); this.markup = markup; this.n = n; this.src = src }
  eq(other) { return other.markup === this.markup && other.n === this.n }
  toDOM(view) {
    const { name, w, url } = figureOf(this.markup)
    const box = document.createElement('div')
    box.className = 'nt-embed-box'
    const img = document.createElement('img')
    img.className = 'nt-embed'
    img.src = url(this.src)
    img.alt = name
    // A width written in the note is meant: it is let out of the height cap
    // the pictures without one are kept under (note.css).
    if (w) { img.style.width = `${w}px`; img.style.maxHeight = 'none'; img.style.setProperty('--nt-w', w) }
    // A picture with no width is its own size on a slide, so that scales too.
    img.addEventListener('load', () => img.style.setProperty('--nt-n', img.naturalWidth))
    box.appendChild(img)
    const grip = document.createElement('span')
    grip.className = 'nt-embed-grip'
    grip.title = tr('nt_img_drag')
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const x0 = e.clientX
      const w0 = img.getBoundingClientRect().width
      const k = zoomOf(view)
      const to = (ev) => Math.max(40, Math.round((w0 + ev.clientX - x0) / k))
      const move = (ev) => { img.style.width = `${to(ev)}px`; img.style.maxHeight = 'none'; img.style.setProperty('--nt-w', to(ev)) }
      const up = (ev) => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        document.body.classList.remove('nt-sizing')
        writeWidth(view, box, this.markup, to(ev))
      }
      document.body.classList.add('nt-sizing')
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
    box.appendChild(grip)
    // On a slide only (note.css): the number the show draws under it.
    const cap = document.createElement('span')
    cap.className = 'nt-fig-cap'
    cap.textContent = tr('nt_fig_n', this.n)
    box.appendChild(cap)
    // A press on the picture: the caret to the right of its bar.
    box.addEventListener('mousedown', (e) => { e.preventDefault(); caretAfter(view, box, this.markup) })
    return box
  }
  ignoreEvent() { return true }
}

/** The pictures, as blocks under their lines. A block decoration may not come
 *  from a plugin (it changes how tall a line is), so this is a field: read
 *  from the whole note whenever the note changes, which is cheap — a note is
 *  a page, not a book. */
const pictureBlocks = (fileSrc) => {
  const of = (state) => {
    const doc = state.doc
    const marks = []
    for (const f of figureList(doc.toString())) {
      marks.push(Decoration.widget({ widget: new Picture(f.markup, f.n, fileSrc), block: true, side: 1 })
        .range(doc.lineAt(f.at).to))
    }
    return Decoration.set(marks, true)
  }
  return StateField.define({
    create: of,
    update: (deco, tr) => (tr.docChanged ? of(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  })
}

/** A table, drawn as one. The lines underneath are untouched — press into it
 *  and the pipes come back, which is how everything else here works. */
/** Counted when the projects or the people arrive: a chip in a table is only
 *  one once they have, so the tables are drawn again. */
let known = 0
const redrawBlocks = StateEffect.define()
class Table extends WidgetType {
  constructor(text, first) { super(); this.text = text; this.first = first; this.known = known }
  eq(other) { return other.text === this.text && other.first === this.first && other.known === this.known }
  toDOM(view) {
    // The renderer's own table, so a cell says what it says everywhere else.
    const box = document.createElement('div')
    box.innerHTML = renderToStaticMarkup(createElement(Rendered, null, this.text))
    const table = box.querySelector('table')
    if (!table) return box
    table.classList.add('nt-cm-table')
    // The row of dashes is a line of the file and not of the table.
    ;[...table.rows].forEach((row, i) => { row.dataset.line = String(this.first + (i ? i + 1 : 0)) })
    // Pressing a row puts the caret in that line of the file.
    table.addEventListener('mousedown', (e) => {
      const tr = e.target.closest?.('tr')
      if (!tr) return
      e.preventDefault()
      const line = view.state.doc.line(Number(tr.dataset.line))
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
      view.focus()
    })
    return table
  }
  ignoreEvent() { return false }
}

class Box extends WidgetType {
  constructor(done) { super(); this.done = done }
  eq(other) { return other.done === this.done }
  toDOM() {
    const b = document.createElement('span')
    b.className = `nt-cm-box${this.done ? ' on' : ''}`
    b.dataset.box = '1'
    return b
  }
  ignoreEvent() { return false }
}

/** The address a position stands in: `[말](주소)` or a bare one. */
function linkAt(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, 1)
  while (node && node.name !== 'Link' && node.name !== 'URL') node = node.parent
  if (!node) return null
  const text = state.doc.sliceString(node.from, node.to)
  if (node.name === 'URL') return /^https?:\/\//.test(text) ? text : null
  const close = text.lastIndexOf('](')
  const url = close > 0 ? text.slice(close + 2, -1).split(/\s/)[0] : ''
  return /^https?:\/\//.test(url) ? url : null
}

/** The lines any caret or selection sits in: there the text shows itself. */
const openLines = (state) => {
  const open = new Set()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n += 1) open.add(n)
  }
  return open
}

function build(view, fileSrc, numbered) {
  const nos = numbered ? headingNumbers(view.state.doc.toString()) : null
  const marks = []
  const bars = []                // the bars alone: these are what the caret skips (atomicRanges)
  const figAt = new Map(figureList(view.state.doc.toString()).map((f) => [f.at, f.n]))
  const rawAt = view.state.field(raw, false) ?? -1
  const tables = []
  // Where the code is. `#include` is not a tag and `+x` is not a project, so
  // everything this app draws ON TOP of markdown (below) asks here first.
  const code = []
  const inCode = (pos) => code.some((r) => pos >= r.from && pos < r.to)
  // A slide nobody is typing in is drawn clean: the caret left behind in it
  // must not spell its line out (slide steps take the focus away on purpose).
  const slide = !!view.dom.parentElement?.classList.contains('nt-slide')
  const away = !view.hasFocus && slide
  const open = away ? new Set() : openLines(view.state)
  const shown = (pos) => open.has(view.state.doc.lineAt(pos).number)
  const hide = (from, to) => { if (to > from) marks.push(Decoration.replace({}).range(from, to)) }

  // Asked of the whole note: one can start above the part on the screen. Line by
  // line, because a plugin may not hide a line break.
  const { doc } = view.state
  const body = doc.toString()
  const comments = commentSpans(body)
  const inComment = (pos) => comments.some(([a, b]) => pos >= a && pos < b)
  for (const [a, b] of comments) {
    const first = doc.lineAt(a).number, last = doc.lineAt(b).number
    let here = false
    for (let n = first; n <= last; n += 1) here ||= open.has(n)
    for (let n = first; n <= last; n += 1) {
      const line = doc.line(n)
      const from = Math.max(a, line.from), to = Math.min(b, line.to)
      if (here && to > from) marks.push(Decoration.mark({ class: 'nt-cm-comment' }).range(from, to))
      else if (!here) hide(from, to)
    }
  }
  for (const [a, b] of highlightSpans(body)) {
    marks.push(Decoration.mark({ class: 'nt-hl' }).range(a, b))
    if (!shown(a)) { hide(a, a + 2); hide(b - 2, b) }
  }
  for (const a of arrowSpans(body)) {
    if (!shown(a)) marks.push(Decoration.replace({ widget: new Arrow() }).range(a, a + 2))
  }

  for (const { from, to } of view.visibleRanges) {
    // ── what markdown says ────────────────────────────────────────────────
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name
        if (name === 'Table') {
          const head = view.state.doc.lineAt(node.from)
          const foot = view.state.doc.lineAt(node.to)
          // Inside it, the text is the text; outside, it is a table.
          const inside = view.state.selection.ranges.some(
            (r) => r.to >= head.from && r.from <= foot.to)
          if (!inside) {
            tables.push({ from: head.from, to: foot.to, first: head.number })
          }
          return
        }
        if (/^ATXHeading(\d)$/.test(name)) {
          const line = view.state.doc.lineAt(node.from)
          // A `#` with nothing after it is an empty heading by the spec, and
          // that is what a `#태그` looks like for the one keystroke before
          // its name arrives — so the line waits for the space that makes it
          // a heading rather than jumping to heading size and back.
          if (!/^#{1,6}[ \t]/.test(line.text)) return
          marks.push(Decoration.line({ class: `nt-cm-h${name.slice(-1)}` }).range(line.from))
          if (nos?.has(line.number)) {
            marks.push(Decoration.widget({ widget: new HeadNo(nos.get(line.number)), side: -1 })
              .range(line.from + /^#{1,6}[ \t]+/.exec(line.text)[0].length))
          }
          return
        }
        if (name === 'Blockquote') {
          for (let n = view.state.doc.lineAt(node.from).number;
            n <= view.state.doc.lineAt(node.to).number; n += 1) {
            marks.push(Decoration.line({ class: 'nt-cm-quote' }).range(view.state.doc.line(n).from))
          }
          return
        }
        // A fence is a BLOCK, and it has to say so with the caret away: every
        // line of it wears the box the other two views draw, and `return
        // false` keeps the walk out of it — the ``` were being hidden the way
        // bold hides its stars, which left a code block looking like plain
        // text with no way to tell it was one.
        if (name === 'FencedCode') {
          code.push({ from: node.from, to: node.to })
          const first = view.state.doc.lineAt(node.from).number
          const last = view.state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n += 1) {
            marks.push(Decoration.line({ class: 'nt-cm-code' }).range(view.state.doc.line(n).from))
          }
          return false
        }
        if (name === 'HorizontalRule') {
          // Drawn as a line — but not while the caret is on it, or the dashes
          // someone is typing (the start of a table's ruling, say) vanish
          // under their hands.
          if (!shown(node.from) && !inComment(node.from)) {
            marks.push(Decoration.line({ class: 'nt-cm-rule' }).range(view.state.doc.lineAt(node.from).from))
          }
          return
        }
        if (name === 'Image') return false           // a picture is the bar's (below), or stays as written
        if (name === 'InlineCode') code.push({ from: node.from, to: node.to })
        if (PAINT[name]) {
          marks.push(Decoration.mark({ class: PAINT[name] }).range(node.from, node.to))
          return
        }
        if (name === 'Link') {
          // The address rides along as the tooltip, so a link drawn as words
          // still says where it goes.
          const url = linkAt(view.state, node.from + 1)
          marks.push(Decoration.mark({
            class: 'nt-cm-link',
            attributes: url ? { title: url } : undefined,
          }).range(node.from, node.to))
          if (!shown(node.from)) {
            // `[말](주소)`: the brackets and the address go, the words stay.
            // Done here rather than by hiding every URL inside, because a link
            // whose WORDS are a url has two of them and only one is the
            // address — `[https://x/](https://x/)` showed as nothing at all.
            const text = view.state.doc.sliceString(node.from, node.to)
            const close = text.lastIndexOf('](')
            if (text.startsWith('[') && close > 0) {
              hide(node.from, node.from + 1)
              hide(node.from + close, node.to)
            }
          }
          return false
        }
        if (name === 'URL') {
          // A bare address is a link as much as `[말](주소)` is — and the one
          // people actually write. Its brackets are nobody's, so nothing hides.
          const text = view.state.doc.sliceString(node.from, node.to)
          marks.push(Decoration.mark({
            class: 'nt-cm-link', attributes: { title: text },
          }).range(node.from, node.to))
          return false
        }
        if (MARKS.has(name) && !shown(node.from)) {
          // On a slide the space after `##` or `>` would stand in front of the words.
          const lead = slide && (name === 'HeaderMark' || name === 'QuoteMark') && view.state.doc.sliceString(node.to, node.to + 1) === ' '
          hide(node.from, node.to + (lead ? 1 : 0))
        }
      },
    })

    // ── and what this app says on top of it ───────────────────────────────
    const text = view.state.doc.sliceString(from, to)
    const at = (i) => from + i

    for (const m of text.matchAll(FIGURE_RE)) {
      const start = at(m.index)
      if (inCode(start) || inComment(start) || start === rawAt) continue     // being edited by hand: the text is the text
      const n = figAt.get(start)
      const widget = n ? new Bar(m[0], n) : m[1] ? new FileLink(m[1], fileSrc) : null
      if (widget) bars.push(Decoration.replace({ widget }).range(start, start + m[0].length))
    }
    for (const m of text.matchAll(MATH)) {
      const start = at(m.index)
      // Not in code, and not while the caret is on that line — there the
      // dollars and the TeX are what you came to edit.
      if (inCode(start) || shown(start)) continue
      marks.push(Decoration.replace({ widget: new Formula(m[2], m[1] === '$$') })
        .range(start, start + m[0].length))
    }
    for (const m of text.matchAll(WIKI)) {
      if (inCode(at(m.index))) continue
      const start = at(m.index), end = start + m[0].length
      marks.push(Decoration.mark({ class: 'nt-cm-wiki' }).range(start, end))
      // A slide says what the show says, and at the width the show says it.
      if (slide && !shown(start)) { hide(start, start + 2 + m[1].lastIndexOf('|') + 1); hide(end - 2, end) }
    }
    for (const m of text.matchAll(TAG)) {
      const start = at(m.index + m[1].length)
      if (inCode(start)) continue
      marks.push(Decoration.mark({ class: 'nt-tag-in' }).range(start, start + 1 + m[2].length))
      if (!shown(start)) hide(start, start + 1)
    }
    for (const m of text.matchAll(PROJ)) {
      if (!isProject(m[2])) continue
      const start = at(m.index + m[1].length)
      if (inCode(start)) continue
      marks.push(Decoration.mark({ class: 'nt-proj-in' }).range(start, start + 1 + m[2].length))
      if (!shown(start)) hide(start, start + 1)
    }
    // A person stays the one word that is in the file — a reader sees the
    // name with its spaces (reading.jsx), but widening text under the caret
    // while it is being typed is not something an editor should do.
    for (const m of text.matchAll(AUTH)) {
      if (!isAuthor(m[2])) continue
      const start = at(m.index + m[1].length)
      if (inCode(start)) continue
      marks.push(Decoration.mark({ class: 'nt-auth-in' }).range(start, start + 1 + m[2].length))
      if (!shown(start)) hide(start, start + 1)
    }
    for (const m of text.matchAll(DATE)) {
      const start = at(m.index)
      if (inCode(start)) continue
      const due = '»📅'.includes(m[1])
      // A day that has passed on a line still open: the one date worth a colour.
      const late = due && overdue(m[2]) && !/^\s*[-*+]\s+\[[xX]\]/.test(view.state.doc.lineAt(start).text)
      const cls = `${due ? 'nt-due-in' : 'nt-done-in'}${late ? ' nt-due-late' : ''}`
      marks.push(Decoration.mark({ class: cls }).range(start, at(m.index + m[0].length)))
      if (!shown(start)) hide(start, start + m[1].length + (m[0][m[1].length] === ' ' ? 1 : 0))
    }
    // Stays as typed, and means something on a todo still open only.
    for (const m of text.matchAll(URGENT_RE)) {
      const start = at(m.index + m[1].length)
      if (inCode(start) || TASK.exec(view.state.doc.lineAt(start).text)?.[2] !== ' ') continue
      marks.push(Decoration.mark({ class: 'nt-urgent' }).range(start, start + 2))
    }
  }

  // ── and what a whole line is: a box, a step in, a row of a table ───────
  for (const { from, to } of view.visibleRanges) {
    let line = view.state.doc.lineAt(from)
    while (line.from <= to) {
      const t = TASK.exec(line.text)
      if (t) {
        const box = line.from + t[1].length
        marks.push(Decoration.replace({ widget: new Box(t[2] !== ' ') }).range(box, box + 3))
      }
      if (tables.some((t) => line.from >= t.from && line.to <= t.to)) {
        // a table drawn as one: its lines are not there to be styled
      } else if (ROW.test(line.text)) {
        marks.push(Decoration.line({ class: 'nt-cm-row' }).range(line.from))
      } else {
        const li = item(line.text)
        if (li) {
          // ALL of the item's text starts at the padding — first line and
          // wrapped lines alike — and the marker is lifted out of the flow and
          // put in that padding, which is how a real `<ul>` draws one. Hanging
          // the line by a guessed width instead (`text-indent: -2ch`) cannot
          // be right: `- ` in a proportional face is not two zeroes wide.
          marks.push(Decoration.line({
            class: li.depth > 0 ? 'nt-cm-sub' : 'nt-cm-li',
            attributes: { style: `--nt-d:${li.depth};padding-left:calc(${li.pad}px + ${li.wide}ch)` },
          }).range(line.from))
          // On a slide the marker is the one the show draws; a todo's is its box.
          const dot = slide && !shown(line.from) && /[-*+]/.test(line.text[li.at])
          marks.push(Decoration.mark({
            class: `nt-cm-mark${dot ? ` nt-cm-b${t ? 'x' : Math.min(li.depth, 2)}` : ''}`,
            attributes: { style: `left:${li.pad}px` },
          }).range(line.from + li.at, line.from + li.at + li.wide))
          // Something of the line for the caret to stand on where the words
          // begin. With the whole marker lifted out of the flow the caret had
          // nothing there and drew itself back at the bullet; a styled SPACE
          // was no better, because its own glyph still carried the caret a
          // space-width INTO the first letter. An empty widget has no glyph
          // and no width: the caret lands exactly in front of the word.
          marks.push(Decoration.widget({ widget: new Hold(), side: -1 })
            .range(line.from + li.at + li.wide))
          // The spaces that say how deep the item is are drawn too, and they
          // only push the FIRST line — which is the wrapped line sticking out
          // to the left. The step is the line's padding now, so the spaces
          // have no work left to do; nothing is lost by not drawing them.
          if (li.at) marks.push(Decoration.replace({}).range(line.from, line.from + li.at))
        }
      }
      if (line.to >= view.state.doc.length) break
      line = view.state.doc.lineAt(line.to + 1)
    }
  }

  return { marks: Decoration.set([...marks, ...bars], true), bars: Decoration.set(bars, true) }
}

/** Where the tables and the `$$` blocks are, as decorations. A block decoration
 *  may not come from a plugin (it changes how much room a line takes, which the
 *  editor has to know before it measures), so these live in a field of their own. */
function blockDecorations(state) {
  const marks = []
  const open = openLines(state)
  for (const [a, b] of mathFences(state.doc.toString())) {
    let inside = false
    for (let n = a; n <= b; n += 1) inside ||= open.has(n)
    if (inside) continue
    const { doc } = state
    marks.push(Decoration.replace({
      widget: new Formula(a + 1 < b ? doc.sliceString(doc.line(a + 1).from, doc.line(b - 1).to) : '', true, true),
      block: true,
    }).range(doc.line(a).from, doc.line(b).to))
  }
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return
      const head = state.doc.lineAt(node.from)
      const foot = state.doc.lineAt(node.to)
      const inside = state.selection.ranges.some((r) => r.to >= head.from && r.from <= foot.to)
      if (inside) return
      marks.push(Decoration.replace({
        widget: new Table(state.doc.sliceString(head.from, foot.to), head.number),
        block: true,
      }).range(head.from, foot.to))
    },
  })
  return Decoration.set(marks, true)
}

const tableBlocks = StateField.define({
  create: (state) => blockDecorations(state),
  update(deco, tr) {
    return tr.docChanged || tr.selection || tr.effects.some((e) => e.is(redrawBlocks)) ? blockDecorations(tr.state) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const paint = (fileSrc, onOpenNote, numbered) => ViewPlugin.fromClass(class {
  constructor(view) {
    this.take(build(view, fileSrc, numbered))
    // The projects come after the first paint: draw again when they do.
    const redraw = () => {
      known += 1
      setTimeout(() => { if (this.off) { this.again = true; view.dispatch({ effects: redrawBlocks.of(null) }) } })
    }
    const offProj = onProjChoices(redraw)
    const offAuth = onAuthorChoices(redraw)
    this.off = () => { offProj(); offAuth() }
  }
  take({ marks, bars }) { this.decorations = marks; this.bars = bars }
  update(u) {
    if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || this.again) {
      this.again = false
      this.take(build(u.view, fileSrc, numbered))
    }
  }
  destroy() { this.off(); this.off = null }
}, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    mousedown(e, view) {
      // A link that is drawn as a link opens when pressed — but on the line
      // the caret is in, the text is showing itself and a press is a press.
      const where = view.posAtCoords({ x: e.clientX, y: e.clientY })
      if (where != null && e.target.closest?.('.nt-cm-link')) {
        const line = view.state.doc.lineAt(where)
        // On the line being edited the text shows itself, so a press is a
        // press — unless it is held with ⌘ or ctrl, which always opens.
        const editing = view.state.selection.ranges.some(
          (r) => r.to >= line.from && r.from <= line.to)
        const url = (!editing || e.metaKey || e.ctrlKey) ? linkAt(view.state, where) : null
        if (url) {
          e.preventDefault()
          open(url)
          return true
        }
      }
      // `[[노트]]` — the other note, opened in a tab of its own.
      if (where != null && onOpenNote && e.target.closest?.('.nt-cm-wiki')) {
        const line = view.state.doc.lineAt(where)
        const editing = view.state.selection.ranges.some(
          (r) => r.to >= line.from && r.from <= line.to)
        if (editing && !e.metaKey && !e.ctrlKey) return false
        for (const m of line.text.matchAll(WIKI)) {
          const at = line.from + m.index
          if (where >= at && where <= at + m[0].length) {
            e.preventDefault()
            onOpenNote(m[1].split('|')[0].trim())
            return true
          }
        }
      }
      const box = e.target.closest?.('[data-box]')
      if (!box) return false
      e.preventDefault()
      const pos = view.posAtDOM(box)
      const line = view.state.doc.lineAt(pos)
      const t = TASK.exec(line.text)
      if (!t) return false
      const at = line.from + t[1].length + 1
      view.dispatch({ changes: { from: at, to: at + 1, insert: t[2] === ' ' ? 'x' : ' ' } })
      return true
    },
  },
})

export const livePreview = (fileSrc, onOpenNote, numbered = false) => {
  const painter = paint(fileSrc, onOpenNote, numbered)
  return [
    raw, tableBlocks, pictureBlocks(fileSrc), painter,
    // The bars are one thing each: the caret steps over them, and Backspace
    // beside one takes the whole of it.
    EditorView.atomicRanges.of((v) => v.plugin(painter)?.bars || Decoration.none),
  ]
}

/** Wrapped lines, because prose is read across the pane, not scrolled sideways. */
export const liveLook = [EditorView.lineWrapping]
