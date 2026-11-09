import './strings.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RangeSet, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, WidgetType, gutter } from '@codemirror/view'
import { Rendered } from './reading.jsx'
import { cutPages, pageTexts, ruleLines } from './marks.js'
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
  const lines = (el) => {
    const line = Number(el.dataset.line)
    if (!el.querySelector(':scope > br')) { push(line, el.getBoundingClientRect()); return }
    let k = 0, first = null, last = null
    const flush = () => {
      if (!first) return
      const r = document.createRange()
      r.setStartBefore(first)
      r.setEndAfter(last)
      push(line + k, r.getBoundingClientRect())
      first = null
    }
    for (const n of el.childNodes) {
      if (n.nodeName === 'BR') { flush(); k += 1 } else { first ??= n; last = n }
    }
    flush()
  }
  for (const el of root.children) {
    if (el.matches('ul,ol')) {
      // An item in a loose list holds its words in a <p>.
      for (const li of el.children) lines(li.children.length === 1 && li.firstElementChild.matches('p') ? li.firstElementChild : li)
    } else if (el.matches('p')) lines(el)
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
  const measure = useRef(() => {
    if (!root.current) return
    const pages = cutPages(blocksOf(root.current), room.current)
    const key = JSON.stringify(pages)
    if (key !== told.current) { told.current = key; says.current(pages) }
  }).current
  useEffect(measure, [text, h, measure])
  useEffect(() => {
    const el = root.current
    el.addEventListener('load', measure, true)
    document.fonts?.ready.then(measure)
    return () => el.removeEventListener('load', measure, true)
  }, [measure])
  return (
    <div className="nt-deck nt-deck-flow" ref={root} aria-hidden="true" style={{ '--nt-deck-h': `${h}px` }}>
      <Rendered lines>{text}</Rendered>
    </div>
  )
}

// ── in the editor ─────────────────────────────────────────────────────────
/** The top of the title slide. With a line of content under it, it is the
 *  upper half and `Fill` is what is left below that line. */
class Cover extends WidgetType {
  constructor(title, alone) { super(); this.title = title; this.alone = alone }
  eq(other) { return other.title === this.title && other.alone === this.alone }
  toDOM() {
    const box = document.createElement('div')
    box.className = `nt-deck-cover-ed${this.alone ? ' nt-deck-cover-alone' : ''}`
    const h = document.createElement('h1')
    h.textContent = this.title
    box.appendChild(h)
    return box
  }
}
/** How much empty page stands above the line into slide `i`: what the slide
 *  before it left over, and its bottom margin. The title slide fills itself. */
export const gapBefore = (pages, i) => (i > 1 ? pages[i - 1].spare + PAD_Y : 0)
const cutBox = (gap) => {
  const box = document.createElement('div')
  box.className = 'nt-deck-cut'
  box.style.setProperty('--nt-gap', gap)
  return box
}
/** Between two slides: the empty end of one, the line, the top margin of the
 *  next — so that a slide stands as tall on the screen as it is. */
class Cut extends WidgetType {
  constructor(gap) { super(); this.gap = gap }
  eq(other) { return other.gap === this.gap }
  toDOM() { return cutBox(this.gap) }
}
class Fill extends WidgetType {
  eq() { return true }
  toDOM() {
    const box = document.createElement('div')
    box.className = 'nt-deck-fill'
    return box
  }
}
const FILL = Decoration.widget({ widget: new Fill(), block: true, side: 1 })
const SUB = Decoration.line({ class: 'nt-deck-sub' })

class Num extends GutterMarker {
  constructor(n) { super(); this.n = n }
  eq(other) { return other.n === this.n }
  toDOM() { return document.createTextNode(String(this.n)) }
}

/** The dividing line, carried on across the number column. */
class Band extends GutterMarker {
  constructor(gap) { super(); this.gap = gap }
  eq(other) { return other.gap === this.gap }
  toDOM() { return cutBox(this.gap) }
}

export const setDeck = StateEffect.define()

const NONE = { deco: Decoration.none, nums: RangeSet.empty, rules: Decoration.none, atomic: Decoration.none }

const RULE = Decoration.replace({ block: true })
const WHOLE = Decoration.mark({})

/** `---` is not text on a slide: it is hidden, with the blank lines after it,
 *  and the line between two slides is what you see (`drawDeck`). Except the line the caret is
 *  on, which is where a `---` is being typed. One press of Backspace takes it
 *  all (`atomic`, which runs to the next line so the newline goes too). */
function hideRules(state) {
  const { doc } = state
  const here = doc.lineAt(state.selection.main.head).number
  const marks = [], atomic = []
  for (const n of ruleLines(doc.toString())) {
    if (n === here) continue
    let end = n
    while (end < doc.lines && !doc.line(end + 1).text.trim() && end + 1 !== here) end += 1
    const from = doc.line(n).from
    marks.push(RULE.range(from, doc.line(end).to))
    atomic.push(WHOLE.range(from, end < doc.lines ? doc.line(end + 1).from : doc.line(end).to))
  }
  return { rules: Decoration.set(marks), atomic: Decoration.set(atomic) }
}

function drawDeck(state, { pages, title }) {
  const first = pages[0]?.from > 0 && pages[0].from <= state.doc.lines ? state.doc.line(pages[0].from) : null
  const marks = [Decoration.widget({ widget: new Cover(title, !first), block: true, side: -2 }).range(0)]
  if (first) marks.push(SUB.range(first.from), FILL.range(first.to))
  const nums = []
  pages.slice(1).forEach((p, i) => {
    if (p.from > state.doc.lines) return
    const at = state.doc.line(p.from).from
    marks.push(Decoration.widget({ widget: new Cut(gapBefore(pages, i + 1)), block: true, side: -1 }).range(at))
    nums.push(new Num(i + 2).range(at))
  })
  return { deco: Decoration.set(marks, true), nums: RangeSet.of(nums, true) }
}

export const deckField = StateField.define({
  create: (state) => ({ ...NONE, ...hideRules(state) }),
  update(v, tr) {
    let next = v
    for (const e of tr.effects) if (e.is(setDeck)) next = { ...next, ...drawDeck(tr.state, e.value) }
    if (next === v && tr.docChanged) next = { ...v, deco: v.deco.map(tr.changes), nums: v.nums.map(tr.changes) }
    return tr.docChanged || tr.selection ? { ...next, ...hideRules(tr.state) } : next
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.decorations.from(f, (v) => v.rules),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
  ],
})

/** The line-number column, counting slides: a number where one starts. */
export const deckGutter = (config) => gutter({
  ...config,
  class: 'cm-lineNumbers',
  markers: (view) => view.state.field(deckField).nums,
  widgetMarker: (view, widget) => (widget instanceof Cover ? new Num(1) : widget instanceof Cut ? new Band(widget.gap) : null),
  initialSpacer: () => new Num(99),
})

// ── the show ──────────────────────────────────────────────────────────────
/** Asked for in the press itself: a browser grants full screen to a gesture,
 *  and by the time the show has been drawn the gesture is over. */
export const enterFull = () => { document.documentElement.requestFullscreen?.().catch(() => {}) }

export function SlideShow({ title, body, pages, h, start, onClose }) {
  const slides = useMemo(() => pageTexts(body, pages), [body, pages])
  const total = Math.max(slides.length, 1)
  const fit = () => Math.min(window.innerWidth / W, window.innerHeight / h)
  const [at, setAt] = useState(start)
  const [k, setK] = useState(fit)
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
    <div className="nt-show" style={{ '--nt-deck-h': `${h}px` }} onClick={() => move(-1)}
      onContextMenu={(e) => { e.preventDefault(); move(1) }}>
      <div key={at} className={`nt-deck nt-deck-page${at ? '' : ' nt-deck-cover'}`} style={page}>
        {at ? null : <h1>{title}</h1>}
        <Rendered>{slides[at] || ''}</Rendered>
        <span className="nt-deck-no">{at + 1} / {total}</span>
      </div>
      <button type="button" className="nt-show-x" aria-label={tr('nt_show_exit')} title={tr('nt_show_exit')}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onContextMenu={(e) => e.stopPropagation()}>×</button>
    </div>,
    document.body,
  )
}
