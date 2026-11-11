/**
 * note — one markdown file per note, listed as every rack service lists: the
 * screen is the kit's RackService (racklist/service.jsx) — the ⋯ and the search
 * in the title bar, the tabs (notes · tags · todos), the table, the panes.
 *
 * A note is a FILE: YAML front matter (title, date, tags, and whatever else you
 * put there) and a markdown body. The folder opens in Obsidian unchanged, so
 * nothing here is a format of our own — the todos are GFM checkboxes, and a
 * template is just a note in templates/. What RackService cannot know is said
 * below (NOTE_DEF, the slots): where the notes are (note's own API, not
 * rackstore), the editor, a PDF, the to-dos tab, daily · templates · print.
 */
import './strings.js'
import { api, ask, fileSrc, kb, noteQ, openTab, putFile } from './api.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RackService, RackTable, RackRow, RackActions, useRackKeys, FAV, bumpSort, byKeys, PORTAL_BASE, brandStyle,
  projectKey, load, authHeaders, tagKey, tagWithin, mergeTags as tagCounts, useTagSources, uniqueTags, useProjects,
  useReferences, useAuthors, save, addReference, referenceDoc, bibText,
} from 'racklist'
import { numberHeadings, TAG_RE, TAG_COMMENT, URGENT_RE, outsideCode, replaceOutsideCode, untagged, setTagChoices, setProjChoices, setCiteChoices, setAuthorChoices, authorShow } from './marks.js'
import SourceArea from './SourceArea.jsx'
import { wrapSel } from './liveedit.js'
import { Rendered } from './reading.jsx'
import { DeckMeasure, SlideShow, enterFull, gapBefore, slideH } from './slides.jsx'
import { toolsFor } from './tools/index.js'
import { flowItems, noteSteps, noteFlow, joinFlow } from './flow.js'
import { press } from './tools/press.js'
import Toolbox from './tools/toolbox.jsx'
import { citedIn, citeMap } from './tools/bib.jsx'
import { placeBack, placeSave } from './scrolled.js'
import { clearPins, lastEdit, marksOf, pinned, sawEdit, togglePin } from './pins.js'
import 'katex/dist/katex.min.css'
import 'racklist/rack.css'
import './note.css'
import { tr } from 'lilak-ui/i18n.jsx'

const VIEW_KEY = projectKey('nt', 'view')
/** Where a file a note embeds is served from. `note` is the tex note whose
 *  own folder to look in first (see the backend's `_files`); a markdown note
 *  passes nothing and reads the project's shared files folder. */
/** `\bibliography{reference}` — the file the document asks for, without its
 *  `.bib`. A document that does not say takes the name everyone writes. */
const BIB_AT = /\\bibliography\s*\{([^}]*)\}/g
const bibName = (body) => {
  const names = [...String(body || '').matchAll(BIB_AT)]
    .flatMap((m) => m[1].split(',').map((x) => x.trim()))
    .filter((x) => x && !x.startsWith('<'))      // the template's `<your bibdatabase>`
  return (names.length === 1 ? names[0] : 'reference').replace(/\.bib$/i, '')
}

/** Where this project keeps its notes and their files — asked once, since it
 *  is the same answer for every tab. */
const whereAsked = {}
const whereIs = (note = '') => (whereAsked[note] ||=
  ask(`/where${noteQ(note)}`).then((r) => r.body).catch(() => null))

const D = '·'
const tagsOf = (n) => (n.tags || []).filter(Boolean)
/** The people a note mentions, by the name author_manager shows them under —
 *  so `@이정우` and `@JungWooLee` are ONE value here however the note spells
 *  them, and a `@word` naming nobody is left as it was written. */
const peopleOf = (n) => [...new Set((n.authors || []).map((w) => authorShow(w) || w).filter(Boolean))]
/** The body as it renders: with its heading numbers, if the note has them on. */
const headed = (n) => (n.fields?.numbered ? numberHeadings(n.body) : n.body)
/** `format: tex` in the front matter — the note is a LaTeX document. */
const texNote = (n) => String(n?.fields?.format || '').toLowerCase() === 'tex'
/** The tags a body carries — and the body is the only place one lives.
 *  `#태그` is Obsidian's spelling, and markdown's own rule keeps it apart from
 *  a heading: `# ` has a space after the hash. */
export function bodyTags(body) {
  const out = []
  for (const m of outsideCode(body).matchAll(TAG_RE)) {
    if (!out.includes(m[2])) out.push(m[2])
  }
  return out
}
// A tag is the same tag whatever its case (`#spirit` is `#SpiRIT`), here and
// in every service that shares tags.
/** A tag lives in the body and nowhere else, so renaming one is an edit to the
 *  text: `#old` becomes `#new` wherever the tag rule says a tag starts. The
 *  character in front is kept — it is what made it a tag rather than part of a
 *  word, and `#oldish` is a different tag entirely. */
export function renameBodyTag(body, from, to) {
  return replaceOutsideCode(body, TAG_RE, (m, lead, name) =>
    (tagKey(name) !== tagKey(from) ? m : to ? `${lead}#${to}` : lead))
}

/** The todo without its tags: they have a column of their own, and a list of a
 *  hundred reads better when the sentence is the sentence. The note keeps them
 *  — this is what the table shows, not what is saved. */
/** A day as this app writes one. The browser's own, not UTC: a note saved at
 *  half past midnight was saved today. */
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The weekday in the title, in English and three letters whatever the
 *  language: a daily note's name is read in a file listing as often as on the
 *  screen, and `2026-11-04 (Wed)` sorts the same as `2026-11-04` did. */
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const dayName = (d) => `${day(d)} (${WDAY[d.getDay()]})`
/** When the FILE last changed. The list already carries it: `version` is the
 *  file's modification time in nanoseconds, which is what a save compares
 *  against — the date beside it is the one the note itself claims. */
const updatedOn = (n) => {
  const ms = Number(n.version) / 1e6
  return ms > 0 ? day(new Date(ms)) : ''
}

/** Urgent and not done: on top whatever the sort, and the mark before its text. */
const urgentNow = (t) => !!t.urgent && !t.done
const TODO_COLS = [
  { k: 'chk', w: 26, min: 26, fix: true },
  { k: 'num', w: 40, min: 30, fix: true, label: '#' },
  { k: 'text', w: 380, min: 120, label: tr("nt_todo") },
  { k: 'tags', w: 150, min: 60, label: 'tags' },
  { k: 'people', w: 130, min: 60, label: tr("nt_people"), drop: 1100 },
  { k: 'title', w: 200, min: 80, label: 'note' },
  { k: 'date', w: 100, min: 84, label: 'date' },
  { k: 'due', w: 100, min: 84, label: tr("nt_due") },
  { k: 'done', w: 100, min: 84, label: tr("nt_done") },
]
const TONE = { title: 'ink', text: 'ink', date: 'dim', updated: 'dim', tags: 'dim', people: 'dim', excerpt: 'dim' }

const TODO_SORTERS = {
  text: (t) => t.text || '', title: (t) => t.title || '', date: (t) => t.date || '',
  tags: Object.assign((t) => (t.tags || []).join(' '), { many: (t) => t.tags || [] }), done: (t) => t.doneAt || '',
  people: Object.assign((t) => peopleOf(t).join(', '), { many: peopleOf }),
  // A todo with no date is not due before everything that has one.
  due: (t) => t.due || '9999',
}

/** Which todos the tab shows. A list of things to do is mostly the ones not
 *  done; the done ones are a record, and both together are the whole note. */
/** Due, and not done: the only state a date makes urgent. */
const late = (t) => !t.done && !!t.due && t.due < new Date().toISOString().slice(0, 10)

/** A todo written with `#system` is one to do together with Claude, and has a
 *  tab of its own; every other todo is the person's own. */
const isSystemTodo = (t) => (t.tags || []).some((x) => tagKey(x) === 'system')

const TODO_SCOPES = [
  { k: 'open', label: tr("nt_open"), is: (t) => !t.done },
  { k: 'all', label: tr("nt_all"), is: () => true },
  { k: 'done', label: tr("nt_finished"), is: (t) => t.done },
]


/** project_manager's projects, handed to what `+` offers and draws — while
 *  rendering, not after: the page drawn in this same pass asks it. And
 *  author_manager's people, for `@`, which works the same way. */
function useProjectChoices() {
  const projects = useProjects()
  const people = useAuthors()
  useMemo(() => setProjChoices(projects.map((p) => p.name)), [projects])
  useMemo(() => setAuthorChoices(people), [people])
}

/** The tags `#` offers: every service's that shares them (note's own among
 *  them, by its entry project) and, where the caller has them, this list's —
 *  one written since the page opened is here before the others know it.
 *  A solo note has no list, so it offers the shared ones alone. */
function useTagChoices(own) {
  const tagSources = useTagSources()
  const shared = useMemo(() => tagCounts(tagSources.map((x) => x.tags)).map((x) => x.name), [tagSources])
  // A solo note is one note of THIS project, which the shared list may not
  // cover (it asks each service for its entry project). One request, and the
  // tags of the project the note is actually in.
  const [mine, setMine] = useState([])
  useEffect(() => {
    if (own) return undefined
    let alive = true
    ask('/tags')
      .then(({ body }) => { if (alive) setMine(tagCounts([body.tags]).map((x) => x.name)) })
      .catch(() => {})
    return () => { alive = false }
  }, [own])
  useEffect(() => { setTagChoices(uniqueTags([...shared, ...(own || mine)])) }, [shared, own, mine])
  return tagSources
}

/** A note is a file, behind note's own API — so the document the rack screen
 *  holds is the LIST of notes (/notes: title, date, tags, a first line…), and
 *  a save is turned back into what it means for the files. The rack screen only
 *  ever changes a note's tags (a merge, a rename, the star, the bulk editor) or
 *  drops notes (the bulk editor's delete); everything else is the note editor's.
 *  A tag lives in the body, so a tag change is an edit to the text: the ones
 *  gone are renamed into the one that came (a merge, a rename) or taken out,
 *  and one that is new and not in the text yet is added at the end. */
/** ★ is about the FILE, not about what is written in it, so it lives in the
 *  front matter (`favorite: true`) and not as a `#favorite` in the text. The
 *  kit's star reads it from a field of its own (`star`, NOTE_DEF.item.favorite)
 *  rather than from the tags — otherwise starring a note edits its words.
 *
 *  A `#favorite` already in the body still lights the star, and comes out of
 *  the text the first time the star is turned off: the notes migrate as they
 *  are touched rather than all at once. */
// As the FILE has it — the front matter, or an old `#favorite` in the text.
const wasStarred = (n) => !!n.fields?.favorite || tagsOf(n).some((t) => tagKey(t) === FAV)
// As the RECORD has it: the kit's star writes `star`, and loadNotes fills it
// from the file. One field, so a change is a comparison rather than a guess.
const starred = (n) => (Array.isArray(n?.star) ? n.star : []).some((t) => tagKey(t) === FAV)
async function loadNotes() {
  const { body } = await ask('/notes')
  return {
    notes: (body.notes || []).map((n) => ({ ...n, star: wasStarred(n) ? [FAV] : [] })),
    templates: body.templates || [],
    version: String(Date.now()),
  }
}
async function saveNotes(next, doc) {
  const was = new Map((doc.notes || []).map((n) => [n.id, n]))
  const now = new Map((next.notes || []).map((n) => [n.id, n]))
  for (const id of was.keys()) {
    if (now.has(id)) continue
    const r = await api(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`DELETE /notes/${id} → ${r.status}`)
  }
  const same = (a, b) => tagKey(a) === tagKey(b)
  // ★ first, and on its own: it is a key in the front matter, so it never
  // touches the text — except to take an old `#favorite` out of it.
  for (const [id, n] of now) {
    const old = was.get(id)
    if (!old || starred(old) === starred(n)) continue
    const { body: cur } = await ask(`/notes/${encodeURIComponent(id)}`)
    const fields = { ...(cur.fields || {}) }
    if (starred(n)) fields.favorite = true
    else delete fields.favorite
    const body = starred(n) ? undefined : renameBodyTag(cur.body, FAV, '').replace(/\s+$/, '')
    const { conflict } = await putNote(id, cur.version, { fields, ...(body === undefined ? {} : { body }) })
    if (conflict) return { conflict: true, doc: await loadNotes() }
  }
  for (const [id, n] of now) {
    const old = was.get(id)
    if (!old) continue
    const gone = tagsOf(old).filter((t) => !tagsOf(n).some((x) => same(x, t)))
    const came = tagsOf(n).filter((t) => !tagsOf(old).some((x) => same(x, t)))
    if (!gone.length && !came.length) continue
    const { body: cur } = await ask(`/notes/${encodeURIComponent(id)}`)
    const tex = texNote(n) || texNote(cur)
    let text = cur.body
    // A tex note's tag line is written again below, so it comes off first —
    // renaming inside it would leave the `%` standing on its own.
    if (tex) text = text.split('\n').filter((l) => !TAG_COMMENT.test(l)).join('\n')
    for (const g of gone) text = renameBodyTag(text, g, came.length === 1 ? came[0] : '')
    // A line that held only the tags taken out goes with them.
    const lines = String(cur.body || '').split('\n')
    text = text.split('\n').filter((l, i) => l.trim() || !lines[i]?.trim()).join('\n')
    if (tex) {
      // A LaTeX document cannot hold a bare `#`: it is TeX's macro parameter
      // character, and a `#태그` written into the document errors where it
      // lands ("You can't use `macro parameter character #' in vertical
      // mode"). So a tex note keeps its tags on ONE comment line at the end —
      // `% #a #b` — which LaTeX ignores and the tag rule still reads. It is
      // rewritten whole rather than edited: the record's tags are the truth,
      // and a tag the document already wears somewhere else is left where it
      // is rather than said twice.
      const body = text.replace(/\s+$/, '')
      const mine = tagsOf(n).filter((t) => !bodyTags(body).some((x) => same(x, t)))
      text = mine.length ? `${body}\n\n% ${mine.map((t) => `#${t}`).join(' ')}` : body
    } else {
      for (const t of came) if (!bodyTags(text).some((x) => same(x, t))) text = `${String(text || '').replace(/\n+$/, '')}\n\n#${t}`
    }
    // The server ends the file with one newline of its own.
    text = text.replace(/\s+$/, '')
    if (text === String(cur.body || '').replace(/\s+$/, '')) continue
    const { conflict } = await putNote(id, cur.version, { title: cur.title, body: text })
    if (conflict) return { conflict: true, doc: await loadNotes() }
  }
  return { doc: await loadNotes() }
}

const NOTE_DEF = {
  name: 'note', key: 'note', title: tr("nt_notes"), unit: tr("nt_unit"),
  source: { load: loadNotes, save: saveNotes },
  item: {
    key: 'notes', noun: tr("nt_noun"), label: 'title', tabId: 'notes', allLabel: tr('nt_tab_notes'),
    // ★ is the file's own property (`favorite:` in the front matter), carried
    // on a field of its own so the kit's star never edits the body's tags.
    favorite: 'star',
    findHint: tr("nt_find_hint"),
    order: { k: 'date', dir: -1 },
    // Made at once by the API (a file needs a name), then opened at its title.
    create: async () => {
      const { body } = await ask('/notes', { method: 'POST', body: JSON.stringify({ title: tr("nt_untitled"), template: null }) })
      FRESH.add(body.id)
      return { id: body.id, label: body.title }
    },
    // The list carries a first line, not the body — so the server looks inside.
    find: async (q) => {
      const { body } = await ask(`/search?q=${encodeURIComponent(q)}`)
      return new Map(body.hits.map((h) => [h.id, h.text]))
    },
    search: (n, q, ctx) => [n.title, n.date, n.excerpt, ...tagsOf(n), ...peopleOf(n), ...(n.authors || [])]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)) || !!ctx.hits?.has(n.id),
    fields: [
      // When the FILE last changed — first, because it is how you find what you
      // were doing. A whole 2026-08-04 at 15px is 90px wide, and the cell keeps
      // 6 either side.
      { k: 'updated', label: 'updated', get: updatedOn, col: { w: 106, min: 84 }, tone: 'dim' },
      { k: 'title', label: 'title', get: (n) => n.title || '', col: { w: 260, min: 100 }, tone: 'ink' },
      { k: 'tags', label: 'tags', type: 'tags', bulk: true, col: { w: 170, min: 60 }, tone: 'dim' },
      // Who the note mentions (`@이정우`). Like tags, it lives in the body and
      // nowhere else — so it is read, never edited here — and the filter
      // offers one row per person rather than the list as one string.
      { k: 'people', label: tr("nt_people"), get: (n) => peopleOf(n).join(`, `),
        many: peopleOf, col: { w: 150, min: 60, drop: 1100 }, tone: 'dim' },
      // The date the NOTE gives itself, which is about the note rather than
      // about the file — so it stands with what the note says, not with when
      // it was touched.
      { k: 'date', label: 'date', get: (n) => n.date || '', col: { w: 106, min: 84 }, tone: 'dim' },
      { k: 'todo', label: tr("nt_todo"), get: (n) => (n.todo ? `${n.todo}` : n.done ? '✓' : ''), col: { w: 52, min: 40 } },
      { k: 'words', label: 'words', get: (n) => (n.words ? `${n.words}` : ''), col: { w: 58, min: 40, drop: 1040 } },
      // While searching, the line the BODY matched on is more use than the first line.
      { k: 'excerpt', label: tr("nt_first_line"), get: (n, ctx) => ctx?.hits?.get(n.id) || n.excerpt || '',
        col: { w: 360, min: 120, drop: 1180 }, tone: 'dim' },
    ],
  },
  classes: [{ k: 'tags', label: tr('nt_tab_tags'), field: 'tags' }],
}
/** The compiled PDF, in a pane of this app.
 *
 *  The viewer is the browser's own (PDFium) and cannot be restyled, so its
 *  toolbar is turned off — the pane is too narrow to give its top half to one
 *  — and the buttons worth having are drawn in the rack's own row instead.
 *
 *  Zoom and fit come from the viewer's URL parameters, which cost nothing to
 *  use but are read only as the document LOADS. So changing one remounts the
 *  frame (`key`), and the PDF comes back from the browser's cache because its
 *  URL has not changed. What the viewer will not tell us is which page is on
 *  screen, so there are no page buttons: `btab` opens the whole viewer.
 */
const ZOOMS = [50, 75, 100, 125, 150, 200, 300]

function PdfPane({ t }) {
  // 'fit' is the width-fitting view a paper wants to open at; anything else is
  // a percentage from ZOOMS.
  const [zoom, setZoom] = useState('fit')
  const step = (d) => setZoom((z) => {
    // From 맞춤 the first press lands on 100% rather than past it: fitting the
    // width of a narrow pane is usually smaller than actual size, so stepping
    // from an imagined 100 would skip the one size a reader asks for by name.
    if (z === 'fit') return d > 0 ? 100 : ZOOMS[ZOOMS.indexOf(100) - 1]
    const i = ZOOMS.indexOf(z)
    return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + d))]
  })
  const frag = `#toolbar=0&navpanes=0&${zoom === 'fit' ? 'view=FitH' : `zoom=${zoom}`}`
  return (
    <div className="nt-pdfpane">
      <div className="nt-pdfbar">
        <span className="rl-hint">{t.label}</span>
        <span className="rl-sp" />
        <button type="button" className="rl-btn" title={tr("nt_pdf_out")}
          disabled={zoom === ZOOMS[0]} onClick={() => step(-1)}>−</button>
        {/* What it is at, and the way back to the width — one control, because
            a reading saying 맞춤 beside a button saying 맞춤 says it twice. */}
        <button type="button" className="rl-btn nt-pdfzoom" title={tr("nt_pdf_fit_hint")}
          disabled={zoom === 'fit'} onClick={() => setZoom('fit')}>
          {zoom === 'fit' ? tr("nt_pdf_fit") : `${zoom}%`}</button>
        <button type="button" className="rl-btn" title={tr("nt_pdf_in")}
          disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => step(1)}>+</button>
        <a className="rl-btn" href={t.src} target="_blank" rel="noreferrer">{tr("nt_tex_btab")}</a>
        <a className="rl-btn" href={t.src} download={`${t.who}.pdf`}>{tr("nt_tex_save")}</a>
      </div>
      <iframe key={frag} className="nt-pdf" src={t.src + frag} title={t.label} />
    </div>
  )
}

/** Whose notes the list shows, pressed round in turn: everything, the person's,
 *  the ones Claude sessions keep (`#agent`, `#agent/rack`). */
const hasTag = (tag) => (n) => tagsOf(n).some((t) => tagWithin(t, tag))
const isAgentNote = hasTag('agent')
const WHO_ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round' }
const WHO = [
  { k: 'all', is: () => true, label: () => tr("nt_who_all"), short: () => tr("nt_all"),
    icon: <path d="M5 7.5v6.5H2V7.5zM5 7.5 8.2 1.8c1 0 1.8.8 1.8 1.9V6.5h3.2c.9 0 1.5.8 1.3 1.7l-1 4.5c-.2.8-.8 1.3-1.6 1.3H5" /> },
  { k: 'people', is: (n) => !isAgentNote(n), label: () => tr("nt_who_people"), short: () => tr("nt_people"),
    icon: <><circle cx="8" cy="5" r="3" /><path d="M2.5 14.5C3.1 11.5 5.3 10 8 10s4.9 1.5 5.5 4.5" /></> },
  { k: 'agent', is: isAgentNote, label: () => tr("nt_who_agent"), short: () => tr("nt_short_agent"),
    icon: <><rect x="1.5" y="2.5" width="13" height="9" rx="1" /><path d="M8 11.5v3M5 14.5h6" /></> },
]
/** What kind of note, the same way round: everything, the `#daily`, the `#summary`.
 *  It adds to whose: a `#summary` is `#agent/summary` too, so "the person's" hides it. */
const KIND = [
  { k: 'all', is: () => true, label: () => tr("nt_kind_all"), short: () => tr("nt_all"),
    icon: <><path d="M3 1.5h7l3 3v10H3z" /><path d="M10 1.5v3h3" /></> },
  { k: 'daily', is: hasTag('daily'), label: () => tr("nt_kind_daily"), short: () => tr("nt_short_daily"),
    icon: <><rect x="1.5" y="3" width="13" height="11.5" rx="1" /><path d="M1.5 6.5h13M5 1.5V4M11 1.5V4" /></> },
  { k: 'summary', is: hasTag('summary'), label: () => tr("nt_kind_summary"), short: () => tr("nt_short_summary"),
    icon: <path d="M2 3.5h12M2 8h8M2 12.5h5" /> },
]
/** One of those, in the title bar: pressing it goes on to the next. */
function NoteCycle({ list, now, set }) {
  return (
    <button type="button" className={`rl-reload${now.k === 'all' ? '' : ' on'}`} title={now.label()}
      onClick={() => set(list[(list.indexOf(now) + 1) % list.length].k)}>
      <svg viewBox="0 0 16 16" aria-hidden="true" {...WHO_ICON}>{now.icon}</svg>
    </button>
  )
}
/** The same, in the open menu: every choice in sight. */
function NoteChoice({ list, now, set }) {
  return (
    <span className="rl-seg">
      {list.map((x) => (
        <button key={x.k} type="button" className={`rl-btn${x === now ? ' on' : ''}${x.short().length > 6 ? ' rl-seg-long' : ''}`} onClick={() => set(x.k)}>{x.short()}</button>
      ))}
    </span>
  )
}

/** Notes just made: their editor takes the caret at the title, once. */
const FRESH = new Set()

/** The tool a tab has open, handed to the note that takes its place: which
 *  tool is open belongs to the TAB, and `scrolled.js` keeps it under the note
 *  because a note is what a tab holds. */
const carryTools = (from, to) => {
  placeSave(`${to}:tab`, placeBack(`${from}:tab`) ?? '')
  placeSave(`${to}:was`, placeBack(`${from}:was`) ?? '')
}

/** The notes, listed by the kit's RackService as every rack service is — the
 *  table, the tags tab, the ⋯, the panes. What is a note's own is said here:
 *  the editor, a PDF, the to-dos, daily · templates · print. */
export default function App() {
  // What `#` and `+` offer in the editor.
  useTagChoices()
  useProjectChoices()
  const [tscope, setTscope] = useState(() => load(VIEW_KEY, {}).tscope || 'open')
  useEffect(() => { save(VIEW_KEY, { ...load(VIEW_KEY, {}), tscope }) }, [tscope])
  const [whoK, setWhoK] = useState(() => load(VIEW_KEY, {}).who || 'all')
  useEffect(() => { save(VIEW_KEY, { ...load(VIEW_KEY, {}), who: whoK }) }, [whoK])
  const who = WHO.find((x) => x.k === whoK) || WHO[0]
  const [kindK, setKindK] = useState(() => load(VIEW_KEY, {}).kind || 'all')
  useEffect(() => { save(VIEW_KEY, { ...load(VIEW_KEY, {}), kind: kindK }) }, [kindK])
  const kind = KIND.find((x) => x.k === kindK) || KIND[0]

  // A file dropped anywhere but the editor: the browser's own answer is to
  // leave the app and show the picture, which inside the portal's frame reads
  // as the service disappearing. The editor's handler runs first and marks the
  // drop as taken; what is left here is refused quietly.
  useEffect(() => {
    const stop = (e) => { if (!e.defaultPrevented && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault() }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  const slots = useMemo(() => ({
    commands: (a) => <button type="button" className="rl-btn rl-go" title={tr("nt_today_hint")} onClick={() => openDaily(a)}>daily</button>,
    show: (a) => <TodoScopes a={a} tscope={tscope} setTscope={setTscope} />,
    keep: (n) => who.is(n) && kind.is(n),
    keepOn: who.k !== 'all' || kind.k !== 'all',
    keepTools: () => (
      <>
        <NoteChoice list={KIND} now={kind} set={setKindK} />
        <NoteChoice list={WHO} now={who} set={setWhoK} />
      </>
    ),
    barTools: () => (
      <>
        <NoteCycle list={KIND} now={kind} set={setKindK} />
        <NoteCycle list={WHO} now={who} set={setWhoK} />
      </>
    ),
    tabs: [
      { id: 'todos', label: tr('nt_tab_todos'), render: (a) => <Todos a={a} tscope={tscope} who={who} kind={kind} /> },
      { id: 'system', label: tr('nt_tab_system'), render: (a) => <Todos a={a} tscope={tscope} who={who} kind={kind} system /> },
    ],
    editors: {
      item: (t, a) => (
        <Editor key={t.who} id={t.who} say={a.setNote} onSaved={a.reload}
          onOpenNote={(name) => {
            // `[[…]]` names a note by its file name or by its title.
            const k = name.toLowerCase()
            const n = (a.doc?.notes || []).find((x) => x.id.toLowerCase() === k)
              || (a.doc?.notes || []).find((x) => (x.title || '').toLowerCase() === k)
            if (n) a.openItem(n.id)
            else a.setNote(tr("nt_no_note", name))
          }}
          takeCaret={FRESH.has(t.who)} onCaret={() => FRESH.delete(t.who)}
          flow={{ notes: a.doc?.notes, open: (nid) => a.openItem(nid), reload: a.reload,
            step: (nid, title) => {
              // A step along the flow swaps the NOTE in this tab, so the tab
              // keeps what it was wearing: the toolbox was open at 흐름, and
              // shutting it to step is the editor jumping wider under the
              // hand that pressed. The toolbox is kept against the note
              // (scrolled.js), so the new note is given this one's.
              carryTools(t.who, nid)
              a.panes.step(t.id, { id: `item:${nid}`, kind: 'item', who: nid, label: title || nid })
            } }}
          onPdf={(nid, title, v) => {
            // A tab already open keeps what it was opened with, and the PDF
            // behind it has just changed — so the old one goes for the new one.
            a.closeEdit(`pdf:${nid}`)
            a.openEdit({ id: `pdf:${nid}`, kind: 'pdf', who: nid, label: `${title || nid}.pdf`,
              src: `${PORTAL_BASE}/api/pdf/${encodeURIComponent(nid)}?v=${v}` })
          }}
          onPrint={() => preview([t.who], a.setNote)}
          make={{
            // `daily` is the button beside the list, not a line in it.
            templates: (a.doc?.templates || []).filter((t) => t !== 'daily'),
            from: (template) => fromTemplate(a, template),
            daily: () => openDaily(a),
            save: (name, body) => saveTemplate(a, name, body),
          }}
          onClosed={() => { a.closeEdit(t.id); a.reload() }} />
      ),
      pdf: (t) => <PdfPane t={t} />,
    },
  }), [tscope, who, kind])

  return <RackService def={NOTE_DEF} slots={slots} />
}

/** The note as it reads, in a tab of its own — and that page is also what
 *  prints, because a PDF with Korean in it needs the system's fonts, which is
 *  the one thing a JS pdf library makes hard and a print dialog makes free. */
function preview(ids, say) {
  if (!ids.length) { say(tr("nt_pick_note")); return }
  openTab(`${PORTAL_BASE}/?print=${ids.join(',')}`)
}

/** A new note from a template, made and opened. Parked in the toolbox's
 *  `공용`: nothing uses templates now, and `templates/` is a folder, so the
 *  one place it could go without a store behind it is beside the note. */
async function fromTemplate(a, template) {
  try {
    const { body } = await ask('/notes', { method: 'POST', body: JSON.stringify({ title: tr("nt_untitled"), template }) })
    await made(a, body, tr("nt_made_from_template", template))
  } catch (e) { a.setNote(String(e.message || e)) }
}

/** A note made (from a template, or today's) and opened. */
async function made(a, body, said) {
  await a.reload()
  FRESH.add(body.id)
  a.openEdit({ id: `item:${body.id}`, kind: 'item', who: body.id, label: body.title || body.id })
  a.setNote(said)
}

/** Today's note, under the name it always has. One a day: if today's is
 *  already there this opens it instead of making a second one, and a template
 *  called `daily` is used when there is one.
 *
 *  Two places press this — the ⋯ menu and the toolbox's `공용` — because it is
 *  the one template that gets used, so it is a button and not a list entry. */
async function openDaily(a) {
  const now = new Date()
  const title = `Daily ${dayName(now)}`
  // Found by the DATE, not the whole title: the notes made before the weekday
  // was part of the name are still that day's note, and a second one would be
  // the one thing this button exists to prevent.
  const had = (a.doc?.notes || []).find((n) => (n.title || '').startsWith(`Daily ${day(now)}`))
  if (had) { a.openItem(had.id); a.setNote(tr("nt_opened", title)); return }
  try {
    const template = (a.doc?.templates || []).includes('daily') ? 'daily' : null
    const { body } = await ask('/notes', { method: 'POST', body: JSON.stringify({ title, template }) })
    // The tag lives in the body, like every other tag here.
    if (!bodyTags(body.body).includes('daily')) {
      await putNote(body.id, body.version,
        { title, body: body.body ? `${body.body.replace(/\n+$/, '')}\n\n#daily` : '#daily' })
    }
    await made(a, { ...body, title }, tr("nt_made_named", title))
  } catch (e) { a.setNote(String(e.message || e)) }
}

/** This note's text, kept in `templates/` under a name. */
async function saveTemplate(a, name, body) {
  await ask('/templates', { method: 'POST', body: JSON.stringify({ name, body }) })
  await a.reload()
  a.setNote(tr("nt_tmpl_saved", name))
}

/** note's own line in the ⋯: today's note, and, on the to-dos tab, which of
 *  them it shows. Printing and templates live in the toolbox (`공용`). */
function TodoScopes({ a, tscope, setTscope }) {
  return (a.tab?.id === 'todos' || a.tab?.id === 'system') && TODO_SCOPES.map((x) => (
    <button key={x.k} type="button" data-keep className={`rl-btn${tscope === x.k ? ' on' : ''}`}
      onClick={() => setTscope(x.k)}>{x.label}</button>
  ))
}

/** The to-dos: every GFM checkbox in every note, read by the server. A press
 *  ticks one (an edit to its note's text); a right-click opens the note. */
function Todos({ a, tscope, who, kind, system = false }) {
  const [todos, setTodos] = useState(null)
  const [sort, setSort] = useState([{ k: 'date', dir: -1 }])
  // This table's own columns, at whatever width they were last dragged to —
  // `t:` keeps them apart from the notes table's, which has a `tags` column too.
  const cols = a.colsOf('t:', TODO_COLS)
  const reload = useCallback(() => ask('/todos').then(({ body }) => setTodos(body.todos)).catch((e) => a.setNote(String(e.message || e))), [])   // eslint-disable-line react-hooks/exhaustive-deps
  // Read again whenever the notes are — a note saved may have ticked one.
  useEffect(() => { reload() }, [reload, a.doc])
  // `cut` is how many this tab HAS that a filter is holding back — an empty
  // table that says "write `- [ ] 할 일`" when there are 24 of them behind the
  // 누구의 노트 button is telling the reader the wrong thing to do.
  const { rows, cut } = useMemo(() => {
    const q = (a.query || '').trim().toLowerCase()
    const keep = (TODO_SCOPES.find((x) => x.k === tscope) || TODO_SCOPES[0]).is
    // A todo goes by the note it is in: its own tags say what it is, not whose.
    const shown = new Set((a.doc?.notes || []).filter((n) => who.is(n) && kind.is(n)).map((n) => n.id))
    const mine = (todos || []).filter((t) => isSystemTodo(t) === system).filter(keep)
    const out = mine.filter((t) => shown.has(t.id))
      .filter((t) => !q || [t.text, t.title, ...(t.tags || []), ...peopleOf(t)].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .sort((x, y) => urgentNow(y) - urgentNow(x) || byKeys(sort, TODO_SORTERS)(x, y))
    return { rows: out, cut: mine.length - out.length }
  }, [todos, a.query, tscope, sort, system, who, kind, a.doc])
  async function toggle(t) {
    try {
      const { conflict, body } = await ask('/todos', { method: 'PUT',
        body: JSON.stringify({ id: t.id, line: t.line, done: !t.done, text: t.text }) })
      if (conflict) a.setNote(body.detail || tr("nt_note_changed"))
      await a.reload()
    } catch (e) { a.setNote(String(e.message || e)) }
  }
  if (!todos) return <p className="rl-msg">{tr("nt_loading")}</p>
  return (
    <RackTable cols={cols} onDrag={a.drag('t:')} sort={sort} onSort={(k) => setSort((s) => bumpSort(s, k))}>
      {rows.map((t, i) => (
        <RackRow key={`${t.id}:${t.line}`} cols={cols} tone={TONE}
          className={`rl-hit${t.done ? ' rl-done' : ''}${late(t) ? ' nt-late' : ''}`}
          title={tr("nt_todo_hint")}
          onClick={() => toggle(t)}
          onContextMenu={(e) => { e.preventDefault(); a.openItem(t.id) }}
          cell={{
            chk: <input type="checkbox" checked={t.done} aria-label={t.text}
              onChange={() => toggle(t)} onClick={(e) => e.stopPropagation()} />,
            num: i + 1,
            text: <>{urgentNow(t) && <b className="nt-urgent">!!</b>}{untagged(t.text.replace(URGENT_RE, '$1')) || D}</>,
            title: (
              <button type="button" className="rl-lnk"
                onClick={(e) => { e.stopPropagation(); a.openItem(t.id) }}>{t.title}</button>
            ),
            date: t.date || D,
            tags: (t.tags || []).join(' ') || D,
            people: peopleOf(t).join(', ') || D,
            due: t.due || D,
            done: t.doneAt || D,
          }} />
      ))}
      {rows.length === 0 && (
        <p className="rl-msg">{!cut ? tr(system ? "nt_no_system_todos" : "nt_no_todos")
          : who.k !== 'all' ? tr("nt_todos_who", cut, who.label())
          : kind.k !== 'all' ? tr("nt_todos_kind", cut, kind.label())
          : tr("nt_todos_find", cut)}</p>
      )}
    </RackTable>
  )
}

// ─── One note ───────────────────────────────────────────────────────────────
/** Only the two things a person writes — and the file keeps a last newline the
 *  editor does not, which is not a change anyone made. Everything else (the
 *  version, the date) comes back from the server on every save and would read
 *  as one. */
const sameNote = (a, b) => a.title === b.title && (a.date || '') === (b.date || '')
  && JSON.stringify(a.fields || {}) === JSON.stringify(b.fields || {})
  && String(a.body || '').trimEnd() === String(b.body || '').trimEnd()
const putNote = (id, baseVersion, v) => ask(`/notes/${encodeURIComponent(id)}`, {
  method: 'PUT',
  body: JSON.stringify({ baseVersion, title: v.title, date: v.date, body: v.body,
    fields: v.fields }),
})

/** The note is read when the tab opens, not from the list — the list carries a
 *  first line, and this needs the file. */
/** ?solo=<id>: one note's editor and nothing else — what another service
 *  opens as a tab of its own (an activity's note, beside the activity). Its
 *  cancel has no list to go back to; a note deleted here says so. */
export function SoloNote({ id }) {
  // Opened inside another service, this window is the whole app: what `#` and
  // `+` offer has to be asked for here too, since there is no list to do it.
  useTagChoices()
  useProjectChoices()
  const [said, say] = useState('')
  const [gone, setGone] = useState(false)
  // Framed in another service, close is that service's tab closing (rackClose).
  const closed = () => {
    if (window.parent !== window) window.parent.postMessage({ rackClose: { was: id } }, window.location.origin)
    ask(`/notes/${encodeURIComponent(id)}`).catch(() => setGone(true))
  }
  // Its flow is read from the list here (there is no list beside it); a step
  // is this page showing the other note.
  const [notes, setNotes] = useState(null)
  const reload = useCallback(() => { ask('/notes').then(({ body }) => setNotes(body.notes || [])).catch(() => {}) }, [])
  useEffect(() => { reload() }, [reload])
  const to = (nid, title) => {
    const u = new URL(window.location.href)
    u.searchParams.set('solo', nid)
    // Framed in another service (an activity's note): the tab over there is
    // showing THIS address, and it is the address a refresh draws again. So
    // the tab is told to step with us — otherwise the frame walks on and the
    // tab it lives in stays pointed at the note it was opened with.
    if (window.parent !== window) {
      window.parent.postMessage({ rackStep: { was: id, id: nid, label: title, src: u.pathname + u.search } },
        window.location.origin)
    }
    window.location.replace(u)
  }
  return (
    <div className="rl nt-solo" style={brandStyle()}>
      {gone ? <p className="rl-msg">{tr("nt_deleted")}</p> : (
        <Editor id={id} say={say} onClosed={closed} onSaved={reload}
          flow={notes ? { notes, reload, open: to, step: to } : null}
          onPrint={() => openTab(`${PORTAL_BASE}/?print=${encodeURIComponent(id)}`)} />
      )}
      {said && <div className="rl-hint nt-solo-note">{said}</div>}
    </div>
  )
}

/** A bookmark ribbon: what the line column is DOING.
 *
 *  Filled, the numbers bookmark: press one and that line is kept. Hollow,
 *  they navigate: press one and the view goes there and leaves nothing
 *  behind. One switch at the head of the column, because a click on a number
 *  had to mean one thing or the other and there was no way to say which. */
const Ribbon = ({ on }) => (
  <svg viewBox="0 0 16 16" width="12" height="13" aria-hidden="true">
    <path d="M4 2.5h8v11l-4-3.2-4 3.2z" fill={on ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

// ─── the modes ──────────────────────────────────────────────────────────────
/**
 * What a note is being edited AS.
 *
 * A mode is two things at once: how the text is shown, and what the file IS.
 * `format: tex` in the front matter is a fact about the document rather than a
 * way of looking at it, which is why LaTeX stands in the same list instead of
 * in a checkbox somewhere else — picking a mode is picking what you are
 * editing.
 *
 * A mode has a KIND, and the kind is what tools are for (`tools/`): `md` is
 * the two ways of looking at markdown, `tex` is a LaTeX document. The mode
 * does not list its tools — each tool says which kinds it appears for, so a
 * new tool is a file and a line in `tools/index.js`, not an edit here.
 */
const MODES = {
  live: { kind: 'md', label: () => 'MD', paint: true },
  raw: { kind: 'md', label: () => tr("nt_raw") },
  slide: { kind: 'md', label: () => tr("nt_slide"), paint: true },
  tex: { kind: 'tex', label: () => 'LaTeX', hint: () => tr("nt_tex"), format: 'tex' },
}

// A next note being made (flow.js): one at a time, whichever editor asked.
let following = false
function Editor({ id, say, onSaved, onClosed, onPrint, takeCaret, onCaret, onOpenNote, onPdf, make, flow: notes }) {
  const [n, setN] = useState(null)
  const [f, setF] = useState(null)
  const [where, setWhere] = useState(null)   // the folders, once a tool asks
  // Which markdown mode: live (the text with the markdown drawn over it) or
  // raw (the text alone). A tex note is neither — its mode is the format.
  // Kept with the place (scrolled.js) for the same reason the scroll is:
  // moving the pane builds this editor again, and coming back to `라이브`
  // when you were reading is the same lost place by another name.
  const [picked, setView] = useState(() => placeBack(`${id}:view`) || 'live')
  // A deck is a fact about the note, written with it (`mode: slide`), so it is
  // still a deck after a reload and on the next machine.
  const view = f?.fields?.mode === 'slide' ? 'slide' : picked
  useEffect(() => { placeSave(`${id}:view`, view) }, [id, view])
  // A slide note: where the renderer cut it, and whether it is being shown.
  const [pages, setPages] = useState([])
  const [showing, setShowing] = useState(null)       // the slide it started on
  // Which tool is open, '' for shut. The toolbox belongs to THIS tab: moving
  // to another takes it away with this editor, and that tab opens and shuts
  // its own. Kept with the rest of where-you-were (scrolled.js).
  const [tab, setTab] = useState(() => placeBack(`${id}:tab`) || '')
  useEffect(() => { placeSave(`${id}:tab`, tab); if (tab) placeSave(`${id}:was`, tab) }, [id, tab])
  // What the toolbox hangs off: this editor's own box. It is drawn OVER the
  // pane next door, not inside this one, so it measures rather than flows.
  const root = useRef(null)
  // How far the toolbox pushes the editor over, when it had nowhere beside
  // the pane to stand (a full-width tab). 0 the rest of the time — covering
  // the list is free, covering the text is not.
  const [push, setPush] = useState(0)
  // The editor itself, for `edit` below: a tool changes the document through
  // that and never touches CodeMirror.
  const cm = useRef(null)
  /** What a tool may do to the DOCUMENT, and the whole of it. Each call is one
   *  transaction, so one undo takes it back — a tool is not allowed to leave a
   *  mess that takes five presses to clear. */
  const edit = useMemo(() => {
    const now = () => cm.current
    return {
      /** At the caret, replacing what is selected. */
      put(text) {
        const v = now()
        if (!v) return
        const r = v.state.selection.main
        v.dispatch({ changes: { from: r.from, to: r.to, insert: text },
          selection: { anchor: r.from + text.length }, scrollIntoView: true })
        v.focus()
      },
      /** Something that is a LINE and not a word — a picture, a file. It goes
       *  on a line of its own under the caret's, and the caret goes PAST it.
       *
       *  `put` would drop it wherever the caret happens to be, and the caret
       *  in a live note is often inside the markup of a picture already there
       *  (`![[a.png]]`), which the new name then cuts in half: both pictures
       *  gone, and the only sign of it a line of text where one of them was.
       *  Left ON the new line it would be no better — the caret's line is
       *  drawn as the markup it IS, so the picture would not appear until you
       *  pressed an arrow key. And a selection is left alone: pressing a
       *  picture in the files tool is not an edit to whatever is selected. */
      block(text) {
        const v = now()
        if (!v) return
        const line = v.state.doc.lineAt(v.state.selection.main.head)
        const insert = (line.text.trim() ? '\n' : '') + (text.endsWith('\n') ? text : `${text}\n`)
        v.dispatch({ changes: { from: line.to, insert },
          selection: { anchor: line.to + insert.length }, scrollIntoView: true })
        v.focus()
      },
      /** Round what is selected — `**` and `**`, `\\textbf{` and `}`. The same
       *  function ⌘B is bound to (liveedit.js), so they cannot disagree. */
      wrap(before, after = before) {
        const v = now()
        if (!v) return
        wrapSel(v, before, after)
        v.focus()
      },
      /** Over the lines the selection touches: return the line as it should
       *  be, or anything else to leave it alone. */
      lines(fn) {
        const v = now()
        if (!v) return
        const r = v.state.selection.main
        const changes = []
        for (let n = v.state.doc.lineAt(r.from).number; n <= v.state.doc.lineAt(r.to).number; n += 1) {
          const line = v.state.doc.line(n)
          const next = fn(line.text, n)
          if (typeof next === 'string' && next !== line.text) {
            changes.push({ from: line.from, to: line.to, insert: next })
          }
        }
        if (changes.length) v.dispatch({ changes })
        v.focus()
      },
      at: () => { const v = now(); return v ? v.state.doc.lineAt(v.state.selection.main.head).number : 0 },
      text: () => now()?.state.doc.toString() ?? '',
    }
  }, [])
  // What is in the note's folder, for the files tab (`/api/files`).
  const [files, setFiles] = useState(null)
  // Lines bookmarked in this note, and the line last typed in (pins.js). Both
  // are read from the store rather than kept only here, because the editor is
  // built again every time the pane moves and the bookmarks are not.
  const [pins, setPins] = useState(() => pinned(id))
  const [last, setLast] = useState(() => lastEdit(id))
  // Where a bookmark button is sending the editor: the line, and a nonce so
  // that pressing the same one twice goes there twice.
  const [go, setGo] = useState(null)
  // How wide the gutter's numbers are, so the title bar can carry the column
  // up to itself and have it line up. Told only when it changes (SourceArea).
  const [gut, setGut] = useState(0)
  // The note as it READS, in place of the editor. A markdown note's one
  // other way of being looked at — the 공용 tool holds the switch, because
  // that is where the note itself is described.
  const [read, setRead] = useState(() => !!placeBack(`${id}:sheet`))
  useEffect(() => { placeSave(`${id}:sheet`, read) }, [id, read])
  // Are this note's `%` lines folded (comments.js)? Kept with the rest of
  // where-you-were: a pane moving sideways is no reason to unfold them.
  const [fold, setFold] = useState(() => !!placeBack(`${id}:fold`))
  useEffect(() => { placeSave(`${id}:fold`, fold) }, [id, fold])
  // What a click on a line number does: leave a bookmark, or go there. Kept
  // with the rest of where-you-were (scrolled.js) — it is a way of working,
  // and the pane moving sideways is no reason to put the pen down.
  const [marking, setMarking] = useState(() => !!placeBack(`${id}:mark`))
  useEffect(() => { placeSave(`${id}:mark`, marking) }, [id, marking])
  // The line typed into the jump bar's box, digits only.
  const [num, setNum] = useState('')
  // The line this editor opens at — read ONCE, when the tab opens, because it
  // is about arriving rather than about the list as it stands.
  const openAt = useRef(marksOf(id).at(-1) || 0).current
  // What the fold shows and what the gutter marks: the bookmarks, or — until
  // there is one — the line last edited, held as a bookmark the note made.
  const marks = pins.length ? pins : [last].filter(Boolean)
  const gutter = useMemo(() => ({ lines: marks, tmp: !pins.length }), [marks.join(), pins.length])   // eslint-disable-line react-hooks/exhaustive-deps

  const orig = useRef(null)                  // how the tab found it — revert
  // `format: tex` in the front matter: this note is a LaTeX document, not
  // markdown. The backend keeps unknown front-matter keys as they are, so the
  // flag costs nothing there — the editor reads it and changes language, and
  // the note's files get a folder of their own (`files/<id>/`), because LaTeX
  // names a plain `fig1.pdf` that the compile copies next to main.tex.
  const tex = texNote(f)
  // The mode this note is in, and what it can do (MODES above). A tex note is
  // in its format's mode whatever `view` says; a markdown note is in the one
  // it is being looked at in.
  const mode = tex ? 'tex' : view
  const can = MODES[mode] || MODES.live
  const isDeck = view === 'slide' && !tex
  const deckH = slideH(f?.fields?.ratio)
  // Which slide a line is on, and going to one: to the top of the box.
  const slideOf = (ln) => pages.reduce((at, p, i) => (i && p.from <= ln ? i : at), 0)
  const toSlide = (i, quiet = false) => {
    const n = Math.max(0, Math.min(pages.length - 1, i))
    const p = pages[n]
    if (p) setGo({ line: n ? p.from : 1, flush: gapBefore(pages, n), quiet, n: Date.now() })
    return n
  }
  // `<<` `>>`: from the slide in front of you, or the one still being glided
  // to when the button is pressed again in the middle of the glide.
  const heading = useRef({ at: 0, until: 0 })
  const stepSlide = (by) => {
    const from = Date.now() < heading.current.until ? heading.current.at : viewing()
    heading.current = { at: toSlide(from + by, true), until: Date.now() + 400 }
  }
  // The slide in front of you: the caret's if you are typing and it is on
  // screen, or else the one at the top of the box.
  const viewing = () => {
    const v = cm.current
    if (!v) return 0
    const { head } = v.state.selection.main
    const at = v.coordsAtPos(head)
    const box = v.scrollDOM.getBoundingClientRect()
    const pos = v.hasFocus && at && at.top >= box.top && at.bottom <= box.bottom ? head : v.lineBlockAtHeight(v.scrollDOM.scrollTop + 8).to
    return slideOf(v.state.doc.lineAt(pos).number)
  }
  const startShow = () => { enterFull(); setShowing(viewing()) }
  const [errs, setErrs] = useState(null)      // what stopped the last compile
  const [busy, setBusy] = useState(false)
  // When this note's PDF was made (nanoseconds, the backend's `_pdf_at`), or
  // '' for none. It says both things worth knowing: whether there is a PDF to
  // open, and whether it is still this note — its stamp against the note
  // file's own (`version`). It comes from the SERVER rather than from what
  // this tab remembers, because opening the PDF beside the text replaces this
  // editor in its pane: coming back builds a new one, which remembers nothing.
  const [pdfAt, setPdfAt] = useState('')
  // What the last zip import brought in, shown once and dismissed. Not stored
  // on the note: it describes an act, not the document.
  const [imp, setImp] = useState(null)
  // The cite keys this note's own .bib defines — what a `\cite{}` will
  // actually resolve when it compiles. reference_manager's library is the
  // other half of the menu, and the two are not the same thing: a key only
  // the library has will still come out of the PDF as a `?`.
  const [bib, setBib] = useState([])
  // The record made from this note just now: `useReferences` read the library
  // once, so without this the paper you have just created still reads as a
  // key that names nothing.
  const [made, setMade] = useState(null)
  // What a `.bib 맞추기` would write, worked out and SHOWN before it writes:
  // the file it would land on already holds someone's bibliography, and the
  // keys reference_manager has never heard of are the ones worth seeing.
  const [plan, setPlan] = useState(null)
  // Which paper this document IS — reference_manager's record, named by the
  // cite key, which is both what `\cite{…}` writes and what reads as a word
  // in the file. The key is stored; the record behind it is looked up, so a
  // key that names nothing simply has nothing to open.
  const references = useReferences()
  // Asked again after an import, which is what brings a .bib in.
  useEffect(() => {
    if (!tex) { setBib([]); return }
    ask(`/bib/${encodeURIComponent(id)}`).then(({ body }) => setBib(body.keys || [])).catch(() => setBib([]))
  }, [id, tex, imp])   // eslint-disable-line react-hooks/exhaustive-deps
  // The menu is the editor module's, not a prop: the same shape the tag and
  // project menus use. The bib's keys are marked, so they can be offered first
  // and checked against the body.
  useEffect(() => setCiteChoices(!tex ? [] : [
    ...bib.map((c) => ({ ...c, bib: true })),
    ...references.filter((r) => !bib.some((c) => c.key === r.citeKey))
      .map((r) => ({ key: r.citeKey, title: r.title, bib: false })),
  ]), [tex, bib, references])
  const pdfUrl = (frame) => `${PORTAL_BASE}/api/pdf/${encodeURIComponent(id)}?v=${pdfAt}`
    // No toolbar inside our own tab — the pane is small and the browser's bar
    // is half of it. A browser tab gets the whole viewer, which is the point
    // of opening one.
    + (frame ? '#toolbar=0&navpanes=0' : '')
  // The folders (공용 names them). Asked once per note — `whereIs` answers
  // every tab of it from the same promise.
  useEffect(() => { whereIs(tex ? id : '').then(setWhere) }, [id, tex])
  /** What is in the note's folder. Asked when the tab opens and after
   *  anything puts a file there — an import, an upload, a generated .bib. */
  // `null` not asked yet · `false` asked and could not be read · [] the folder
  // is empty. The three are different things and the tool says so — read as
  // "empty", a folder that failed had the note pointing at files that are not
  // there, which was a lie about the note. (A backend too old for /api/files
  // answers 200 with the SPA's own HTML, which is how this was found.)
  const seeFiles = useCallback(() => {
    ask(`/files${noteQ(tex ? id : '')}`).then(({ body }) => setFiles(body.files || []))
      .catch(() => setFiles(false))
  }, [id, tex])
  useEffect(() => { seeFiles() }, [seeFiles, imp])
  const live = useRef({})                    // the latest, for the last save
  const titleRef = useRef(null)
  live.current = { f, n }
  useEffect(() => {
    let alive = true
    setN(null)
    ask(`/notes/${encodeURIComponent(id)}`)
      .then(({ body }) => {
        if (!alive) return
        setN(body); setF(body); orig.current = body
        // A note compiled in an earlier sitting still has its PDF.
        setPdfAt(body.pdf_at || '')
      })
      .catch((e) => say(String(e.message || e)))
    return () => { alive = false }
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  // The note saves itself a moment after you stop typing. A keystroke is not a
  // decision worth confirming, and a note that is only on screen is a note you
  // can lose; what you can still undo is the whole sitting, with revert.
  useEffect(() => {
    if (!f || !n || sameNote(f, n)) return
    const t = setTimeout(() => { saveNote() }, 800)
    return () => clearTimeout(t)
  }, [f, n])   // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the tab inside that moment must not drop the last sentence.
  useEffect(() => () => {
    const { f: cur, n: disk } = live.current
    if (cur && disk && !sameNote(cur, disk)) putNote(id, disk.version, cur).then(() => onSaved?.())
  }, [id])
  // A note just opened: the caret goes to its title. A name the app chose is
  // selected (type over it); one a person wrote is left alone, caret at the
  // end. In an EFFECT, not in the fetch's `then`: the field does not exist
  // until React has drawn the loaded note, and a focus aimed at a ref that is
  // still null is a focus that silently does not happen.
  useEffect(() => {
    if (!takeCaret || !n) return
    const el = titleRef.current
    if (!el) return
    el.focus()
    // Untitled in this language, or in Korean (notes made before English existed).
    if (n.title === tr("nt_untitled") || n.title === '제목 없음') el.select()
    else el.setSelectionRange(el.value.length, el.value.length)
    onCaret?.()
  }, [takeCaret, n])   // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘S saves the note you are in, wherever the caret is. ABOVE the early
  // return: a hook that only runs once the note has loaded is a hook the first
  // render did not have, and React drops the whole tree over it (#310) — which
  // is a blank pane, not a missing shortcut.
  useRackKeys({ onSave: () => { if (f && n) saveNote() } })

  // ↑ EVERY hook belongs above this line: the note is read after the editor is
  // first drawn, so this return happens on the first render and React counts
  // the hooks it saw. A useState added below it is a blank screen.
  if (!f || !n) return <p className="rl-msg">{tr("nt_loading")}</p>
  const dirty = !sameNote(f, n)
  // How many lines there are, for `맨 뒤` and for the box: a line nobody has
  // is not a place, so every jump is clamped to the document.
  const lines = f.body.split('\n').length
  const jump = (ln) => ln >= 1 && setGo({ line: Math.min(ln, lines), n: Date.now() })
  // Nothing has changed since the PDF was made: compiling again would spend
  // ten seconds writing the same file. Both stamps are nanoseconds, past what
  // a number holds exactly.
  const asPdf = !dirty && !!pdfAt && BigInt(pdfAt) > BigInt(n.version || 0)
  // Tags live in the BODY now (#태그), so this is what the note will carry the
  // moment it is saved — shown rather than edited.
  const tags = bodyTags(f.body)
  // A zip REPLACES the body, so it is only offered where there is nothing to
  // lose: a tex note still empty. That one rule makes dropping a zip safe too
  // — the dangerous case cannot be reached by accident — and re-importing
  // means clearing the note first, which is the same decision said out loud.
  const empty = !f.body.trim()
  const refKey = String(f.fields?.reference || '').trim()
  const ref = !refKey ? null
    : references.find((r) => r.citeKey === refKey) || (made?.citeKey === refKey ? made : null)
  // Keys the body cites that this note's bib does not define: each one is a
  // `?` in the PDF. Checked only when there IS a bib — a note without one
  // has nothing to be measured against, not a hundred mistakes.
  const missing = !tex || !bib.length ? [] : citeMap(f.body, bib).loose.map((c) => c.key)
  // What a shut panel still has to say. A compile that failed and a `\cite{}`
  // nothing answers are both things worth knowing while writing, and both now
  // live inside a tab — so the button wears a dot and its title says why.
  const flag = [
    errs?.length ? tr("nt_flag_errs", errs.length) : '',
    missing.length ? tr("nt_flag_cites", missing.length) : '',
  ].filter(Boolean)


  /** This manuscript, as a paper in reference_manager. The key is the one
   *  typed in the cite box — not a key rule worked out here, because the rule
   *  is reference_manager's and a second opinion about cite keys is how two
   *  records of one paper happen. */
  async function makeRef() {
    setBusy(true)
    try {
      const { ref: made, had } = await addReference({
        citeKey: refKey, title: f.title || '', type: 'paper',
        year: String(f.date || '').slice(0, 4), note: tr("nt_ref_from_note"),
      })
      // `useReferences` asked once and cached; this one is known here until
      // the next load, so the link opens without a reload.
      setMade(made)
      say(had ? tr("nt_ref_had", made.citeKey) : tr("nt_ref_made", made.citeKey))
    } catch (e) {
      say(String(e.message || e) === 'reference_manager' ? tr("nt_ref_no_svc") : String(e.message || e))
    } finally { setBusy(false) }
  }

  /** The .bib this note needs, out of reference_manager.
   *
   *  Two sources, and their union: every key the BODY cites — which is what
   *  has to resolve for the PDF not to print a `?` — and the reference list of
   *  the paper this note IS, if it has one, which is the bookkeeping the
   *  library keeps. An entry that is in the file but never cited costs
   *  nothing; bibtex prints what is cited. */
  async function planBib() {
    setBusy(true)
    try {
      const doc = await referenceDoc()
      if (!doc) { say(tr("nt_ref_no_svc")); return }
      const want = new Set(citedIn(f.body).map((c) => c.key))
      const key = (r) => String(r?.citeKey || '').trim()
      const mine = refKey ? (doc.references || []).find((r) => key(r) === refKey) : null
      for (const c of mine?.cites || []) {
        const r = c?.ref && (doc.references || []).find((x) => x.id === c.ref)
        if (key(r)) want.add(key(r))
      }
      const have = (doc.references || []).filter((r) => want.has(key(r)))
      setPlan({
        doc, have, name: `${bibName(f.body)}.bib`, cited: mine ? (mine.cites || []).length : 0,
        gone: [...want].filter((k) => !have.some((r) => key(r) === k)),
      })
    } catch (e) { say(String(e.message || e)) } finally { setBusy(false) }
  }

  async function writeBib() {
    setBusy(true)
    try {
      const text = bibText(plan.doc, plan.have)
      await putFile(new File([text], plan.name, { type: 'text/plain' }), id, true)
      setPlan(null)
      if (tab === 'files') seeFiles()
      const { body } = await ask(`/bib/${encodeURIComponent(id)}`)
      setBib(body.keys || [])     // so the missing-cite line answers at once
      say(tr("nt_bib_written", plan.name, plan.have.length))
    } catch (e) { say(String(e.message || e)) } finally { setBusy(false) }
  }
  async function saveNote() {
    const { conflict, body } = await putNote(id, n.version, f)
    if (conflict) {
      say(body.detail || tr("nt_changed_elsewhere"))
      setN(body.current); setF(body.current)
      return
    }
    // Only what is on disk: `f` is what is being typed, and a save that lands
    // mid-sentence must not take the caret back with it.
    setN(body)
    live.current = { ...live.current, n: body }   // a close right after: nothing left for the last save
    onSaved?.()
  }
  /** The note, typeset. It compiles what is ON DISK, so what is being typed
   *  is saved first — otherwise the PDF is of the note as it was. */
  async function compile() {
    setBusy(true)
    try {
      if (dirty) await saveNote()
      const { body } = await ask(`/compile/${encodeURIComponent(id)}`, { method: 'POST' })
      setErrs(body.ok ? null : (body.errors || []))
      if (!body.ok) return
      setPdfAt(body.pdf_at || '')
      onPdf?.(id, f.title, body.pdf_at || '')
    } catch (e) {
      say(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }
  /** A LaTeX manuscript zip becomes THIS note: main.tex as the body, the rest
   *  in the note's own files folder, the paths in the body rewritten to match.
   *  The server does all of it and hands back the note it wrote — so what is
   *  on screen is what is on disk, and revert still holds the note as this tab
   *  found it. */
  async function importZip(file) {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('f', file)
      const r = await fetch(`${PORTAL_BASE}/api/import/${encodeURIComponent(id)}`,
        { method: 'POST', headers: authHeaders(), body: form })
      const body = await r.json()
      if (!r.ok) throw new Error(body.detail || tr("nt_upload_failed", r.status))
      setN(body); setF(body)
      setErrs(null); setPdfAt(body.pdf_at || '')
      setImp(body)
      // Which paper this manuscript IS cannot be read out of the zip — its own
      // .bib holds what it cites, not itself. So the fold opens on the cite box.
      if (!String(body.fields?.reference || '').trim()) setTab('bib')
    } catch (e) {
      say(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    await ask(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
    say(tr("nt_deleted_named", n.title))
    onClosed?.(id)
  }


  // ── the note's flow (flow.js) ─────────────────────────────────────────────
  // `notes` (from whoever shows this editor): the list, step(id, title) — this
  // tab shows that note instead — open(id), reload(). The list is as saved;
  // this note is read as it stands in the form.
  const items = notes?.notes ? flowItems(notes.notes, { id, ...f }) : null
  const steps = items && noteSteps(items, id)
  const titleOf = (s) => items?.find((x) => x.id === s?.id)?.title || ''
  const stepTo = (s, dir) => (
    <button type="button" className="rl-btn" disabled={!s} title={s ? `${titleOf(s)} · ${s.day}` : ''}
      {...press(() => notes.step(s.id, titleOf(s)))}>{dir < 0 ? '‹' : '›'}</button>
  )
  const setChain = (v) => setF((st) => {
    const fields = { ...(st.fields || {}) }
    if (v) fields.chain = v
    else delete fields.chain
    return { ...st, fields }
  })
  const flowTool = !items ? null : {
    members: noteFlow(items, id).map((x) => ({ id: x.id, title: x.title, date: x.date })),
    here: id,
    own: !!f.fields?.chain,
    // Any other note, newest first — the tool searches this itself and shows
    // what it found, so it is the notes rather than a list of labels.
    others: [...items].filter((x) => x.id !== id).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    step: (nid, title) => notes.step(nid, title),
    out: () => setChain(''),
    // Up or down the flow. The order IS the days, so moving a note trades days
    // with the one it passes — which is also the only thing that could be
    // meant by "put this one first": it was written first. Two notes of the
    // same day have nothing to trade, and the tool greys the arrow out.
    move: async (nid, dir) => {
      const line = noteFlow(items, id)
      const i = line.findIndex((x) => x.id === nid)
      const a = line[i], b = line[i + dir]
      if (!a || !b || a.date === b.date) return
      try {
        for (const [x, date] of [[a, b.date], [b, a.date]]) {
          // This note is the one being edited: its date belongs to the form,
          // and writing the file under it would throw away everything else
          // unsaved. The other note is saved where it lies.
          if (x.id === id) { setF((st) => ({ ...st, date })); continue }
          const { body } = await ask(`/notes/${encodeURIComponent(x.id)}`)
          await putNote(x.id, body.version, { ...body, date })
        }
        notes.reload?.()
      } catch (e) { say(String(e.message || e)) }
    },
    // In the flow `t` is in — `t` given it too if it was in none (it is saved
    // here, read fresh, so its own edits are kept).
    put: async (t) => {
      const { flow: to, mark } = joinFlow(items, t)
      try {
        if (mark) {
          const { body } = await ask(`/notes/${encodeURIComponent(t.id)}`)
          await putNote(t.id, body.version, { ...body, fields: { ...(body.fields || {}), chain: to } })
        }
        setChain(to)
        notes.reload?.()
      } catch (e) { say(String(e.message || e)) }
    },
    // A new note after this one, in its flow (named after this note if it was in none).
    follow: async () => {
      if (following) return        // a second press while the first is making it
      following = true
      const { flow: to, mark } = joinFlow(items, items.find((x) => x.id === id))
      try {
        if (mark) setChain(to)
        const { body } = await ask('/notes', { method: 'POST', body: JSON.stringify({ title: f.title }) })
        await putNote(body.id, body.version, { ...body, fields: { ...(body.fields || {}), chain: to } })
        notes.reload?.()
        notes.open(body.id)
      } catch (e) { say(String(e.message || e)) } finally { following = false }
    },
  }

  // ── what a tool is given (tools/index.js) ───────────────────────────────
  // Built here because it is all about THIS note; the tools themselves are
  // files that know nothing but this.
  const kit = toolsFor(can.kind)
  const Tool = kit.find((t) => t.id === tab) || kit[0]
  const ctx = {
    note: { id, title: f.title, body: f.body, date: f.date, fields: f.fields, tex, dirty },
    setNote: setF,
    edit,
    go: jump,
    print: onPrint,
    say,
    ask,
    keep: { pins, last, marks, setPins, clear: () => { setPins(clearPins(id)); setGo(null) } },
    flow: flowTool,
    where,
    tags,
    words: f.body.split(/\s+/).filter(Boolean).length,
    fold: { on: fold, set: setFold },
    read: { on: read, set: setRead },
    numbered: {
      on: !!f.fields?.numbered,
      set: (on) => setF((st) => {
        const fields = { ...(st.fields || {}) }
        if (on) fields.numbered = true
        else delete fields.numbered
        return { ...st, fields }
      }),
    },
    slide: isDeck ? {
      show: startShow,
      ratio: f.fields?.ratio,
      setRatio: (ratio) => setF((st) => ({ ...st, fields: { ...(st.fields || {}), ratio } })),
    } : null,
    // The note's folder — both kinds have one, so it is not tex's.
    files,
    seeFiles,
    // Making a note, which is not about THIS note — the toolbox is simply
    // the only field grid note has.
    // Making a note, which is not about THIS note — except `save`, which is
    // this note's text under a template's name.
    make: !make ? null : { ...make, save: (name) => make.save(name, f.body) },
    // ponytail: still Editor's state, handed down. It moves into a hook of
    // its own when something other than these three tools wants it.
    tex: !tex ? null : {
      busy, errs, pdfAt, asPdf, compile, empty, importZip, imp, setImp,
      // The stamp is nanoseconds; what is worth reading is the clock time.
      madeAt: pdfAt ? new Date(Number(pdfAt) / 1e6).toLocaleString() : '',
      refKey, references, ref, makeRef, plan, setPlan, planBib, writeBib, missing, keys: bib,
      rtab: onPdf ? () => onPdf(id, f.title, pdfAt) : null,
      btab: () => openTab(pdfUrl(false)),
    },
  }

  return (
    <div className="nt-edit" ref={root}
      style={!push ? undefined : push.side === 'left' ? { paddingLeft: push.px } : { paddingRight: push.px }}>
      {/* The buttons sit above the title: everything below them is the note.
          The same bar every editor in every rack-list service wears. */}
      {/* The note saves itself, and closing it keeps what is there. */}
      <RackActions key={id}
        pending={dirty}
        // Saved first: a note framed in another service closes with its frame,
        // and a page that is gone sends nothing.
        onClose={async () => { if (dirty) await saveNote(); onClosed?.(id) }} closeLast
        extra={<>
          {/* One choice, not a row of buttons that have to agree with each
              other. What it picks is the MODE (see MODES): three of these are
              ways of writing markdown and the fourth says the file is a LaTeX
              document. What the mode can DO is the buttons after it. */}
          <select className="rl-in nt-mode" value={mode} aria-label={tr("nt_mode")}
            onChange={(e) => {
              const v = e.target.value
              setF((st) => {
                const fields = { ...(st.fields || {}) }
                if (MODES[v].format) fields.format = MODES[v].format
                else delete fields.format
                if (v === 'slide') fields.mode = 'slide'
                else delete fields.mode
                return { ...st, fields }
              })
              if (!MODES[v].format) setView(v)
              // A tool belongs to the kind that has it: leaving for a kind
              // without this tool puts the column away rather than leaving it
              // open on something the note no longer is.
              if (tab && !toolsFor(MODES[v].kind).some((t) => t.id === tab)) setTab('')
            }}>
            {Object.entries(MODES).map(([k, m]) => (
              <option key={k} value={k} title={m.hint?.()}>{m.label()}</option>
            ))}
          </select>
          {isDeck ? <button type="button" className="rl-btn" title={tr("nt_show_hint")} {...press(startShow)}>{tr("nt_show_btn")}</button> : null}
          {/* Every tool behind ONE button. The dot is the only thing a shut
              toolbox still says: something inside it wants reading. */}
          <button type="button" className={`rl-btn${tab ? ' on' : ''}`} aria-expanded={!!tab}
            title={flag.join(' · ') || tr("nt_manage_hint")}
            {...press(() => setTab(tab ? '' : (placeBack(`${id}:was`) || kit[0].id)))}>
            {tr("nt_manage")}{flag.length && !tab ? <i className="nt-dot">●</i> : null}
          </button>
        </>}
        after={/* The note before and after this one in its flow. It walks the
          TAB to another note rather than doing anything to the note in hand,
          so it stands after close rather than among that note's own buttons. */
        steps ? (<>
          {stepTo(steps.prev, -1)}
          <span className="rl-hint" title={tr('nt_flow_at')}>{steps.at}/{steps.total}</span>
          {stepTo(steps.next, 1)}
        </>) : null}
        onDelete={remove}
        deleteWarn={tr("nt_delete_warn")} />

      {/* Reading, the sheet carries the title and the date itself. */}
      {/* One line: the title, its tags, and the fold — a button with a word on
          it, big enough to hit — which opens the date and the file's name below. */}
      {isDeck ? <DeckMeasure body={headed(f)} h={deckH} onPages={setPages} /> : null}
      {showing != null ? <SlideShow title={f.title} body={headed(f)} pages={pages} h={deckH} start={showing} onClose={() => setShowing(null)} /> : null}
      <div className="nt-work">
        <div className="nt-main">
              <div className="nt-titlerow" style={gut ? { '--nt-gut': `${gut}px` } : undefined}>
            {/* The line column, carried up to the title bar. What stands at the
                top of it is the number the caret is in, and it is clicked for the
                same thing every other number in that column is clicked for:
                bookmark this line, and again to take it off. */}
            <button type="button" className={`nt-linetop${marking ? ' on' : ''}`}
              aria-pressed={marking} aria-label={tr(marking ? "nt_mark_on" : "nt_mark_off")}
              title={tr(marking ? "nt_mark_on" : "nt_mark_off")}
              {...press(() => setMarking(!marking))}>
              <Ribbon on={marking} />
            </button>
            {marking ? (
              /* Bookmark mode takes the title's PLACE rather than finding room
                 beside it: in this mode the line is what you are naming, not the
                 note. The two ends, the line last typed in, every bookmark, and —
                 last — a box for a line nobody bookmarked. */
              <span className="nt-jump">
                {isDeck ? (<>
                  <button type="button" className="rl-btn" title={tr("nt_slide_prev")} aria-label={tr("nt_slide_prev")} {...press(() => stepSlide(-1))}>{'<<'}</button>
                  <button type="button" className="rl-btn" title={tr("nt_slide_next")} aria-label={tr("nt_slide_next")} {...press(() => stepSlide(1))}>{'>>'}</button>
                </>) : null}
                <button type="button" className="rl-btn" {...press(() => jump(1))}>{tr("nt_jump_top")}</button>
                <button type="button" className="rl-btn" {...press(() => jump(lines))}>{tr("nt_jump_end")}</button>
                {last && !pins.includes(last) ? (
                  <button type="button" className="rl-btn nt-pin-go nt-pin-tmp" title={tr("nt_pin_last")}
                    {...press(() => jump(last))}>{last}</button>
                ) : null}
                {pins.map((ln) => (
                  <button key={ln} type="button" className="rl-btn nt-pin-go" title={tr("nt_pin_go", ln)}
                    {...press(() => jump(ln))}>{ln}</button>
                ))}
                {pins.length ? (
                  <button type="button" className="rl-btn" title={tr("nt_pin_clear_hint")}
                    {...press(() => { setPins(clearPins(id)); setGo(null) })}>{tr("nt_pin_clear")}</button>
                ) : null}
                {/* A form, so the Enter key is the `go` button and neither has to
                    be told about the other. */}
                <form className="nt-goto" onSubmit={(e) => {
                  e.preventDefault()
                  const to = parseInt(num, 10)
                  if (isDeck) { if (to >= 1) toSlide(to - 1) } else jump(to)
                }}>
                  <input className="rl-in nt-gotoin" inputMode="numeric" value={num} title={tr(isDeck ? "nt_slide_at_hint" : "nt_jump_hint")}
                    placeholder={tr(isDeck ? "nt_slide_at" : "nt_jump_at")} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} />
                  <button type="submit" className="rl-btn">{tr("nt_jump_go")}</button>
                </form>
              </span>
            ) : (
              <input className="nt-title" ref={titleRef} value={f.title} placeholder={tr("nt_title")}
                onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} />
            )}
          </div>
          {/* Reading, in place of the text — the same sheet the print page
              draws. Everything else about the tab stays where it was, tools
              and all, so it is one press back. */}
          {read && !tex && view !== 'slide' ? (
            <div className="nt-read" ref={(el) => { if (el) el.scrollTop = placeBack(`${id}:read`) || 0 }}
              onScroll={(e) => placeSave(`${id}:read`, e.currentTarget.scrollTop)}>
              <article className="nt-sheet">
                <h1>{f.title}</h1>
                <p className="nt-meta">{f.date}</p>
                <Rendered>{headed(f)}</Rendered>
              </article>
            </div>
          ) : (<>
          {/* The file as it is on disk: nothing is written back. `원문` shows
              the text with its line numbers; `MD` paints the markdown over it
              and keeps the marks on the line the caret is in. Either way what
              is saved is what is typed, character for character. */}
          <SourceArea key={`${view}${tex}${!!f.fields?.numbered}`} live={view !== 'raw'} tex={tex} at={id}
            numbered={!!f.fields?.numbered}
            deck={isDeck ? { pages, title: f.title, h: deckH } : null}
            pins={gutter} goto={go} openAt={openAt}
            onGutter={setGut}
            // A number pressed means whichever the ribbon says it means.
            onPin={(ln) => (isDeck ? toSlide(slideOf(ln)) : marking ? setPins(togglePin(id, ln))
              : setGo({ line: ln, n: Date.now() }))}
            onEdit={(ln) => { sawEdit(id, ln); setLast(ln) }}
            fileSrc={(name) => fileSrc(name, tex ? id : '')} onOpenNote={onOpenNote}
            onFiles={(file) => (
              // A zip dropped on an empty tex note is a manuscript arriving,
              // not an attachment: the same import the button does. Anywhere
              // else it is just a file, stored and linked like any other.
              tex && empty && /\.zip$/i.test(file.name)
                ? importZip(file).then(() => null)
                : putFile(file, tex ? id : '')
                  .then((name) => { seeFiles(); return name })
                  .catch((e) => { say(String(e.message || e)); return null }))}
            value={f.body} onChange={(v) => setF((s) => ({ ...s, body: v }))} hold={cm} fold={tex && fold} />
          </>)}
        </div>
      </div>
      {/* Hanging off the side of this tab, drawn over whatever is beside it —
          nothing is resized to make room (tools/toolbox.jsx). */}
      {tab ? (
        <Toolbox anchor={root} kit={kit} at={Tool} ctx={ctx}
          onPick={setTab} onShut={() => setTab('')} onPush={setPush} />
      ) : null}
    </div>
  )
}

// ─── Reading ────────────────────────────────────────────────────────────────
// ─── Printing ───────────────────────────────────────────────────────────────
/** The notes, rendered as a document and handed to the browser's printer —
 *  which is also its PDF writer, with the system's fonts, which is the whole
 *  reason not to carry a PDF library and a 10MB Korean font. */
export function PrintView({ ids }) {
  const [notes, setNotes] = useState(null)
  // No dialog of its own: this is the note as it reads, and printing is one of
  // the things you may then do with it.
  useEffect(() => {
    Promise.all(ids.map((id) => ask(`/notes/${encodeURIComponent(id)}`).then((r) => r.body)))
      .then(setNotes)
      .catch(() => setNotes([]))
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!notes) return <p className="nt-print-msg">{tr("nt_loading")}</p>
  if (!notes.length) return <p className="nt-print-msg">{tr("nt_read_failed")}</p>
  return (
    <div className="nt-print">
      <div className="nt-print-bar">
        <button type="button" onClick={() => window.print()}>{tr("nt_print_save_pdf")}</button>
        <span>{tr("nt_print_hint")}</span>
      </div>
      {notes.map((n) => (
        <article key={n.id} className="nt-sheet">
          <h1>{n.title}</h1>
          {/* The tags are in the body, drawn as tags — repeating them here
              would be the same words twice. */}
          <p className="nt-meta">
            {n.date}
            {Object.entries(n.fields || {}).map(([k, v]) => ` · ${k}: ${v}`)}
          </p>
          <Rendered>{headed(n)}</Rendered>
        </article>
      ))}
    </div>
  )
}
