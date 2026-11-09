import { EditorView, Decoration, WidgetType } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { autocompletion, completionStatus, CompletionContext, pickedCompletion, startCompletion } from '@codemirror/autocomplete'
import { keymap } from '@codemirror/view'
import { authorsFor, choicesFor, citesFor, projectsFor, projText } from './marks.js'

/** What typing does in the source editor.
 *
 *  The three things the other editor learned and this one needed too: a tag
 *  offered while you type `#`, a date put in by `>>`, and a file dropped on
 *  the page landing in the text as `![[name]]`. Each is a small extension;
 *  none of them rewrites anything the author did not type.
 */

// ── `#태그` and `+프로젝트` while you type ──────────────────────────────────
const TAG_HEAD = /(?:^|[\s(])#[^\s#.,;:!?()[\]{}'"]*$/
const PROJ_HEAD = /(?:^|[\s(])\+[^\s#+.,;:!?()[\]{}'"]*$/
const AUTH_HEAD = /(?:^|[\s(])@[^\s#+@.,;:!?()[\]{}'"]*$/

/** `#` offers its tags the moment it is typed — a `#` on its own means a tag
 *  is coming. `+` waits for one letter: a plus between two numbers is a plus,
 *  and a menu open over it would take the next Enter for a choice.
 */
/** A parent chosen: it goes in, and the menu opens again on what is inside. */
const deeper = (view, c, from, to) => {
  view.dispatch({ changes: { from, to, insert: c.label }, selection: { anchor: from + c.label.length },
    annotations: pickedCompletion.of(c) })
  startCompletion(view)
}
const names = (ctx, head, mark, pick, atOnce, write = (t) => t) => {
  const before = ctx.matchBefore(head)
  if (!before) return null
  const where = before.text.indexOf(mark)
  const typed = before.text.slice(where + 1)
  if (!typed && !atOnce && !ctx.explicit) return null
  const options = pick(typed).map((label) => ({ label, apply: label.endsWith('/') ? deeper : write(label), type: 'keyword' }))
  // No `validFor`: the list is cut to eight and changes level at a `/`, so it
  // is asked for again at each letter rather than narrowed.
  return options.length ? { from: before.from + where + 1, options } : null
}

/** `@` offers people the moment it is typed, as `#` does: an address cannot
 *  start a mention — the `@` of kim@jinr.ru has a letter in front of it — so
 *  there is nothing to wait for the way `+` waits past a plus sign.
 *
 *  A row shows the name as it is written, the name in the other script and the
 *  address; what goes IN is the name run together (`@JungWooLee`). The rows are
 *  already the right ones in the right order (authorsFor), so the library is
 *  told not to filter them again: `jungwoo` is not a prefix of "Jung Woo Lee"
 *  by any matcher but ours. */
const people = (ctx) => {
  const before = ctx.matchBefore(AUTH_HEAD)
  if (!before) return null
  const where = before.text.indexOf('@')
  const options = authorsFor(before.text.slice(where + 1)).map((x) => ({
    label: x.show, apply: x.text, type: 'keyword',
    detail: [x.other, x.email].filter(Boolean).join(' · '),
  }))
  // `update`: the next letter narrows this list in place, synchronously —
  // asked again as a query, the list is gone while the question is out, and
  // under an IME a composition can end before it comes back.
  return options.length ? { from: before.from + where + 1, options, filter: false, update: (_c, _f, _t, c) => people(c) } : null
}

/** Safari with the Korean IME: every composed syllable is followed by a
 *  selection-only transaction (`select`, no change), which the library reads
 *  as the caret having moved and closes the menu on — before its question
 *  for the syllable was asked. So `@다영` showed nobody. Asked again right
 *  after that transaction, the menu is back with the syllable in it. */
const imeKeep = EditorView.updateListener.of((u) => {
  if (!u.view.composing || completionStatus(u.state) || !completionStatus(u.startState)) return
  if (u.transactions.some((tr) => !tr.docChanged && tr.isUserEvent('select'))) setTimeout(() => startCompletion(u.view), 0)
})

const SOURCES = [
  (ctx) => names(ctx, TAG_HEAD, '#', choicesFor, true),
  // a project is offered by its name and written as one word (projText)
  (ctx) => names(ctx, PROJ_HEAD, '+', projectsFor, false, projText),
  people,
]

/** Enter on a syllable still being composed: Safari spends the key on
 *  finishing the syllable, CodeMirror lets that keydown go by (its own Safari
 *  note), and the menu that was open gets a line break instead of a choice.
 *  The break arrives here as a beforeinput — only in that case; a plain Enter
 *  is a keydown the keymaps take — and the first row goes in for it, asked of
 *  the sources directly, since the library's list is being rebuilt just then. */
const imeEnter = EditorView.domEventHandlers({
  beforeinput(e, view) {
    if (!/^insert(LineBreak|Paragraph)$/.test(e.inputType)) return false
    const pos = view.state.selection.main.head
    const ctx = new CompletionContext(view.state, pos, false)
    for (const source of SOURCES) {
      const r = source(ctx)
      if (!r?.options.length) continue
      const c = r.options[0]
      if (typeof c.apply === 'function') c.apply(view, c, r.from, pos)
      else {
        const text = c.apply ?? c.label
        view.dispatch({ changes: { from: r.from, to: pos, insert: text }, selection: { anchor: r.from + text.length },
          annotations: pickedCompletion.of(c), userEvent: 'input.complete' })
      }
      e.preventDefault()
      return true
    }
    return false
  },
})

export const tagComplete = [autocompletion({ override: SOURCES, icons: false }), imeKeep, imeEnter]

// ── `\cite{` in a tex note ────────────────────────────────────────────────
/** `\cite{`, `\citep[see][]{`, `\textcite{` — and the keys already in there,
 *  since `\cite{a,b}` is how two papers are cited at once. */
const CITE_HEAD = /\\[a-zA-Z]*cite[a-zA-Z]*(?:\[[^\]]*\])*\{[^}]*$/

export const citeComplete = autocompletion({
  override: [(ctx) => {
    const before = ctx.matchBefore(CITE_HEAD)
    if (!before) return null
    // What is being typed is after the last separator: the `{`, or the comma
    // of the key before this one.
    const at = Math.max(before.text.lastIndexOf('{'), before.text.lastIndexOf(','))
    const typed = before.text.slice(at + 1).trimStart()
    const options = citesFor(typed).map((c) => ({
      label: c.key,
      // The bib's keys are the ones that compile; the rest say where they are.
      detail: c.bib ? c.title : `${c.title || ''} ⟨reference⟩`.trim(),
      type: c.bib ? 'keyword' : 'variable',
    }))
    return options.length
      ? { from: before.from + before.text.length - typed.length, options, validFor: /^[^,}\s]*$/ }
      : null
  }],
  icons: false,
})

// ── `>>2026-12-24 ` → `» 2026-12-24 `, and `>> ` → a calendar ──────────────
const DUE_TYPED = /(^|\s)>>(\d{4}-\d{1,2}-\d{1,2})$/
const DUE_BARE = /(^|\s)>>$/

const askDate = StateEffect.define()

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The day `by` days — or `months` months — from `at`, both ISO days.
 *
 *  A month away from the 31st is the END of a 30-day month, not the 1st of the
 *  next one: paging through the months must not walk forward on its own. */
export const moveDay = (at, by, months = 0) => {
  const [y, m, d] = at.split('-').map(Number)
  if (!months) return iso(new Date(y, m - 1, d + by))
  const last = new Date(y, m + months, 0).getDate()
  return iso(new Date(y, m - 1 + months, Math.min(d, last)))
}

class Calendar extends WidgetType {
  /** `at`…`to` is what the chosen day REPLACES — the same two numbers when
   *  there is nothing there yet (`>>` just typed) and the span of the date
   *  already written when one is being changed. */
  constructor(at, to, was) { super(); this.at = at; this.to = to; this.was = was || '' }
  eq(other) { return other.at === this.at && other.to === this.to && other.was === this.was }

  /** A month of days, drawn.
   *
   *  A `<input type="date">` stood here first and was the lazy answer, but its
   *  calendar is the BROWSER's: it opens only on a real press (`showPicker`
   *  wants a user gesture, which the keystroke that put `>>` in has already
   *  spent), and inside the portal's frame it mostly did not open at all — so
   *  what was left was a box to type eight digits into. This is the month
   *  itself: the pointer moves the day, Enter or a press takes it.
   *
   *  No month or weekday NAMES, so there is nothing here to translate: the
   *  head is the date's own spelling (`2026-11`) and the week is its initials.
   */
  toDOM(view) {
    const spot = document.createElement('span')
    spot.className = 'nt-cal-at'
    const box = document.createElement('div')
    box.className = 'nt-cal'
    box.tabIndex = 0
    spot.append(box)

    let cur = this.was || iso(new Date())
    const today = iso(new Date())
    const cells = new Map()

    const take = (day) => {
      // A date put IN brings its own spacing; one being changed keeps the
      // line's, so only the day itself moves.
      const insert = this.to > this.at ? `» ${day}` : `» ${day} `
      view.dispatch({
        changes: { from: this.at, to: this.to, insert },
        selection: { anchor: this.at + insert.length },
        effects: askDate.of(null),
      })
      view.focus()
    }
    const shut = () => { view.dispatch({ effects: askDate.of(null) }); view.focus() }

    const head = document.createElement('div')
    head.className = 'nt-cal-head'
    const label = document.createElement('b')
    const grid = document.createElement('div')
    grid.className = 'nt-cal-grid'
    const step = (text, by) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'nt-cal-step'
      b.textContent = text
      // The grid keeps the keys: a press on an arrow must not take the focus.
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => go(moveDay(cur, 0, by)))
      return b
    }
    head.append(step('‹', -1), label, step('›', 1))
    box.append(head, grid)

    const mark = () => { for (const [day, el] of cells) el.classList.toggle('on', day === cur) }
    const go = (day) => {
      const was = cur.slice(0, 7)
      cur = day
      if (day.slice(0, 7) === was) mark()
      else draw()
    }
    const draw = () => {
      const [y, m] = cur.split('-').map(Number)
      label.textContent = `${y}-${String(m).padStart(2, '0')}`
      grid.textContent = ''
      cells.clear()
      for (const d of 'SMTWTFS') {
        const wd = document.createElement('i')
        wd.className = 'nt-cal-wd'
        wd.textContent = d
        grid.append(wd)
      }
      // Six weeks always, so the box does not change height as months change.
      const first = new Date(y, m - 1, 1)
      for (let i = 0; i < 42; i += 1) {
        const d = new Date(y, m - 1, 1 - first.getDay() + i)
        const day = iso(d)
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.textContent = String(d.getDate())
        cell.className = `nt-cal-d${d.getMonth() === m - 1 ? '' : ' off'}${day === today ? ' now' : ''}`
        cell.addEventListener('mouseenter', () => { cur = day; mark() })
        cell.addEventListener('mousedown', (e) => e.preventDefault())
        cell.addEventListener('click', () => take(day))
        cells.set(day, cell)
        grid.append(cell)
      }
      mark()
    }
    draw()

    const KEYS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    box.addEventListener('keydown', (e) => {
      if (e.key in KEYS) go(moveDay(cur, KEYS[e.key]))
      else if (e.key === 'PageUp' || e.key === 'PageDown') go(moveDay(cur, 0, e.key === 'PageUp' ? -1 : 1))
      else if (e.key === 'Enter') take(cur)
      else if (e.key === 'Escape') shut()
      else return
      e.preventDefault()
      e.stopPropagation()
    })
    setTimeout(() => box.focus(), 0)
    return spot
  }
  ignoreEvent() { return true }
}

const calendar = StateField.define({
  create: () => null,
  update(spot, tr) {
    for (const e of tr.effects) if (e.is(askDate)) return e.value
    if (spot == null) return null
    return tr.docChanged ? null : spot
  },
  provide: (f) => EditorView.decorations.from(f, (spot) => (spot == null ? Decoration.none
    : Decoration.set([Decoration.widget({
      widget: new Calendar(spot.at, spot.to, spot.was), side: 1,
    }).range(spot.to)]))),
})

/** A date already written, opened by pressing it.
 *
 *  The chip IS the date's own text (`» 2026-11-05`), so there is nothing to
 *  open but the same little calendar the `>>` rule opens — pointed at the
 *  span that is already there instead of at an empty spot. */
const DUE_ON_LINE = /(»|📅|✓|✅)\s*(\d{4}-\d{1,2}-\d{1,2})/g

/** The date written at `off` in this line: where it starts, where it ends, and
 *  the day it says. `null` if the press was not on one.
 *
 *  `-11-5` is a day as much as `-11-05` is (the line is the author's), but a
 *  date input takes only the padded one. */
export const dueAt = (text, off) => {
  for (const m of String(text).matchAll(DUE_ON_LINE)) {
    if (off < m.index || off > m.index + m[0].length) continue
    return { at: m.index, to: m.index + m[0].length, was: m[2].replace(/-(\d)(?!\d)/g, '-0$1') }
  }
  return null
}

export const duePick = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey) return false
    if (!e.target?.closest?.('.nt-due-in, .nt-done-in')) return false
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos == null) return false
    const line = view.state.doc.lineAt(pos)
    const on = dueAt(line.text, pos - line.from)
    if (!on) return false
    e.preventDefault()
    view.dispatch({ effects: askDate.of({ at: line.from + on.at, to: line.from + on.to, was: on.was }) })
    return true
  },
})

/** The rule fires on the space that ends `>>…`. The space may arrive on its
 *  own (typing) or at the end of a longer insert (a paste, or a tool that
 *  types a whole string at once), so the line is read as it WILL be. */
const dueInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (!text.endsWith(' ')) return false
  const line = view.state.doc.lineAt(from)
  const before = line.text.slice(0, from - line.from) + text.slice(0, -1)
  const typed = DUE_TYPED.exec(before)
  const bare = typed ? null : DUE_BARE.exec(before)
  const m = typed || bare
  if (!m) return false
  // Where the `>>` stands: in the document, or inside this very insert — in
  // which case what the insert wrote before it is kept.
  const head = from - line.from                 // how much of the line is already written
  const mark = m.index + m[1].length            // where `>>` begins in the line-to-be
  const inside = mark >= head
  const at = inside ? from : line.from + mark
  const keep = inside ? text.slice(0, mark - head) : ''
  // The caret goes after what was written, not in front of it: a change that
  // replaces the insert itself would otherwise map it to the start.
  if (typed) {
    const insert = `${keep}» ${typed[2]} `
    view.dispatch({ changes: { from: at, to, insert }, selection: { anchor: at + insert.length } })
  } else {
    view.dispatch({
      changes: { from: at, to, insert: keep },
      selection: { anchor: at + keep.length },
      effects: askDate.of({ at: at + keep.length, to: at + keep.length }),
    })
  }
  return true
})

export const dueKeys = [calendar, dueInput, duePick]

// ── `₩코드₩` is `코드` ────────────────────────────────────────────────────
/** Where the ₩ that opens a code chip stands in the text before the caret,
 *  or -1 if this ₩ opens nothing.
 *
 *  On a Korean keyboard ₩ sits where the backslash is, and it is the easy key
 *  to reach; the backtick is not. So a pair of them becomes the pair of
 *  backticks the FILE keeps — nothing here invents a second spelling of
 *  markdown, the text is converted as it is typed and what is saved is
 *  ordinary `code`.
 *
 *  Money is the one thing a lone ₩ is for, so ₩5,000 never opens a chip. */
export const wonPair = (before) => {
  const i = before.lastIndexOf('₩')
  if (i < 0) return -1
  const inner = before.slice(i + 1)
  if (!inner.trim()) return -1            // `₩₩` has nothing in it
  if (/^[\d,.]/.test(inner)) return -1   // ₩5,000 — a price, not a chip
  return i
}

/** The second ₩ turns both into backticks, in ONE change so one undo is one
 *  undo (and a second undo gives the ₩ back). */
export const wonCode = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '₩') return false
  const line = view.state.doc.lineAt(from)
  const i = wonPair(line.text.slice(0, from - line.from))
  if (i < 0) return false
  const at = line.from + i
  view.dispatch({
    changes: [{ from: at, to: at + 1, insert: '`' }, { from, to, insert: '`' }],
    selection: { anchor: from + 1 },
    userEvent: 'input.type',
  })
  return true
})

// ── `- [ ] ` is one thing, so it goes in one press ────────────────────────
/** What a list line starts with before its words: the indent, the bullet or
 *  the number, and a task's box. `- `, `  * `, `1. `, `- [ ] `. */
const LEAD_IN = /^(\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/
export const leadIn = (text) => (LEAD_IN.exec(text) || ['', ''])[1]

/** Backspace at the first word of a list item takes the whole marker.
 *
 *  To the eye `- [ ] ` is one thing — a box — not six characters, and five
 *  presses to get out of a list nobody meant to start is five presses of
 *  watching it come apart into `- [ ]`, `- [ `, `- [`. One press, one thing.
 *  Anywhere else on the line Backspace is Backspace. */
export const listKeys = keymap.of([{
  key: 'Backspace',
  run: (view) => {
    const r = view.state.selection.main
    if (!r.empty) return false
    const line = view.state.doc.lineAt(r.head)
    const lead = leadIn(line.text)
    if (!lead || r.head !== line.from + lead.length) return false
    view.dispatch({ changes: { from: line.from, to: r.head }, userEvent: 'delete.backward' })
    return true
  },
}])

// ── 한글: the syllable being typed comes apart one jamo at a time ──────────
/** Backspace on 한 gives 하, then ㅎ, then nothing — but only on the syllable
 *  still being written. The ones before it go whole, as a character does.
 *
 *  That is the IME's own doing, and while a composition is alive the browser
 *  already does it. It is not alive for long in here: every keystroke
 *  recomputes what is drawn over the text, and a composition that has had its
 *  text node redrawn is a composition the system has let go of — so the
 *  syllable went whole, as if it had been typed minutes ago.
 *
 *  Rather than fight the drawing, the editor remembers which spot the last
 *  typing left the caret at and takes the syllable apart itself when
 *  Backspace lands there. Press anywhere else, or move the caret first, and
 *  this does nothing at all.
 */
const LEAD = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const MEDIAL = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
// Index 0 is "no final consonant"; the `_` is never read.
const TAIL = '_ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'
/** A jamo that took two keys, and the key that came first: 과 is ㄱㅗㅏ, so
 *  what is left of it is 고 — not 그. */
const PART = {
  ㅘ: 'ㅗ', ㅙ: 'ㅗ', ㅚ: 'ㅗ', ㅝ: 'ㅜ', ㅞ: 'ㅜ', ㅟ: 'ㅜ', ㅢ: 'ㅡ',
  ㄳ: 'ㄱ', ㄵ: 'ㄴ', ㄶ: 'ㄴ', ㄺ: 'ㄹ', ㄻ: 'ㄹ', ㄼ: 'ㄹ', ㄽ: 'ㄹ', ㄾ: 'ㄹ', ㄿ: 'ㄹ', ㅀ: 'ㄹ', ㅄ: 'ㅂ',
}

/** `ch` with its last jamo taken off, or `null` when there is nothing to take
 *  off and the character should simply go. */
export const backJamo = (ch) => {
  const n = ch.charCodeAt(0) - 0xac00
  if (n < 0 || n > 11171) return PART[ch] || null
  const tail = n % 28
  const mid = Math.floor(n / 28) % 21
  const lead = Math.floor(n / 28 / 21)
  if (tail) {
    const part = PART[TAIL[tail]]
    return String.fromCharCode(0xac00 + (lead * 21 + mid) * 28 + (part ? TAIL.indexOf(part) : 0))
  }
  const part = PART[MEDIAL[mid]]
  if (part) return String.fromCharCode(0xac00 + (lead * 21 + MEDIAL.indexOf(part)) * 28)
  return LEAD[lead]
}

/** Where the last typing left the caret, or -1. Moving the caret, or any
 *  change that is not typing, puts it back to -1: the syllable stops being
 *  the one in hand the moment you look away from it. */
const typing = StateField.define({
  create: () => -1,
  update(at, tr) {
    if (!tr.docChanged) return tr.selection ? -1 : at
    return tr.isUserEvent('input.type') || tr.isUserEvent('delete.jamo')
      ? tr.state.selection.main.head : -1
  },
})

/** A keydown handler rather than a key binding, because the one thing this
 *  must know is whether the press belongs to the IME — and only the EVENT
 *  says so (`isComposing`; Chrome also sends it as key code 229).
 *
 *  While a composition is alive the system takes the syllable apart itself,
 *  and a second hand doing the same thing took two jamo off at once: 떻 went
 *  to ㄸ, 떠 vanished whole. So this does nothing at all until the composition
 *  is over, and then only for the syllable the caret was just left on.
 *  `compositionStarted`, not `composing`: the latter is still false until the
 *  first composed change has been applied, which is one keystroke too late. */
export const jamoBack = EditorView.domEventHandlers({
  keydown(e, view) {
    if (e.key !== 'Backspace' || e.isComposing || e.keyCode === 229) return false
    if (view.compositionStarted) return false
    const r = view.state.selection.main
    if (!r.empty || !r.head || view.state.field(typing) !== r.head) return false
    const left = backJamo(view.state.sliceDoc(r.head - 1, r.head))
    if (left == null) return false
    view.dispatch({
      changes: { from: r.head - 1, to: r.head, insert: left },
      selection: { anchor: r.head - 1 + left.length },
      // `delete.*` so one undo takes the syllable back whole.
      userEvent: 'delete.jamo',
      scrollIntoView: true,
    })
    e.preventDefault()
    return true
  },
})

export const jamoKeys = [typing, jamoBack]

// ── a file dropped or pasted lands in the text ──────────────────────────────
const filesOf = (dt) => (dt ? [...(dt.files || [])] : [])

/** What a file that just arrived looks like in the text.
 *
 *  A markdown note embeds it the way Obsidian does. A tex note cannot: a
 *  `![[img/fig1.png]]` means nothing at all to a compiler, so what goes in is
 *  the LaTeX for the kind of file it is — and `img/`, `section/`, `style/` is
 *  where the backend just put it (`TEX_DIRS`). A style or a class belongs in
 *  the preamble, not where the caret is, so that one goes in commented: the
 *  line to move up, rather than a line that breaks the build. */
export const dropped = (name, tex) => {
  if (!tex) return `![[${name}]]\n`
  const ext = (name.match(/\.[^./]+$/) || [''])[0].toLowerCase()
  const bare = name.replace(/\.[^./]+$/, '')
  if (ext === '.tex') return `\\input{${bare}}\n`
  if (ext === '.bib') return `\\bibliography{${bare}}\n`
  if (['.sty', '.cls', '.bst'].includes(ext)) return `% \\usepackage{${bare}}\n`
  return `\\includegraphics[width=\\linewidth]{${name}}\n`
}

/** A file being dragged over, as opposed to text being dragged within.
 *  `types` is all a dragover is allowed to see — the files themselves are not
 *  readable until the drop. */
const dragsFiles = (dt) => !!dt && [...(dt.types || [])].includes('Files')

/** A text file, read into the note instead of stored beside it.
 *
 *  Many of these have no media type at all from the file system (`.tex`,
 *  `.bib`, `.py`), so the name has to answer for them. Anything not named
 *  here is stored and pointed at, which is what dropping a file has always
 *  done — this is the narrow case, not the new default. */
const TEXT_EXT = /\.(txt|md|markdown|tex|bib|cls|sty|bst|csv|tsv|json|ya?ml|toml|ini|cfg|conf|log|py|c|h|cc|cpp|hpp|js|jsx|ts|tsx|sh|zsh|r|m|f|f90|gp|html?|css|xml|srt|patch|diff)$/i
/** 1MB of text is already a very long note; past that it is a file, and a
 *  browser asked to put a 200MB log in a document simply stops. */
const TEXT_MAX = 1 << 20
export const isText = (file) => !!file && file.size <= TEXT_MAX
  && ((file.type || '').startsWith('text/') || TEXT_EXT.test(file.name || ''))

/** `upload(file)` stores it and answers with the path it was given.
 *
 *  `raw` is 원문: there the note IS its source, so a text file dropped in is
 *  its TEXT — nothing is stored and nothing is linked, the file's lines land
 *  where the drop cursor is. In 라이브 (and for a picture either way) the file
 *  is stored beside the notes and the document points at it, as before. */
export const takeFiles = (upload, tex = false, raw = false) => EditorView.domEventHandlers({
  // Saying yes to the drag is what makes the drop arrive at all, and the
  // class is the editor saying it will take it. `false` all the way: the
  // drop cursor (`dropCursor`) wants these same events, to draw the line
  // where the file would land.
  dragover(e, view) {
    if (!upload || !dragsFiles(e.dataTransfer)) return false
    e.preventDefault()
    view.dom.classList.add('nt-dropping')
    return false
  },
  dragleave(e, view) {
    // Moving between the lines of the editor leaves a child, not the editor.
    if (!view.dom.contains(e.relatedTarget)) view.dom.classList.remove('nt-dropping')
    return false
  },
  dragend(e, view) { view.dom.classList.remove('nt-dropping'); return false },
  drop(e, view) {
    view.dom.classList.remove('nt-dropping')
    const files = filesOf(e.dataTransfer)
    if (!upload || !files.length) return false
    e.preventDefault()
    const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.doc.length
    stow(view, at, files, upload, tex, raw)
    return true
  },
  paste(e, view) {
    const files = filesOf(e.clipboardData)
    if (!upload || !files.length) return false
    e.preventDefault()
    stow(view, view.state.selection.main.from, files, upload, tex, raw)
    return true
  },
})

async function stow(view, at, files, upload, tex, raw) {
  for (const file of files) {
    let text
    if (raw && isText(file)) {
      const had = await file.text()
      text = had.endsWith('\n') ? had : `${had}\n`
    } else {
      const name = await upload(file)
      if (!name) continue
      text = dropped(name, tex)
    }
    view.dispatch({ changes: { from: at, insert: text } })
    at += text.length
  }
}

// ── a table, without counting pipes ────────────────────────────────────────
// ── `**bold**` ────────────────────────────────────────────────────────────
/** Put `before`/`after` round the selection and keep it selected, so pressing
 *  the key twice reads as taking the marks off rather than nesting them. The
 *  tool's `edit.wrap` and the keys below are the same thing by design. */
export const wrapSel = (view, before, after = before) => {
  const r = view.state.selection.main
  const had = view.state.sliceDoc(r.from, r.to)
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: before + had + after },
    selection: { anchor: r.from + before.length, head: r.from + before.length + had.length },
  })
  return true
}

/** What every editor binds: ⌘B and ⌘I. Markdown's own keymap does not. */
export const markKeys = keymap.of([
  { key: 'Mod-b', run: (v) => wrapSel(v, '**') },
  { key: 'Mod-i', run: (v) => wrapSel(v, '*') },
])

// ── pasting into a quote ──────────────────────────────────────────────────
/** The quote mark the caret's line wears: `> `, `>> `, and its indent. */
const QUOTE = /^\s*((?:>\s?)+)/

/** Text pasted into a quote is quoted.
 *
 *  A BLANK line ends a blockquote, so pasting two paragraphs under a `>` fell
 *  out of it half way down — which is the thing `>>>` is invented elsewhere to
 *  work around. Here every pasted line simply gets the mark the caret's line
 *  already has, and an empty line gets it without its trailing space, so the
 *  block stays whole and the file stays ordinary markdown.
 *
 *  Only when the caret IS in a quote, and only for a paste with more than one
 *  line in it: a word pasted into a sentence is a word.
 */
export const quotePaste = EditorView.clipboardInputFilter.of((text, state) => {
  const mark = QUOTE.exec(state.doc.lineAt(state.selection.main.from).text)
  if (!mark || !text.includes('\n')) return text
  return text.split('\n')
    .map((line, i) => (i === 0 ? line : line.trim() ? mark[1] + line : mark[1].trimEnd()))
    .join('\n')
})

/** `||` and a space makes a table of as many columns as there were pipes: the
 *  header, its ruling and one row, with the caret in the first cell. */
const TABLE_NEW = /(^[ \t]*)(\|{2,})$/

export const tableInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ' ') return false
  const line = view.state.doc.lineAt(from)
  const m = TABLE_NEW.exec(line.text.slice(0, from - line.from))
  if (!m) return false
  const cols = m[2].length
  const row = `|${'   |'.repeat(cols)}`
  const rule = `|${' --- |'.repeat(cols)}`
  const text2 = `${row}\n${rule}\n${row}`
  view.dispatch({
    changes: { from: line.from + m[1].length, to, insert: text2 },
    selection: { anchor: line.from + m[1].length + 2 },
  })
  return true
})

/** Where the cells of a row begin and end. A `\|` is a pipe, not a wall. */
const wallsOf = (text) => {
  const at = []
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '|' && text[i - 1] !== '\\') at.push(i)
  }
  return at
}

const inTable = (state, pos) => {
  const line = state.doc.lineAt(pos)
  if (!/^\s*\|/.test(line.text)) return null
  return line
}

/** The cell after this position, or the row below, or a row that did not
 *  exist a moment ago. */
function step(view, back) {
  const { state } = view
  const pos = state.selection.main.head
  const line = inTable(state, pos)
  if (!line) return false
  const walls = wallsOf(line.text)
  const here = pos - line.from
  const next = back ? [...walls].reverse().find((w) => w < here - 1) : walls.find((w) => w >= here)
  if (next !== undefined && (back || next < line.text.length - 1)) {
    const cell = back
      ? line.from + (walls[walls.indexOf(next) - 1] ?? -1) + 2
      : line.from + next + 2
    view.dispatch({ selection: { anchor: Math.min(cell, line.to) }, scrollIntoView: true })
    return true
  }
  // Out of cells: the next row, or a new one at the end of the table. The row
  // of dashes is the ruling, not a row anyone types in.
  const RULING = /^\s*\|[\s:|-]*$/
  let n = line.number + (back ? -1 : 1)
  let sibling = n >= 1 && n <= state.doc.lines ? state.doc.line(n) : null
  if (sibling && RULING.test(sibling.text)) {
    n += back ? -1 : 1
    sibling = n >= 1 && n <= state.doc.lines ? state.doc.line(n) : null
  }
  if (sibling && /^\s*\|/.test(sibling.text)) {
    view.dispatch({ selection: { anchor: sibling.from + 2 }, scrollIntoView: true })
    return true
  }
  if (back) return true
  const row = `\n|${'   |'.repeat(Math.max(wallsOf(line.text).length - 1, 1))}`
  view.dispatch({
    changes: { from: line.to, insert: row },
    selection: { anchor: line.to + 3 },
    scrollIntoView: true,
  })
  return true
}

/** Tab walks the cells, Enter at the end of a row opens the next one. */
export const tableKeys = keymap.of([
  { key: 'Tab', run: (view) => step(view, false) },
  { key: 'Shift-Tab', run: (view) => step(view, true) },
  {
    key: 'Enter',
    run: (view) => {
      const line = inTable(view.state, view.state.selection.main.head)
      if (!line) return false
      return step(view, false)
    },
  },
])
