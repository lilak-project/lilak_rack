import './strings.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RangeSet, StateEffect, StateField } from '@codemirror/state'
import { BlockType, Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter } from '@codemirror/view'
import { Rendered } from './reading.jsx'
import { notePicSize, cutPages, pageTexts, ruleLines, blankHeights, figureLine, figureList, tagLine, blankComments, dropComments, keepBlanks } from './marks.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** A markdown note as slides (the `slide` mode).
 *
 *  A slide is 1000 wide, as tall as its ratio says, with its own type size. The note is cut by DRAWING it
 *  on that page, off screen, with the renderer the slide show uses, and asking
 *  where each block came out: the width of the pane plays no part, and where
 *  the editor says a slide ends is where the show ends it.
 *  Slide 1 is the note's title and the first line under it (`cutPages`).
 *
 *  The editor draws the page as the show does, fitted to the pane (`--nt-k`,
 *  SourceArea): the same words on the same lines, at whatever size that is. A
 *  pane too wide for it keeps the page in the middle and shows nothing beside it.
 */
const W = 1000, PAD_Y = 40      // note.css `.nt-deck`

/** The ratios a deck can be, the first being what a note that never chose is.
 *  `4x3` and not `4:3`: it is written in the front matter, where YAML reads
 *  4:3 as a number. */
export const RATIOS = [['4x3', '4:3', 750], ['16x9', '16:9', 562], ['1x1', '1:1', 1000]]
export const slideH = (ratio) => (RATIOS.find((r) => r[0] === ratio) || RATIOS[0])[2]

/** What was drawn, as blocks that can start a slide: a list goes item by item,
 *  and anything written over several lines goes line by line — a run of
 *  `![[…]]` lines is ONE paragraph, and straight under a list item, with no
 *  blank line between, it is part of that ITEM. */
export function blocksOf(root) {
  const base = root.getBoundingClientRect().top
  const out = []
  const push = (line, r, rule, h1) => { if (line) out.push({ line, top: r.top - base, bottom: r.bottom - base, rule, h1 }) }
  // A list item's own words, then each item of a list inside it: a top item
  // with a long list under it was ONE block, taller than a slide, and no
  // slide could start inside it — it ran off the bottom of its page.
  const nested = (n) => n.nodeType === 1 && n.matches('ul,ol')
  const lines = (el) => {
    const line = Number(el.dataset.line)
    const kids = [...el.childNodes]
    const inner = kids.filter(nested)
    if (!inner.length && !el.querySelector(':scope > br')) { push(line, el.getBoundingClientRect()); return }
    let k = 0, first = null, last = null
    const flush = () => {
      if (!first) return
      const r = document.createRange()
      r.setStartBefore(first)
      r.setEndAfter(last)
      push(line + k, r.getBoundingClientRect())
      first = null
    }
    for (const n of kids) {
      if (nested(n)) break
      if (n.nodeName === 'BR') { flush(); k += 1 } else if (n.nodeType === 1 || n.textContent.trim()) { first ??= n; last = n }
    }
    flush()
    for (const list of inner) for (const li of list.children) item(li)
  }
  // An item in a loose list holds its words in a <p>.
  const item = (li) => lines(li.children.length === 1 && li.firstElementChild.matches('p') ? li.firstElementChild : li)
  for (const el of root.children) {
    if (el.matches('ul,ol')) for (const li of el.children) item(li)
    else if (el.matches('p')) lines(el)
    else push(Number(el.dataset.line), el.getBoundingClientRect(), el.matches('hr'), el.matches('h1'))
  }
  return out
}

/** The off-screen page. Measures when the text settles, and again whenever a
 *  picture arrives or the fonts do, since both move everything under them. */
export function DeckMeasure({ body, h, onPages }) {
  const root = useRef(null)
  const told = useRef('')
  const [text, setText] = useState(body)
  useEffect(() => {
    const t = setTimeout(() => setText(body), 250)
    return () => clearTimeout(t)
  }, [body])
  const says = useRef(onPages)
  says.current = onPages
  const room = useRef(0)
  room.current = h - 2 * PAD_Y
  const drawn = useRef('')
  drawn.current = text
  const measure = useRef(() => {
    // Printing hides this page (note.css), and a picture or a font arriving
    // then would measure nothing and cut the deck into nothing.
    if (!root.current || !root.current.getBoundingClientRect().width || window.matchMedia?.('print').matches) return
    const src = dropComments(drawn.current).split('\n')
    const pages = cutPages(blocksOf(root.current).map((b) => ({ ...b, tags: tagLine(src[b.line - 1]) })), room.current)
    const key = JSON.stringify(pages)
    if (key !== told.current) { told.current = key; says.current(pages) }
  }).current
  useEffect(measure, [text, h, measure])
  useEffect(() => {
    const el = root.current
    // Every picture of the deck loads here first: its size is kept for the
    // editor, which then draws it at that size before it loads (marks.js).
    const seen = (e) => { notePicSize(e.target); measure() }
    el.addEventListener('load', seen, true)
    document.fonts?.ready.then(measure)
    return () => el.removeEventListener('load', seen, true)
  }, [measure])
  return (
    <div className="nt-deck nt-deck-flow" ref={root} aria-hidden="true" style={{ '--nt-deck-h': `${h}px` }}>
      <Rendered lines figures={0}>{keepBlanks(dropComments(text))}</Rendered>
    </div>
  )
}

// ── in the editor ─────────────────────────────────────────────────────────
/** What the title slide says under the title: the deck's own fields, never
 *  the body (cutPages). `when` is the date of the talk, not the note's. */
export const COVER = ['subtitle', 'presenter', 'when']
export const coverOf = (fields) => Object.fromEntries(COVER.map((k) => [k, String(fields?.[k] ?? '')]))

/** The title slide in the editor: the title, and the cover's fields written
 *  where they stand on the slide. A word typed goes up as `nt-cover` (App.jsx
 *  keeps it in the note's fields); the boxes are updated in place, never drawn
 *  anew, so the one being typed in keeps its caret. */
class Cover extends WidgetType {
  constructor(title, cover) { super(); this.title = title; this.cover = cover || coverOf() }
  eq(other) { return other.title === this.title && COVER.every((k) => other.cover[k] === this.cover[k]) }
  toDOM() {
    const box = document.createElement('div')
    box.className = 'nt-deck-cover-ed'
    const h = document.createElement('h1')
    box.appendChild(h)
    const field = (k, cls) => {
      const i = document.createElement('input')
      i.className = `nt-cover-in ${cls}`
      i.dataset.k = k
      i.placeholder = tr(`nt_cover_${k}`)
      i.spellcheck = false
      i.addEventListener('input', () => i.dispatchEvent(new CustomEvent('nt-cover', { bubbles: true, detail: { k, v: i.value } })))
      return i
    }
    box.appendChild(field('subtitle', 'nt-cover-sub'))
    const by = document.createElement('div')
    by.className = 'nt-cover-by'
    by.append(field('presenter', 'nt-cover-who'), field('when', 'nt-cover-when'))
    box.appendChild(by)
    this.updateDOM(box)
    return box
  }
  updateDOM(box) {
    box.querySelector('h1').textContent = this.title
    for (const i of box.querySelectorAll('input')) if (i !== document.activeElement) i.value = this.cover[i.dataset.k] || ''
    return true
  }
  ignoreEvent() { return true }
}
/** How much empty page stands above the line into slide `i`: what the slide
 *  before it left over, and its bottom margin. The title slide fills itself. */
export const gapBefore = (pages, i) => (i > 1 ? pages[i - 1].spare + PAD_Y : 0)
const cutBox = (gap, end) => {
  const box = document.createElement('div')
  box.className = end ? 'nt-deck-cut nt-deck-end' : 'nt-deck-cut'
  box.style.setProperty('--nt-gap', gap)
  return box
}
/** Between two slides: the empty end of one, the line, the top margin of the
 *  next — so that a slide stands as tall on the screen as it is. */
class Cut extends WidgetType {
  constructor(gap, end = false) { super(); this.gap = gap; this.end = end }
  eq(other) { return other.gap === this.gap && other.end === this.end }
  toDOM() { return cutBox(this.gap, this.end) }
  // Its height before it is drawn (note.css .nt-deck-cut): without it a cut off
  // the screen counts as one line, and scrolling up onto it the editor finds
  // hundreds of pixels it did not expect and moves the page to make up for them.
  get estimatedHeight() { return this.gap * deckK + 12 + (this.end ? 0 : 40 * deckK) }
}
// ponytail: one scale for every slide editor on the page; two decks side by
// side at different sizes only get a rougher guess for cuts not yet drawn.
let deckK = 1
export const setDeckScale = (k) => { deckK = k }

class Num extends GutterMarker {
  constructor(n) { super(); this.n = n }
  eq(other) { return other.n === this.n }
  toDOM() { return document.createTextNode(String(this.n)) }
}

/** The dividing line, carried on across the number column. */
class Band extends GutterMarker {
  constructor(gap, end = false) { super(); this.gap = gap; this.end = end }
  eq(other) { return other.gap === this.gap && other.end === this.end }
  toDOM() { return cutBox(this.gap, this.end) }
}

export const setDeck = StateEffect.define()
/** The white under each slide as this editor needs it (`deckFit`), by the
 *  number of the slide after it — as `gapBefore` numbers them. */
const setGaps = StateEffect.define()

const NONE = { pages: [], deco: Decoration.none, nums: RangeSet.empty, rules: Decoration.none, atomic: Decoration.none }

const RULE = Decoration.replace({ block: true })
const WHOLE = Decoration.mark({})

/** `---` is not text on a slide: it is hidden, with the blank lines after it,
 *  and the line between two slides is what you see (`drawDeck`). Except the line the caret is
 *  on, which is where a `---` is being typed. One press of Backspace takes it
 *  all (`atomic`, which runs to the next line so the newline goes too). */
function hideRules(state) {
  const { doc } = state
  const here = state.readOnly ? -1 : doc.lineAt(state.selection.main.head).number   // locked: nothing is being typed
  const marks = [], atomic = []
  for (const n of ruleLines(blankComments(doc.toString()))) {
    if (n === here) continue
    let end = n
    while (end < doc.lines && !doc.line(end + 1).text.trim() && end + 1 !== here) end += 1
    const from = doc.line(n).from
    marks.push(RULE.range(from, doc.line(end).to))
    atomic.push(WHOLE.range(from, end < doc.lines ? doc.line(end + 1).from : doc.line(end).to))
  }
  return { rules: Decoration.set(marks), atomic: Decoration.set(atomic) }
}

const SPACE = {
  gap: Decoration.line({ class: 'nt-deck-gap' }),
  none: Decoration.line({ class: 'nt-deck-none' }),
  idle: Decoration.line({ class: 'nt-deck-idle' }),
  top: Decoration.line({ class: 'nt-deck-top' }),
  fig: Decoration.line({ class: 'nt-deck-figline' }),
}
/** The editor's lines given the heights the renderer gives them, because the
 *  white under a slide is worked out from the renderer: a line that takes more
 *  or less here makes that slide a different height from the rest. */
function spaceLines(state, pages) {
  const { doc } = state
  const lines = blankComments(doc.toString()).split('\n')
  const starts = new Set(pages.slice(1).map((p) => p.from))
  const marks = []
  for (const [n, kind] of blankHeights(lines, state.readOnly ? -1 : doc.lineAt(state.selection.main.head).number, starts, pages.length > 0)) {
    marks.push(SPACE[kind].range(doc.line(n).from))
  }
  for (const n of starts) if (n <= doc.lines) marks.push(SPACE.top.range(doc.line(n).from))
  lines.forEach((t, i) => { if (figureLine(t)) marks.push(SPACE.fig.range(doc.line(i + 1).from)) })
  return Decoration.set(marks, true)
}

function drawDeck(state, { pages, title, cover }, gaps) {
  const gap = (i) => gaps?.[i] ?? gapBefore(pages, i)
  const marks = [Decoration.widget({ widget: new Cover(title, cover), block: true, side: -2 }).range(0)]
  const nums = []
  pages.slice(1).forEach((p, i) => {
    if (p.from > state.doc.lines) return
    const at = state.doc.line(p.from).from
    marks.push(Decoration.widget({ widget: new Cut(gap(i + 1)), block: true, side: -1 }).range(at))
    nums.push(new Num(i + 2).range(at))
  })
  // The last slide ends as the others do: its empty rest and the band — and
  // nothing after it, no next slide's top margin: the note ends on the band.
  if (pages.length > 1) marks.push(Decoration.widget({ widget: new Cut(gap(pages.length), true), block: true, side: 1 }).range(state.doc.length))
  return { pages, deco: Decoration.set(marks, true), nums: RangeSet.of(nums, true) }
}

/** Line `n` of the note before `tr`, numbered as after it (its start, or with
 *  `end` its end, followed through the change). Past the end it moves by as
 *  many lines as the note grew. */
function lineAfter(tr, n, end) {
  const a = tr.startState.doc, b = tr.state.doc
  if (n > a.lines) return n + b.lines - a.lines
  const l = a.line(n)
  return b.lineAt(tr.changes.mapPos(end ? l.to : l.from, 1)).number
}

export const deckField = StateField.define({
  create: (state) => ({ ...NONE, ...hideRules(state), space: spaceLines(state, []) }),
  update(v, tr) {
    let next = v
    for (const e of tr.effects) {
      // Cut somewhere else: the measured whites were for the old slides.
      // Cut where it was (a word typed): they still hold until measured again.
      if (e.is(setDeck)) {
        const was = next.deckIn?.pages || []
        const same = next.deckIn?.h === e.value.h && was.length === e.value.pages.length
          && was.every((p, i) => p.from === e.value.pages[i].from)
        const gaps = same ? next.gaps : null
        next = { ...next, deckIn: e.value, gaps, ...drawDeck(tr.state, e.value, gaps) }
      }
      if (e.is(setGaps) && next.deckIn) next = { ...next, gaps: e.value, ...drawDeck(tr.state, next.deckIn, e.value) }
    }
    // Lines typed or taken out: the slides move with their lines until the
    // renderer cuts them again, so what is measured, and where the cuts are
    // drawn, is not a line off in the meantime — and, cut where they were,
    // the measured whites are kept.
    if (next === v && tr.docChanged) {
      next = v.deckIn
        ? { ...v, deckIn: { ...v.deckIn, pages: v.deckIn.pages.map((p) => ({ ...p, from: lineAfter(tr, p.from), to: lineAfter(tr, p.to, true) })) } }
        : { ...v, deco: v.deco.map(tr.changes), nums: v.nums.map(tr.changes) }
      if (v.deckIn) next = { ...next, ...drawDeck(tr.state, next.deckIn, next.gaps) }
    }
    return next !== v || tr.docChanged || tr.selection
      ? { ...next, ...hideRules(tr.state), space: spaceLines(tr.state, next.pages) } : next
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.decorations.from(f, (v) => v.rules),
    EditorView.decorations.from(f, (v) => v.space),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
  ],
})

/** Each slide as tall as a slide, measured here. The white under a slide was
 *  worked out from the renderer's page, which this editor's lines match only
 *  nearly — and less nearly in Safari, where a slide of text came out shorter
 *  than one with a picture. So, for every slide that is drawn, its lines are
 *  measured as they stand and the white under it made up to the slide's height.
 *  A slide not drawn yet keeps the renderer's figure until it is. Where the
 *  slides are CUT is still the renderer's: that is where the show cuts them. */
const textTop = (b) => (Array.isArray(b.type) ? (b.type.find((x) => x.type === BlockType.Text) || b).top : b.top)
const textBottom = (b) => (Array.isArray(b.type)
  ? Math.max(...b.type.filter((x) => !(x.widget instanceof Cut)).map((x) => x.bottom)) : b.bottom)
export const deckFit = ViewPlugin.fromClass(class {
  constructor(view) { this.ask(view) }
  update(u) {
    // The caret moving on lets the slide it was in be measured again
    // (measureGaps leaves that one alone).
    if (u.geometryChanged || u.heightChanged || u.viewportChanged || u.selectionSet
      || u.transactions.some((t) => t.effects.some((e) => e.is(setDeck)))) this.ask(u.view)
  }
  ask(view) {
    view.requestMeasure({
      key: this,
      read: (v) => measureGaps(v),
      // After this update, not in it: CodeMirror refuses a dispatch mid-update.
      write: (gaps, v) => { if (gaps) setTimeout(() => { if (v.dom.isConnected) v.dispatch({ effects: setGaps.of(gaps) }) }, 0) },
    })
  }
})
function measureGaps(view) {
  const f = view.state.field(deckField, false)
  const { pages, h } = f?.deckIn || {}
  if (!h || !pages || pages.length < 2) return null
  // A picture still on its way is 0px tall: measured now, its slide comes out
  // short, then long again when it lands — on every scroll past it. Wait.
  if ([...view.contentDOM.querySelectorAll('img')].some((i) => !i.complete)) return null
  const k = parseFloat(view.dom.parentElement?.style.getPropertyValue('--nt-k')) || 1
  const { doc } = view.state
  const { from, to } = view.viewport
  const gaps = { ...(f.gaps || {}) }
  let changed = false
  // The slides the selection is in are left as they were: its lines show their
  // markup (and its blank lines, its `---`), which can wrap a line once more or
  // once less — and the white under the slide redone a moment later shook the
  // screen at every click. Focus or not: with the focus on a button the caret's
  // slide is drawn half open, and measured so it froze one line short.
  const sel = view.state.selection.ranges.map((r) => [doc.lineAt(r.from).number, doc.lineAt(r.to).number])
  for (let j = 1; j < pages.length; j++) {
    const a = pages[j].from, b = Math.min(pages[j].to, doc.lines)
    if (a > doc.lines || b < a) continue
    if (sel.some(([x, y]) => x <= b && y >= a)) continue
    const la = doc.line(a), lb = doc.line(b)
    if (la.from < from || lb.to > to) continue
    const used = (textBottom(view.lineBlockAt(lb.from)) - textTop(view.lineBlockAt(la.from))) / k
    const g = PAD_Y + Math.max(0, h - 2 * PAD_Y - used)
    // A pixel or two is a font's rounding, not a slide out of true: moving
    // everything under it for that is what made scrolling stutter.
    if (Math.abs((gaps[j + 1] ?? gapBefore(pages, j + 1)) - g) > 2) { gaps[j + 1] = g; changed = true }
  }
  return changed ? gaps : null
}

/** The line-number column, counting slides: a number where one starts. */
export const deckGutter = (config) => gutter({
  ...config,
  class: 'cm-lineNumbers',
  markers: (view) => view.state.field(deckField).nums,
  widgetMarker: (view, widget) => (widget instanceof Cover ? new Num(1) : widget instanceof Cut ? new Band(widget.gap, widget.end) : null),
  initialSpacer: () => new Num(99),
})

// ── the show ──────────────────────────────────────────────────────────────
/** Asked for in the press itself: a browser grants full screen to a gesture,
 *  and by the time the show has been drawn the gesture is over. */
export const enterFull = () => { document.documentElement.requestFullscreen?.().catch(() => {}) }

/** The title slide's words under the title, as the show and the paper draw them. */
function CoverText({ cover }) {
  const by = [cover?.presenter, cover?.when].filter(Boolean).join(' · ')
  return (<>
    {cover?.subtitle ? <p className="nt-cover-sub">{cover.subtitle}</p> : null}
    {by ? <p className="nt-cover-by">{by}</p> : null}
  </>)
}

export function SlideShow({ title, cover, body, pages, h, start, onClose }) {
  const slides = useMemo(() => pageTexts(keepBlanks(dropComments(body)), pages), [body, pages])
  const total = Math.max(slides.length, 1)
  const fit = () => Math.min(window.innerWidth / W, window.innerHeight / h)
  const [at, setAt] = useState(start)
  const [k, setK] = useState(fit)
  const before = useMemo(() => figureList(body).filter((f) => f.line < (pages[at]?.from ?? 0)).length, [body, pages, at])
  const last = useRef(0)
  last.current = total - 1
  const move = (by) => setAt((n) => Math.max(0, Math.min(last.current, n + by)))
  const shut = useRef(onClose)
  shut.current = onClose
  useEffect(() => {
    // Capture, and stopped there: the editor under the show still has focus.
    const key = (e) => {
      const by = { ArrowLeft: -1, ArrowRight: 1, ' ': 1 }[e.key]
      if (e.key === 'Escape') shut.current()
      else if (by) move(by)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    const size = () => setK(fit())
    // Esc in full screen is the browser's own and may never reach `key`.
    let full = !!document.fullscreenElement
    const changed = () => {
      if (document.fullscreenElement) full = true
      else if (full) shut.current()
    }
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', size)
    document.addEventListener('fullscreenchange', changed)
    return () => {
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', size)
      document.removeEventListener('fullscreenchange', changed)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [])
  const page = { transform: `translate(-50%, -50%) scale(${k})` }
  return createPortal(
    <div className="nt-show" style={{ '--nt-deck-h': `${h}px` }} onClick={(e) => { if (!e.target.closest('a')) move(-1) }}
      onContextMenu={(e) => { e.preventDefault(); move(1) }}>
      <div key={at} className={`nt-deck nt-deck-page${at ? '' : ' nt-deck-cover'}`} style={page}>
        {at ? null : <><h1>{title}</h1><CoverText cover={cover} /></>}
        {at ? <Rendered figures={before}>{slides[at] || ''}</Rendered> : null}
        <span className="nt-deck-no">{at + 1} / {total}</span>
      </div>
      <button type="button" className="nt-show-x" aria-label={tr('nt_show_exit')} title={tr('nt_show_exit')}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onContextMenu={(e) => e.stopPropagation()}>×</button>
    </div>,
    document.body,
  )
}

// ── on paper ──────────────────────────────────────────────────────────────
/** The deck for the print page: cut exactly as the show cuts it, one slide to
 *  a sheet of paper the slide's own size (`size` below, in the page's px, so
 *  the PDF is the show and not an A4 with a picture of it). */
export function SlidePrint({ title, cover, body, ratio, only }) {
  const h = slideH(ratio)
  const [pages, setPages] = useState(null)
  const slides = useMemo(() => (pages ? pageTexts(keepBlanks(dropComments(body)), pages) : []), [body, pages])
  const figs = useMemo(() => figureList(body), [body])
  const name = `nt-deck-${(RATIOS.find((r) => r[0] === ratio) || RATIOS[0])[0]}`
  return (
    <section className="nt-deck-print" style={{ '--nt-deck-h': `${h}px`, page: name }}>
      {/* Named for a print that mixes notes; Safari knows no named pages and
          takes the plain `@page` alone, so a print of decks alone sets that too. */}
      <style>{`@page ${name} { size: ${W}px ${h}px; margin: 0; }${only ? ` @page { size: ${W}px ${h}px; margin: 0; }` : ''}`}</style>
      <DeckMeasure body={body} h={h} onPages={setPages} />
      {slides.map((text, at) => (
        <div key={at} className={`nt-deck nt-deck-sheet${at ? '' : ' nt-deck-cover'}`}>
          {at ? null : <><h1>{title}</h1><CoverText cover={cover} /></>}
          {at ? <Rendered figures={figs.filter((f) => f.line < (pages[at]?.from ?? 0)).length}>{text}</Rendered> : null}
          <span className="nt-deck-no">{at + 1} / {slides.length}</span>
        </div>
      ))}
    </section>
  )
}
