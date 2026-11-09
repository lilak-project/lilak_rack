/**
 * The manage column's tools — one file each (노트 「관리 도구함」).
 *
 * A tool is a plain object:
 *
 *     { id, label, modes, badge?, Body }
 *
 *   id     the tab's key; where it was left open is kept under it
 *   label  an i18n key (`tr(label)`), not a string
 *   modes  which KINDS of note it appears for: 'md' (라이브·원문) or 'tex'
 *   badge  (ctx) => 'dot' | number | null — shown on the tab and gathered
 *          onto the 관리 button. It may only count what the editor already
 *          knows: a shut tool does no work.
 *   Body   the tab's contents, a component taking the ctx below
 *
 * The mode does not keep a list of its tools — the tool says which modes it
 * is for. A list in the mode would be a second place to edit every time a
 * tool is added.
 *
 * ── ctx ───────────────────────────────────────────────────────────────────
 *
 *   note      { id, title, body, date, fields, tex, dirty } — reading only
 *   setNote   (patch | fn) => void, the way `setF` is called upstairs
 *   edit      what the tool does to the DOCUMENT, and the only way it may:
 *               put(text)             at the caret
 *               wrap(before, after)   round what is selected
 *               lines((text, n) => next)  over the selected lines
 *               at()                  the caret's line number
 *               text()                the body (reading)
 *             It wraps CodeMirror; no tool is handed the view.
 *   go(line)  send the editor to a line (it glides there)
 *   print()   the browser's print page for this note
 *   say(msg)  the service's own notice line
 *   ask(path) the note API
 *   keep      { pins, last, marks, setPins, clear } — the line bookmarks
 *   files     [{ name, bytes }] in the note's folder, or null until asked
 *   seeFiles() ask again (after something put a file there)
 *   fold      { on, set } — are the `%` lines folded (a tex note)
 *   read      { on, set } — is the editor showing the note as it reads
 *   slide     { show(), ratio, setRatio } in the slide mode, else null
 *   numbered  { on, set } — does this note number its headings
 *   where     { notes, files } — the folders on the host, or null
 *   tex       the tex machinery (compile, the folder, the bib) — null for a
 *             markdown note. ponytail: this is still Editor's state handed
 *             down; it moves into a hook of its own when a second thing
 *             needs it.
 */
import common from './common.jsx'
import format from './format.jsx'
import outline from './outline.jsx'
import files from './files.jsx'
import bib from './bib.jsx'

export const TOOLS = [common, format, outline, files, bib]

/** The tools of a kind of note, in the order they are declared. */
export const toolsFor = (kind) => TOOLS.filter((t) => t.modes.includes(kind))
