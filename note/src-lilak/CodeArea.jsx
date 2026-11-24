import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { python } from '@codemirror/legacy-modes/mode/python'
import { c, cpp } from '@codemirror/legacy-modes/mode/clike'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { json } from '@codemirror/legacy-modes/mode/javascript'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'

/** A file of code in CodeMirror: line numbers, colours, nothing of a note.
 *
 *  The note's Code mode draws its body with this, and other services take it
 *  as it is (lilak_flow opens LILAK's .h/.cpp read-only in it). So it leans on
 *  React and @codemirror only — no note API, no note state:
 *
 *      <CodeArea text={src} lang="cpp" readOnly onChange={(t) => …} />
 *
 *  `lang` is one of LANGS' names (or an alias: py, sh, c++, yml …; `langOfFile`
 *  reads one from a file name). `text` coming in anew replaces what is shown,
 *  unless it is what this editor itself last sent up through `onChange`. */
const MODES = {
  python, py: python, cpp, 'c++': cpp, cc: cpp, cxx: cpp, h: cpp, hh: cpp, hpp: cpp, c,
  bash: shell, sh: shell, shell, zsh: shell, json, yaml, yml: yaml,
}
/** The languages offered by name, in the order a menu shows them. */
export const LANGS = ['cpp', 'c', 'python', 'shell', 'json', 'yaml']
const mode = (name) => MODES[String(name || '').trim().toLowerCase()] || null
/** A StreamLanguage for a name (a ```fence's info string too), or null. */
export const langFor = (name) => { const m = mode(name); return m ? StreamLanguage.define(m) : null }
/** `LKRun.cpp` → 'cpp', `run.sh` → 'sh', `x.h` → 'h' (read as C++). */
export const langOfFile = (path) => {
  const ext = /\.([^./]+)$/.exec(String(path || ''))?.[1]?.toLowerCase() || ''
  return mode(ext) ? ext : ''
}

/** CodeMirror's own colours, with ONE rule changed: a heading is not
 *  underlined (a note's headings are bold and larger, which says it already).
 *  Each colour is also a variable named after it (`--nt-syn-708`), so a page
 *  with a dark theme can say its own; without one it is CodeMirror's. Built
 *  from `defaultHighlightStyle.specs` rather than beside it: a second,
 *  non-fallback highlighter REPLACES the fallback one outright. */
export const noteHighlight = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) => {
    const s = spec.tag === tags.heading ? { ...spec, textDecoration: 'none' } : spec
    return s.color ? { ...s, color: `var(--nt-syn-${s.color.slice(1)}, ${s.color})` } : s
  }))

const look = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--rk-mono, var(--font-mono, ui-monospace, Menlo, monospace))', lineHeight: '1.5' },
})
const locked = (on) => (on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [])

export default function CodeArea({ text = '', lang = '', readOnly = false, onChange, className = '' }) {
  const host = useRef(null)
  const view = useRef(null)
  const sent = useRef(text)               // what this editor last said upstairs
  const said = useRef(onChange)
  said.current = onChange
  const parts = useRef({ lang: new Compartment(), ro: new Compartment() }).current

  useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
          history(), bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          syntaxHighlighting(noteHighlight, { fallback: true }),
          parts.lang.of(langFor(lang) || []),
          parts.ro.of(locked(readOnly)),
          look,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            sent.current = u.state.doc.toString()
            said.current?.(sent.current)
          }),
        ],
      }),
    })
    view.current = v
    return () => { v.destroy(); view.current = null }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current
    if (!v || text === sent.current || text === v.state.doc.toString()) return
    sent.current = text
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
  }, [text])
  useEffect(() => { view.current?.dispatch({ effects: parts.lang.reconfigure(langFor(lang) || []) }) }, [lang])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { view.current?.dispatch({ effects: parts.ro.reconfigure(locked(readOnly)) }) }, [readOnly])   // eslint-disable-line react-hooks/exhaustive-deps

  return <div className={`nt-codearea ${className}`.trim()} ref={host} style={{ height: '100%', minHeight: 0 }} />
}
