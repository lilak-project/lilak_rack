/** What a note writes in its own text, and nothing about how it is drawn.
 *
 *  A vault's notations: a tag, an embed, the day a todo is due and the day it
 *  was done. They live in the body as characters — that is the whole design —
 *  so the editor, the preview, the print page and the todo list all read them
 *  from here rather than each keeping its own idea of the spelling.
 */

import { nameKey, nameText } from 'racklist'

/** `#태그` — Obsidian's spelling, and markdown keeps it apart from a heading
 *  (`# ` has a space after the hash). */
export const TAG_RE = /(^|[\s(])#(?![0-9]+(?![^\s#.,;:!?()[\]{}'"]))([^\s#.,;:!?()[\]{}'"]+)/g

/** Where a LaTeX document keeps its tags: one COMMENT line holding nothing but
 *  them (`% #a #b`). A bare `#태그` cannot stand in a .tex — `#` is TeX's macro
 *  parameter character and errors where it lands — and a comment is ignored by
 *  LaTeX while the tag rule above still reads it. */
export const TAG_COMMENT = /^%[ \t]*(?:#[^\s#]+[ \t]*)+$/

/** `+프로젝트` — a project (project_manager's), by the tag's rule. */
export const PROJ_RE = /(^|[\s(])\+(?![0-9]+(?![^\s#+.,;:!?()[\]{}'"]))([^\s#+.,;:!?()[\]{}'"]+)/g

/** `@이정우`, `@JungWooLee` — a person (author_manager's), by the same rule
 *  with `@` for the sign. The character in FRONT is what makes it a mention,
 *  which is also what keeps an address out of it: the `@` of kim@jinr.ru has
 *  a letter before it, so it is an address and not a mention of kim. */
export const AUTH_RE = /(^|[\s(])@(?![0-9]+(?![^\s#+@.,;:!?()[\]{}'"]))([^\s#+@.,;:!?()[\]{}'"]+)/g

// ── code is not prose ─────────────────────────────────────────────────────
const FENCE = /^[ \t]*(`{3,}|~{3,})/
// A code span is a RUN of backticks closed by the same run: ``#x`` is one too.
const INLINE = /(`+)[^\n]*?\1/g
const blank = (s) => s.replace(/[^\n]/g, ' ')

/** The text with its CODE blanked out — the same length, character for
 *  character, so a position found in the answer is a position in the text.
 *
 *  A ```fence is not a sentence: `#include` is not a tag, `+x` is not a
 *  project, `» 2026-01-01` in an example is not a due date. Everything that
 *  reads the body for this app's notations reads it through here. An inline
 *  `` `#x` `` goes too — it is code for the same reason, said on one line.
 *  A fence nobody closed runs to the end of the note, which is markdown's
 *  own rule.
 */
export const outsideCode = (text) => {
  let open = ''
  return String(text || '').split('\n').map((line) => {
    const m = FENCE.exec(line)
    if (open) {
      if (m && m[1][0] === open[0] && m[1].length >= open.length) open = ''
      return blank(line)
    }
    if (m) { open = m[1]; return blank(line) }
    return line.replace(INLINE, blank)
  }).join('\n')
}

/** `rule` applied where the body is prose, the code left exactly as it is.
 *  The match comes from the blanked text, which is the same text everywhere a
 *  match can happen — so what it says and where it sits are the real ones. */
export const replaceOutsideCode = (text, rule, repl) => {
  const src = String(text || '')
  let out = ''
  let last = 0
  for (const m of outsideCode(src).matchAll(rule)) {
    out += src.slice(last, m.index) + repl(...m)
    last = m.index + m[0].length
  }
  return out + src.slice(last)
}

/** A line without what has a column of its own — its tags and the people it
 *  names. A list of a hundred todos reads better when the sentence is the
 *  sentence, and the note keeps every word either way: this is what a table
 *  shows, never what is saved. A `@word` naming nobody has no column to go to,
 *  so it stays in the sentence. */
export const untagged = (text) => replaceOutsideCode(
  replaceOutsideCode(text, TAG_RE, (m, lead) => lead),
  AUTH_RE, (m, lead, name) => (isAuthor(name) ? lead : m))
  .replace(/\s{2,}/g, ' ')
  .trim()

/** `![[name.png]]` — Obsidian's embed, which is not markdown. */
export const EMBED_RE = /!\[\[([^\]]+)\]\]/g

/** The day a todo is due, and the day it was done. `»` and `✓` are what this
 *  app writes; `📅` and `✅` (Obsidian Tasks) are still read, because the
 *  notes that came from a vault are full of them. */
export const DUE_RE = /(?:»|📅)\s*(\d{4}-\d{1,2}-\d{1,2})/g
export const DONE_RE = /(?:✓|✅)\s*(\d{4}-\d{1,2}-\d{1,2})/g
/** `!!`, a word of its own on a todo's line: it is urgent. */
export const URGENT_RE = /(^|\s)!!(?=\s|$)/g

/** A name a browser can draw. Anything else — a pdf, a sheet, a document — is
 *  a file you open, not a picture to put on the page. */
export const isImage = (name) =>
  /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(String(name || ''))

/** The pictures a note embeds, in order, numbered from the top: `그림 1`,
 *  `그림 2` … — `{ at, line, name, spec, n }`, `at` where the markup starts,
 *  `line` the (1-based) line it is on. Files that are not pictures (a pdf, a
 *  .tex) are embeds too, but not figures, and get no number.
 *
 *  ponytail: an embed inside a code fence is counted. Nobody writes one. */
/** A note cut into slides. `blocks` are what the renderer drew, top to bottom:
 *  { line, top, bottom, rule, h1 }. The first is the title slide's one line of
 *  content, and only it. After that a slide ends at a `---` (`rule`, on neither
 *  side), before a `#` heading, or before a block that would run past `room`
 *  — one too tall for any slide is left alone at the top of its own, to be cut.
 *  → [{ from, to, spare }], source lines, 1-based and inclusive, and how much of
 *  `room` the slide left empty; [0] is the title slide, `{ from: 0, to: -1 }`
 *  when a `---` came first. */
export function cutPages(blocks, room) {
  const pages = []
  let page = null, top = 0
  for (const b of blocks) {
    if (b.rule) {
      if (page) page.to = b.line - 1
      else if (!pages.length) pages.push({ from: 0, to: -1, spare: 0 })
      page = null
    } else {
      if (!page || pages.length === 1 || b.h1 || b.bottom - top > room) {
        if (page) page.to = b.line - 1
        page = { from: b.line, to: Infinity, spare: 0 }
        top = b.top
        pages.push(page)
      }
      page.spare = Math.max(0, room - (b.bottom - top))
    }
  }
  return pages
}

/** The lines that are nothing but `---`, code blocks aside. On a slide each is
 *  the line between two slides, even straight under a line of text. */
export function ruleLines(body) {
  let fenced = false
  const out = []
  String(body || '').split('\n').forEach((l, i) => {
    if (/^ {0,3}(```|~~~)/.test(l)) fenced = !fenced
    else if (!fenced && /^ {0,3}-{3,}\s*$/.test(l)) out.push(i + 1)
  })
  return out
}

/** The note as the renderer should read it: `***` says what `---` says and,
 *  unlike it, cannot turn the line above into a heading. The lines stay put. */
export function plainRules(body) {
  const rules = new Set(ruleLines(body))
  return String(body || '').split('\n').map((l, i) => (rules.has(i + 1) ? '***' : l)).join('\n')
}

/** line → `1`, `1.2`, `1.2.3`: the numbers `#`, `##`, `###` come to, counted
 *  through the note. A note that opens on `##` has no first number to show. */
export function headingNumbers(body) {
  const at = [0, 0, 0]
  const out = new Map()
  outsideCode(String(body || '')).split('\n').forEach((l, i) => {
    const m = /^ {0,3}(#{1,3})[ \t]+\S/.exec(l)
    if (!m) return
    const depth = m[1].length
    at[depth - 1] += 1
    at.fill(0, depth)
    out.set(i + 1, at.slice(at.findIndex(Boolean), depth).join('.'))
  })
  return out
}

/** The body with those numbers written into its headings, for whatever renders
 *  it: only there, the file does not get them. The lines stay where they are. */
export function numberHeadings(body) {
  const nos = headingNumbers(body)
  return String(body || '').split('\n')
    .map((l, i) => (nos.has(i + 1) ? l.replace(/^ {0,3}#{1,3}[ \t]+/, (h) => `${h}${nos.get(i + 1)}\u2002 `) : l))
    .join('\n')
}

/** The text of each of those slides. */
export function pageTexts(body, pages) {
  const lines = String(body || '').split('\n')
  return pages.map((p) => lines.slice(p.from - 1, p.to).join('\n'))
}

export function figureList(body) {
  const text = String(body || '')
  const out = []
  let line = 1, seen = 0
  for (const m of text.matchAll(EMBED_RE)) {
    const [name] = embedSpec(m[1])
    if (!isImage(name)) continue
    for (let i = seen; i < m.index; i += 1) if (text.charCodeAt(i) === 10) line += 1
    seen = m.index
    out.push({ at: m.index, line, name, spec: m[1], n: out.length + 1 })
  }
  return out
}

/** `name|400` — Obsidian's way of saying how wide this one picture should be.
 *  Everything else is left to the stylesheet, which keeps a picture inside the
 *  pane and under two thirds of the screen. */
export function embedSpec(spec) {
  const text = String(spec || '')
  const bar = text.lastIndexOf('|')
  if (bar < 0) return [text, null]
  const w = parseInt(text.slice(bar + 1), 10)
  return Number.isFinite(w) && w > 0 ? [text.slice(0, bar).trim(), w] : [text, null]
}

/** The names `#` and `+` offer under the caret.
 *
 *  Tags are this list's and every service's that shares them (the rack
 *  services: racklist tags.js); projects are project_manager's. Both
 *  are the page's to hand over (setTagChoices / setProjChoices), in the order
 *  it gives them — most worn first — and the spelling already in use wins
 *  whatever the case.
 */
let CHOICES = []
let PROJECTS = []
export const setTagChoices = (names) => { CHOICES = names || [] }
let KNOWN = new Set()
/** A project as text: its name with the spaces (and what else a word cannot
 *  hold) run into `_` — "STARK + CRIB" is written `+STARK_CRIB`. */
export const projText = (name) => String(name).trim().replace(/[\s#+.,;:!?()[\]{}'"_]+/g, '_').replace(/^_|_$/g, '')
const projKey = (t) => projText(t).toLowerCase()
/** Only project_manager makes a project: a `+word` naming none is just text. */
export const isProject = (word) => KNOWN.has(projKey(word))
const heard = new Set()
/** Told when the projects change (they arrive after the editor is drawn). */
export const onProjChoices = (fn) => { heard.add(fn); return () => heard.delete(fn) }
export const setProjChoices = (names) => {
  PROJECTS = names || []
  KNOWN = new Set(PROJECTS.map(projKey))
  heard.forEach((fn) => fn())
}

// ── who `@` offers ────────────────────────────────────────────────────────
// A person is offered by BOTH their names and shown with the other one and
// their address, so two people of one name are still told apart on the menu.
// What goes in the text is the spelling that matched what was typed: type 이
// and a Korean name goes in, type J and the English one does.
let PEOPLE = []
const peopleHeard = new Set()
export const onAuthorChoices = (fn) => { peopleHeard.add(fn); return () => peopleHeard.delete(fn) }
export const setAuthorChoices = (list) => { PEOPLE = list || []; peopleHeard.forEach((fn) => fn()) }
/** Everyone a `@word` names — none, one, or the two who share a name. */
export const authorsNamedHere = (word) => {
  const k = nameKey(word)
  return k ? PEOPLE.filter((x) => x.keys.includes(k)) : []
}
/** The ONE person a `@word` names, or null. A name two people answer to names
 *  neither: it stays text until a nick tells them apart. */
export const authorOf = (word) => {
  const hit = authorsNamedHere(word)
  return hit.length === 1 ? hit[0] : null
}
/** Only author_manager makes a person: a `@word` naming none is just text. */
export const isAuthor = (word) => !!authorOf(word)
/** The name a `@word` is shown by: the spelling it was written from, spaces
 *  and all — `@JungWooLee` reads "Jung Woo Lee". '' for a word naming nobody. */
export const authorShow = (word) => {
  const x = authorOf(word)
  if (!x) return ''
  const k = nameKey(word)
  return [x.kor, x.eng, x.nick].find((n) => n && nameKey(n) === k) || x.kor || x.eng
}
/** [{ text, show, other, email }] — `text` is written, `show` is the name it
 *  is written from, `other` the name in the other script. */
export const authorsFor = (q) => {
  const k = String(q).normalize('NFC').toLowerCase()
  // A syllable still being composed matches nobody on its way: 다여 is 다영
  // not yet finished, 당 is 다 with the ㅇ of 영 still on it. So the people
  // for what is already there stay offered until the syllable is done.
  const rows = authorRows(k)
  return rows.length || !/[\u3131-\u318e\uac00-\ud7a3]$/.test(k) ? rows : authorRows(k.slice(0, -1))
}
const authorRows = (k) => {
  const rows = []
  for (const x of PEOPLE) {
    // Their own spellings, Korean first; with nothing typed, just the one.
    const names = (k ? [x.kor, x.eng, x.nick] : [x.kor || x.eng]).filter(Boolean)
    for (const n of names) {
      const key = nameKey(n)
      const rank = key.startsWith(k) ? 0 : key.includes(k) ? 1 : -1
      if (rank < 0) continue
      const other = [x.kor, x.eng, x.nick].filter((m) => m && m !== n)[0] || ''
      rows.push({ rank, text: nameText(n), show: n, other, email: x.email })
      break                       // one row per person, not one per spelling
    }
  }
  return rows.sort((a, b) => a.rank - b.rank || a.show.localeCompare(b.show, 'ko')).slice(0, 8)
}

const lower = (t) => String(t).toLowerCase()
const offer = (names, q) => {
  const k = lower(q)
  const starts = names.filter((t) => lower(t).startsWith(k))
  const inside = k ? names.filter((t) => !lower(t).startsWith(k) && lower(t).includes(k)) : []
  // A name typed whole in its own spelling needs nothing offered.
  return [...starts, ...inside].filter((t) => t !== q).slice(0, 8)
}
/** One level of the tags: `#` offers `agent/`, `#agent/` offers what is in it. */
const level = (names, q) => {
  const k = lower(q)
  const at = k.lastIndexOf('/') + 1
  const out = names.filter((t) => lower(t).startsWith(k.slice(0, at))).map((t) => {
    const i = t.indexOf('/', at)
    return i < 0 ? t : t.slice(0, i + 1)
  })
  return out.filter((t, i) => out.findIndex((x) => lower(x) === lower(t)) === i)
}
// A word in the middle of a tag still finds it (`#rack` offers `agent/rack`).
export const choicesFor = (q) => [...new Set([...offer(level(CHOICES, q), q),
  ...(q ? CHOICES.filter((t) => !lower(t).startsWith(lower(q)) && lower(t).includes(lower(q))) : [])])].filter((t) => t !== q).slice(0, 8)

/** The cite keys `\cite{` offers. Two lists in one: the note's own `.bib`
 *  (what will actually resolve when it compiles) and reference_manager's
 *  library (what can be cited once it is added to the bib). Each carries its
 *  title, so a key that is six letters of someone's name is still readable in
 *  the menu. */
let CITES = []
export const setCiteChoices = (list) => { CITES = list || [] }
/** Only the keys the note's own bib defines — a `\cite{}` of anything else
 *  comes out of the PDF as a `?`. Empty when the note has no bib at all,
 *  which is also how "nothing to check" is said. */
export const bibKeys = () => new Set(CITES.filter((c) => c.bib).map((c) => c.key))
export const citesFor = (q) => {
  const k = lower(q)
  const hit = (c) => lower(c.key).startsWith(k) || lower(c.title || '').includes(k)
  // The bib's own keys first: those are the ones that compile.
  return CITES.filter(hit).sort((a, b) => (b.bib ? 1 : 0) - (a.bib ? 1 : 0)).slice(0, 12)
}
export const projectsFor = (q) => offer(PROJECTS, q)
