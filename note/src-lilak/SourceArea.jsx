import { useEffect, useRef } from 'react'
import { EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, gutterLineClass, GutterMarker,
  highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from '@codemirror/language'
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { python } from '@codemirror/legacy-modes/mode/python'
import { c, cpp } from '@codemirror/legacy-modes/mode/clike'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { json } from '@codemirror/legacy-modes/mode/javascript'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { livePreview, liveLook } from './livemd.js'
import { placeBack, placeSave } from './scrolled.js'
import { tagComplete, citeComplete, dueKeys, quotePaste, takeFiles, tableKeys, tableInput } from './liveedit.js'

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

const mark = (cls) => new (class extends GutterMarker { elementClass = cls })()
const PIN = mark('nt-pin')
const PIN_TMP = mark('nt-pin nt-pin-tmp')
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
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.75', overflow: 'auto' },
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
  '::selection': { background: 'var(--rk-cite)' },
})

export default function RawArea({ value, onChange, live = false, tex = false, at, fileSrc, onFiles, onOpenNote,
  pins, onPin, onEdit, onGutter, goto: go, openAt = 0 }) {
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
        extensions: [
          // Clicking a number bookmarks that line, and clicking it again
          // takes the bookmark off — the gutter is the only place where a
          // line and its number are the same thing to point at.
          lineNumbers({
            domEventHandlers: {
              click: (ed, block) => {
                hit.current?.(ed.state.doc.lineAt(block.from).number)
                return true
              },
            },
          }),
          pinField,
          highlightActiveLineGutter(),
          ...(live && !tex ? [livePreview(fileSrc, onOpenNote), ...liveLook] : []),
          highlightActiveLine(),
          history(),
          // A tex note is LaTeX, not markdown: the language changes and every
          // markdown helper below it goes away. `|` is a column of a matrix,
          // `#` is a macro argument, `>>` is a shift — none of them wants the
          // table skeleton, the tag menu or the calendar.
          ...(tex ? [
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            StreamLanguage.define(stex),
            // A LaTeX paragraph is written as one long line, so it wraps —
            // `원문` does not, because there a line is a line. The gutter
            // still numbers the LINES of the file, not the rows on screen,
            // which is what a compile error names.
            EditorView.lineWrapping,
            // The one menu a LaTeX document wants: the keys it can cite.
            citeComplete,
          ] : [
            // A table's own Tab and Enter go first: the general keymap's Tab
            // indents the line, which is not what a cell wants.
            tableKeys,
            keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
            // ```python and friends are read in that language inside the fence.
            markdown({ base: markdownLanguage, codeLanguages: fenceLanguage }),
            tagComplete,
            ...dueKeys,
            tableInput,
            quotePaste,
          ]),
          ...(onFiles ? [takeFiles(onFiles, tex)] : []),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
    // Where this note was last read, and where it is read from now on — the
    // pane's side can change under it, and that builds a new editor
    // (scrolled.js). The line at the top of the box, not its pixels: the pane
    // it comes back in is another width, so the text wraps elsewhere.
    const top = () => {
      const box = v.scrollDOM.getBoundingClientRect()
      return v.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false)
    }
    const was = placeBack(at)
    if (was) {
      v.dispatch({ effects: EditorView.scrollIntoView(Math.min(was, v.state.doc.length), { y: 'start' }) })
    } else if (openAt >= 1 && openAt <= v.state.doc.lines) {
      // Nothing remembered means this note is being opened, not moved to the
      // other side of the list: it opens at the last line bookmarked (pins.js),
      // which is where the work was. A re-dock keeps the place instead — being
      // thrown across the document for moving a pane is not a kindness.
      const line = v.state.doc.line(openAt)
      v.dispatch({ selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    }
    v.scrollDOM.addEventListener('scroll', () => placeSave(at, top()), { passive: true })
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
    return () => { v.destroy(); view.current = null }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // The bookmarks, as the gutter shows them.
  useEffect(() => {
    view.current?.dispatch({ effects: setPins.of({ lines: pins?.lines || [], tmp: !!pins?.tmp }) })
  }, [pins])

  // `go` is a line and a nonce, so pressing the same one twice goes there
  // twice: the first press may have been followed by scrolling away.
  //
  // The line's TOP lands in the middle of the box, so what you came for has
  // the whole lower half to be read in, and the caret goes with it — arriving
  // somewhere means being able to type there.
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
    const line = v.state.doc.line(go.line)
    v.dispatch({ selection: { anchor: line.from } })
    v.focus()
    // Where the line's top sits half a box down — asked again every frame,
    // because the height map only ESTIMATES the lines it has never drawn: the
    // glide renders what it passes, and the answer sharpens under it.
    const el = v.scrollDOM
    const place = () => Math.max(0, Math.min(el.scrollHeight - el.clientHeight,
      v.lineBlockAt(line.from).top + v.documentPadding.top - el.clientHeight / 2))
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
    // A second jump during the first STOPS the first: two glides setting the
    // same scrollTop in the same frames fight, and the older one can land
    // last — a button pressed while the note was still moving did nothing.
    return () => { live = false; clearTimeout(land) }
  }, [go])

  // A note that changed underneath (a reload, another tab's save) is laid in;
  // one that merely echoes this editor's own typing is not.
  useEffect(() => {
    const v = view.current
    if (!v || value === mine.current || value === v.state.doc.toString()) return
    mine.current = value
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div className={live ? 'nt-raw nt-live' : 'nt-raw'} ref={host} />
}
