import { useEffect, useRef } from 'react'
import { EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, gutterLineClass, GutterMarker, dropCursor,
  highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, StreamLanguage } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { python } from '@codemirror/legacy-modes/mode/python'
import { c, cpp } from '@codemirror/legacy-modes/mode/clike'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { json } from '@codemirror/legacy-modes/mode/javascript'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { livePreview, liveLook } from './livemd.js'
import { deckField, deckFit, deckGutter, setDeck, setDeckScale } from './slides.jsx'
import { commentFold, setFoldComments } from './comments.js'
import { placeBack, placeSave } from './scrolled.js'
import { retext } from './merge3.js'
import { tail, toggleTail, isTailKey } from './tail.js'
import { tagLine } from './marks.js'

/** Where a deck's text begins: past the tag lines and blank lines at its top
 *  (what `blankHeights` folds under the title slide). 0 when it has none. */
const belowTags = (text) => {
  const lines = String(text || '').split('\n')
  if (!tagLine(lines[0])) return 0
  let at = 0, i = 0
  while (i < lines.length - 1 && (tagLine(lines[i]) || !lines[i].trim())) { at += lines[i].length + 1; i += 1 }
  return at
}
import { tagComplete, citeComplete, dueKeys, jamoKeys, listKeys, markKeys, quotePaste, takeFiles, tableKeys, tableInput, wonCode, listCaret } from './liveedit.js'

/** The note as the file has it, in a real text editor — plain (`원문`) or with
 *  the markdown drawn over it (`라이브`).
 *
 *  The editor beside this one reads the file into a document and writes the
 *  file back from it, which is why it argues with the file about backslashes.
 *  This one holds the TEXT: what is typed is what is saved, character for
 *  character — the only thing on top of it is colour.
 *
 *  It is also the first piece of the editor the notes are headed for (see the
 *  upgrade plan, §5): the same CodeMirror, with the markdown drawn rather than
 *  spelled out, and with LaTeX for a tex note.
 *
 *  `원문` does not wrap — there a line is a line. `라이브` and LaTeX do, and
 *  the numbers beside them still count the file's lines, not the screen's.
 */
// ── bookmarked lines ───────────────────────────────────────────────────────
// A bookmark is a line NUMBER (pins.js), not a place in the text, so the
// gutter is rebuilt from the numbers whenever they change AND whenever the
// document does — a line deleted out from under number 40 leaves number 40
// where it is, on whatever is there now.
// ── what a ```fence can name ──────────────────────────────────────────────
// The modes the LaTeX view already brings in (`legacy-modes`), so colouring
// a code block costs no new package. Adding one is a line in this table.
const FENCE = {
  python, py: python, cpp, 'c++': cpp, cc: cpp, c, bash: shell, sh: shell, shell, zsh: shell,
  json, yaml, yml: yaml,
}
const fenceLanguage = (info) => {
  const mode = FENCE[String(info).trim().toLowerCase()]
  return mode ? StreamLanguage.define(mode) : null
}

/** CodeMirror's own style, with ONE rule changed: it underlines a heading as
 *  well as bolding it, and the line under it read as a link — a note's
 *  headings are bold and a size larger, which says it already.
 *
 *  Built from `defaultHighlightStyle.specs` rather than added beside it: a
 *  second (non-fallback) highlighter REPLACES the fallback one outright
 *  (`getHighlighters`), so laying one over the default took every colour in
 *  the editor — LaTeX's and markdown's — away with it. */
/*  Each colour is also a variable named after it (`--nt-syn-708`), so the
 *  dark theme can say its own (note.css) and bright stays CodeMirror's. */
export const noteHighlight = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) => {
    const s = spec.tag === tags.heading ? { ...spec, textDecoration: 'none' } : spec
    return s.color ? { ...s, color: `var(--nt-syn-${s.color.slice(1)}, ${s.color})` } : s
  }))

const mark = (cls) => new (class extends GutterMarker { elementClass = cls })()
const PIN = mark('nt-pin')
const PIN_TMP = mark('nt-pin nt-pin-tmp')
const EMPTY = mark('nt-gut-empty')

/** The caret's line, when there is nothing on it.
 *
 *  A blank line is the one line that looks the same whether the caret is on
 *  it or not — and in a drawn markdown note it is also where a heading or a
 *  list is ABOUT to be, so knowing you are standing on nothing is worth a
 *  mark. Only one line is ever marked: the one the caret is on, and only if
 *  there is truly nothing on it, not so much as a space. */
const blankAt = (state) => {
  const line = state.doc.lineAt(state.selection.main.head)
  return line.length ? RangeSet.empty : RangeSet.of([EMPTY.range(line.from)])
}

const blankField = StateField.define({
  create: blankAt,
  update: (set, tr) => ((tr.docChanged || tr.selection) ? blankAt(tr.state) : set),
  provide: (f) => gutterLineClass.from(f),
})
const setPins = StateEffect.define()

const lineSet = (state, { lines, tmp }) => RangeSet.of(
  [...new Set(lines)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= state.doc.lines)
    .sort((a, b) => a - b)
    .map((n) => (tmp ? PIN_TMP : PIN).range(state.doc.line(n).from)), true)

const pinField = StateField.define({
  create: (state) => ({ at: { lines: [], tmp: false }, set: RangeSet.empty }),
  update(cur, tr) {
    const at = tr.effects.reduce((v, e) => (e.is(setPins) ? e.value : v), cur.at)
    if (at === cur.at && !tr.docChanged) return cur
    return { at, set: lineSet(tr.state, at) }
  },
  provide: (f) => gutterLineClass.compute([f], (s) => s.field(f).set),
})

const look = EditorView.theme({
  '&': {
    flex: '1',
    minHeight: '0',
    fontFamily: 'var(--rk-mono)',
    fontSize: 'var(--rk-fs)',
    color: 'var(--rk-text)',
    background: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  // Lines are told apart by the gap BETWEEN them, so the gap inside one (a
  // line too long for the width) has to be smaller than it: 1.45 here, and
  // `.cm-line`'s own padding puts the rest back between the lines.
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.45', overflow: 'auto' },
  '.cm-content': { padding: '10px 26px 24px 14px', caretColor: 'var(--rk-ink)' },
  '.cm-gutters': {
    background: 'var(--rk-gut)',
    color: 'var(--rk-mute)',
    border: '0',
    borderRight: '1px solid var(--rk-line)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px' },
  '.cm-activeLine': { background: 'var(--rk-gut)' },
  '.cm-activeLineGutter': { background: 'var(--rk-line)', color: 'var(--rk-dim)' },
  // The browser's own selection, not a drawn one: CodeMirror's `drawSelection`
  // paints UNDER the content, so `.cm-activeLine`'s background hid whatever was
  // selected on the line the caret was in — a double-clicked word showed
  // nothing at all. The native highlight paints over the line and under the
  // glyphs, which is where it belongs.
  '::selection': { background: 'var(--nt-sel, var(--rk-cite))' },
})

// The line between two slides stands on top of the slide's own height.
const CUT_LINE = 12   // the band between two slides: note.css --nt-band

export default function RawArea({ value, onChange, live = false, tex = false, readOnly = false, at, fileSrc, onFiles, onOpenNote,
  pins, onPin, onEdit, onGutter, goto: go, openAt = 0, hold, fold = false, deck = null, numbered = false }) {
  const host = useRef(null)
  const view = useRef(null)
  const cb = useRef(onChange)
  cb.current = onChange
  // The gutter's handlers live in the editor, which is built once; these are
  // what they call, which is this render's.
  const hit = useRef(onPin)
  hit.current = onPin
  const typed = useRef(onEdit)
  typed.current = onEdit
  const sized = useRef(onGutter)
  sized.current = onGutter
  // What this editor itself last produced: a value coming back from a save
  // must not be laid over what is being typed.
  const mine = useRef(value)

  // What was last said upstairs, so nothing is said twice.
  const told = useRef({ gutter: 0 }).current

  useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        // A deck's first lines (its tags, the blanks under them) are folded
        // under the title slide and open only for a caret that is IN them. A
        // caret left at 0 opened them at the first click anywhere — the whole
        // deck went down a line and came back. It starts below them.
        ...(deck ? { selection: { anchor: belowTags(value) } } : {}),
        extensions: [
          // Clicking a number bookmarks that line, and clicking it again
          // takes the bookmark off — the gutter is the only place where a
          // line and its number are the same thing to point at.
          (deck ? deckGutter : lineNumbers)({
            domEventHandlers: {
              click: (ed, block, e) => {
                // The button under the last number: room below (tail.js).
                if (isTailKey(e)) { toggleTail(ed); return true }
                hit.current?.(ed.state.doc.lineAt(block.from).number)
                return true
              },
            },
          }),
          // A deck ends on its own band; any other note can ask for room below.
          ...(deck ? [deckField, deckFit] : tail),
          // A locked note (the 잠금 in 공용): read, selected and copied, never
          // changed — by a key, a paste, a drop or a tool alike.
          // No caret either (`editable`): there is nowhere to type, and the
          // lines stay drawn as they read (livemd.js asks `readOnly`).
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorState.changeFilter.of(() => false)] : []),
          pinField,
          ...(tex || deck ? [] : [blankField]),
          highlightActiveLineGutter(),
          ...(live && !tex ? [livePreview(fileSrc, onOpenNote, numbered), ...liveLook] : []),
          // `원문` wraps too: a dictated paragraph is one long line.
          ...(live || tex ? [] : [EditorView.lineWrapping]),
          highlightActiveLine(),
          history(),
          // Backspace takes the 한글 syllable still being typed apart, jamo by
          // jamo. Above both keymaps, and outside the tex/markdown split: a
          // LaTeX note is written in Korean too.
          ...jamoKeys,
          // A tex note is LaTeX, not markdown: the language changes and every
          // markdown helper below it goes away. `|` is a column of a matrix,
          // `#` is a macro argument, `>>` is a shift — none of them wants the
          // table skeleton, the tag menu or the calendar.
          ...(tex ? [
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            StreamLanguage.define(stex),
            // A LaTeX paragraph is written as one long line, so it wraps. The gutter
            // still numbers the LINES of the file, not the rows on screen,
            // which is what a compile error names.
            EditorView.lineWrapping,
            // The one menu a LaTeX document wants: the keys it can cite.
            citeComplete,
            // `%` lines, folded away when the 주석 tool says so.
            commentFold,
          ] : [
            // A table's own Tab and Enter go first: the general keymap's Tab
            // indents the line, which is not what a cell wants.
            tableKeys,
            keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
            // ```python and friends are read in that language inside the fence.
            // `---` is always a rule: under a line of text, markdown would
            // call that line a heading and draw it bold.
            markdown({ base: markdownLanguage, codeLanguages: fenceLanguage,
              extensions: [{ remove: ['SetextHeading'] }] }),
            markKeys,
            tagComplete,
            ...dueKeys,
            tableInput,
            listKeys,
            // Drawn as a bullet (MD, slides), the marker is no place for the
            // caret; in 원문 it is text like any other.
            ...(live ? [listCaret] : []),
            wonCode,
            quotePaste,
          ]),
          // Where a dragged file would land, drawn as a caret on the line
          // under the pointer. CodeMirror's own, so it is the same line the
          // drop then uses — nothing here measures it a second time.
          ...(onFiles ? [dropCursor(), takeFiles(onFiles, tex, !live)] : []),
          syntaxHighlighting(noteHighlight, { fallback: true }),
          look,
          EditorView.updateListener.of((u) => {
            // How wide the numbers are, so the title bar can carry the column
            // up to itself and have it line up. It changes when the document
            // grows a digit, which is seldom.
            const w = u.view.dom.querySelector('.cm-gutters')?.offsetWidth || 0
            if (w && w !== told.gutter) { told.gutter = w; sized.current?.(w) }
            if (!u.docChanged) return
            const next = u.state.doc.toString()
            mine.current = next
            cb.current(next)
            // Where the typing is. Kept whether or not anything is
            // bookmarked, because it is what a note with no bookmarks shows.
            typed.current?.(u.state.doc.lineAt(u.state.selection.main.head).number)
          }),
        ],
      }),
    })
    view.current = v
    // The manage column's tools reach the document through `edit` upstairs,
    // which reaches it through here.
    if (hold) hold.current = v
    // Where this note was last read, and where it is read from now on — the
    // pane's side can change under it, and that builds a new editor
    // (scrolled.js). The line at the top of the box, not its pixels: the pane
    // it comes back in is another width, so the text wraps elsewhere.
    const top = () => {
      // CodeMirror can be between renders when a scroll arrives (the tools
      // column opening, a pane docking), and asking it what is at a point
      // then throws from inside its own tile map. A place not written down
      // is no loss; a scroll handler that throws on every tick is.
      try {
        const box = v.scrollDOM.getBoundingClientRect()
        return v.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false)
      } catch { return null }
    }
    const was = placeBack(at)
    if (was != null) {      // 0 is the top of the note, and that is a place too
      v.dispatch({ effects: EditorView.scrollIntoView(Math.min(was, v.state.doc.length), { y: 'start' }) })
    } else if (openAt >= 1 && openAt <= v.state.doc.lines) {
      // Nothing remembered means this note is being opened, not moved to the
      // other side of the list: it opens at the last line bookmarked (pins.js),
      // which is where the work was. A re-dock keeps the place instead — being
      // thrown across the document for moving a pane is not a kindness.
      const line = v.state.doc.line(openAt)
      v.dispatch({ selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) })
    }
    // Asked once the scrolling has stopped, never during it: asking CodeMirror
    // where anything is makes it run its pending measure THEN, and in Safari a
    // measure in the middle of a flick put the note back where the flick had
    // started — ten lines up, over and over, all the way down.
    let rest = 0
    v.scrollDOM.addEventListener('scroll', () => {
      clearTimeout(rest)
      rest = setTimeout(() => {
        const p = top()
        if (p != null) placeSave(at, p)
      }, 250)
    }, { passive: true })
    // Measured now rather than on the next update: a note nobody has touched
    // produces no update, and the column at the top would be the wrong width
    // until the first keystroke. CodeMirror has drawn itself into `host` by
    // this line, so the gutter is there to measure.
    told.gutter = v.dom.querySelector('.cm-gutters')?.offsetWidth || 0
    if (told.gutter) sized.current?.(told.gutter)
    // The pane's ⌘F (racklist panefind.jsx) finds in the whole document — the
    // DOM holds only the lines on screen. Offsets in the text, so a wrapped
    // line is still the file's line.
    let found = []
    v.dom.rackFind = {
      find: (q) => {
        const text = v.state.doc.toString().toLowerCase()
        found = []
        for (let i = q ? text.indexOf(q) : -1; i >= 0; i = text.indexOf(q, i + q.length)) found.push([i, i + q.length])
        return found.length
      },
      // Scrolled to, the match is on screen: its text, as a range the bar can light.
      show: (i) => new Promise((done) => {
        const [from, to] = found[i] || []
        if (from == null) { done(null); return }
        v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try {
            const a = v.domAtPos(from), b = v.domAtPos(to)
            const r = document.createRange()
            r.setStart(a.node, a.offset)
            r.setEnd(b.node, b.offset)
            done(r)
          } catch { done(null) }
        }))
      }),
      clear: () => {},
    }
    return () => { clearTimeout(rest); v.destroy(); view.current = null; if (hold) hold.current = null }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Whether the `%` lines are folded (comments.js). A prop, not a mode of
  // this editor: the tool holds the switch and the note remembers it.
  useEffect(() => {
    view.current?.dispatch({ effects: setFoldComments.of(!!fold) })
  }, [fold])

  // Where the slides were cut, and the title that is the first of them.
  useEffect(() => {
    if (deck) view.current?.dispatch({ effects: setDeck.of(deck) })
  }, [deck?.pages, deck?.title, JSON.stringify(deck?.cover)])   // eslint-disable-line react-hooks/exhaustive-deps

  // The slide, fitted to this pane the way the show fits it to the screen.
  // The pane's scroll bar is kept out of it (`scrollbar-gutter`, note.css), or
  // a slide long enough to need one would shrink and no longer need it.
  useEffect(() => {
    if (!deck) return undefined
    const el = host.current
    const fit = () => {
      const v = view.current
      if (!v) return
      const gutter = v.dom.querySelector('.cm-gutters')?.offsetWidth || 0
      el.style.setProperty('--nt-deck-h', `${deck.h}px`)
      const k = Math.min((v.scrollDOM.clientWidth - gutter) / 1000, (el.clientHeight - CUT_LINE) / deck.h)
      el.style.setProperty('--nt-k', k)
      setDeckScale(k)
      v.requestMeasure()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [deck?.h])   // eslint-disable-line react-hooks/exhaustive-deps

  // The bookmarks, as the gutter shows them.
  useEffect(() => {
    view.current?.dispatch({ effects: setPins.of({ lines: pins?.lines || [], tmp: !!pins?.tmp }) })
  }, [pins])

  // `go` is a line and a nonce, so pressing the same one twice goes there
  // twice: the first press may have been followed by scrolling away.
  //
  // The line lands just under the top of the box, so what you came for has
  // nearly the whole of it to be read in, and the caret goes with it —
  // arriving somewhere means being able to type there. Two lines of room
  // above it rather than none: a heading with nothing over it reads as the
  // top of the file, and the line before is often what says where you are.
  //
  // The glide is ours, 280ms of it however far the line is. The browser's own
  // `behavior: 'smooth'` takes as long as the distance is long — a bookmark
  // 400 lines down becomes a three-second voyage — and CodeMirror's
  // scrollIntoView cannot be asked for it either: CM sets scrollTop and
  // measures it back in the same frame, so a smooth scroller has it read a
  // place it has not moved to yet and give up.
  useEffect(() => {
    const v = view.current
    if (!v || !go?.line || go.line > v.state.doc.lines) return
    // A jump is made once. `go` outlives this editor (a mode change builds a
    // new one, and this effect runs as it is built): a bookmark pressed an
    // hour ago threw the new editor back to its line. `n` is when it was asked.
    if (go.n && Date.now() - go.n > 1500) return
    const line = v.state.doc.line(go.line)
    // `quiet`: the view moves and the caret does not; the focus leaves, so no
    // line is spelled out and no caret blinks on the slide.
    if (go.quiet) v.contentDOM.blur()
    else {
      v.dispatch({ selection: { anchor: line.from } })
      v.focus()
    }
    // Where the line's top sits half a box down — asked again every frame,
    // because the height map only ESTIMATES the lines it has never drawn: the
    // glide renders what it passes, and the answer sharpens under it.
    const el = v.scrollDOM
    const place = () => Math.max(0, Math.min(el.scrollHeight - el.clientHeight,
      v.lineBlockAt(line.from).top + v.documentPadding.top
        // A slide (after the cover): the box starts halfway down the band before
        // it — and the page being fitted to the box less one band, the band
        // after it shows the same half at the bottom.
        + (go.flush != null ? (v.state.field(deckField, false)?.gaps?.[go.slide] ?? go.flush) * parseFloat(host.current.style.getPropertyValue('--nt-k') || 1) + (go.slide ? CUT_LINE / 2 : 0) : -v.defaultLineHeight * 2)))
    // A jump of twenty screens is not something to watch — it is a blur, and
    // CodeMirror cannot draw the lines flying past it either. So a long one
    // ARRIVES a screen and a half away, and glides that: the eye still gets
    // to see where it came down.
    const near = place()
    if (Math.abs(near - el.scrollTop) > el.clientHeight * 3) {
      el.scrollTop = near + Math.sign(el.scrollTop - near) * el.clientHeight * 1.5
    }
    const t0 = performance.now()
    const from = el.scrollTop
    let live = true
    const glide = () => {
      if (!live) return
      const k = Math.min(1, (performance.now() - t0) / 280)
      el.scrollTop = from + (place() - from) * (1 - (1 - k) ** 3)
      // The last frame drew the lines it landed among; one more asks where
      // they really are.
      requestAnimationFrame(k < 1 ? glide : () => { if (live) el.scrollTop = place() })
    }
    glide()
    // Frames stop when the window is not being drawn (another app in front,
    // the pane hidden), and a glide frozen half way is a note left in the
    // wrong place. Timers still run, so one lands it.
    const land = setTimeout(() => { if (live) el.scrollTop = place() }, 400)
    // The hand wins: a scroll or a press during the glide ends it where it is,
    // rather than being overwritten each frame and snapped back at the end.
    const yield_ = () => { live = false; clearTimeout(land) }
    const HAND = ['wheel', 'touchstart', 'pointerdown']
    HAND.forEach((t) => el.addEventListener(t, yield_, { passive: true, once: true }))
    // A second jump during the first STOPS the first: two glides setting the
    // same scrollTop in the same frames fight, and the older one can land
    // last — a button pressed while the note was still moving did nothing.
    return () => { live = false; clearTimeout(land); HAND.forEach((t) => el.removeEventListener(t, yield_)) }
  }, [go])

  // A note that changed underneath (a reload, another tab's save) is laid in;
  // one that merely echoes this editor's own typing is not.
  useEffect(() => {
    const v = view.current
    if (!v || value === mine.current || value === v.state.doc.toString()) return
    mine.current = value
    // Only what differs: the whole text replaced took the caret to the top.
    retext(v, value)
  }, [value])

  return <div className={`nt-raw${live ? ' nt-live' : ''}${deck ? ' nt-slide' : ''}`} ref={host} />
}
