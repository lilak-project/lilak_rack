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
import { Children, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RackService, RackTable, RackRow, RackActions, useRackKeys, bumpSort, byKeys, PORTAL_BASE, brandStyle,
  projectKey, load, authHeaders, tagKey, mergeTags as tagCounts, useTagSources, uniqueTags, useProjects,
  useReferences, openInService, save,
} from 'racklist'
// The same renderer elog writes its logs with: GFM (so `- [ ]` is a checkbox)
// and one newline means one line break, because a note is typed, not typeset.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { remarkSoftBreaks } from 'lilak-ui/log/Markdown.jsx'
import { TAG_RE, PROJ_RE, EMBED_RE, embedSpec, isImage, setTagChoices, setProjChoices, setCiteChoices, isProject } from './marks.js'
import SourceArea from './SourceArea.jsx'
import 'katex/dist/katex.min.css'
import 'racklist/rack.css'
import './note.css'
import { tr } from 'lilak-ui'

const VIEW_KEY = projectKey('nt', 'view')
/** Where a file a note embeds is served from. `note` is the tex note whose
 *  own folder to look in first (see the backend's `_files`); a markdown note
 *  passes nothing and reads the project's shared files folder. */
/** `\cite{a,b}`, `\citep[see][]{c}` — the keys a tex note's body calls for. */
const CITE_IN_TEXT = /\\[a-zA-Z]*cite[a-zA-Z]*(?:\[[^\]]*\])*\{([^}]*)\}/g
const noteQ = (note) => (note ? `?note=${encodeURIComponent(note)}` : '')
const fileSrc = (name, note) => `${PORTAL_BASE}/api/file/${encodeURIComponent(name)}${noteQ(note)}`
/** A file dropped into a note: stored beside the notes, named back. Not `api`
 *  — a multipart body writes its own content type, boundary and all. */
async function putFile(file, note) {
  const form = new FormData()
  form.append('f', file)
  const r = await fetch(`${PORTAL_BASE}/api/file${noteQ(note)}`, { method: 'POST', headers: authHeaders(), body: form })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || tr("nt_upload_failed", r.status))
  return (await r.json()).name
}
const api = (p, o) => fetch(`${PORTAL_BASE}/api${p}`, {
  ...o, headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(o?.headers || {}) },
})
async function ask(p, o) {
  const r = await api(p, o)
  if (r.status === 409) return { conflict: true, body: await r.json() }
  if (!r.ok) throw new Error(`${o?.method || 'GET'} ${p} → ${r.status}`)
  return { body: await r.json() }
}

/** Where this project keeps its notes and their files — asked once, since it
 *  is the same answer for every tab. */
const whereAsked = {}
const whereIs = (note = '') => (whereAsked[note] ||=
  ask(`/where${noteQ(note)}`).then((r) => r.body).catch(() => null))

const D = '·'
const tagsOf = (n) => (n.tags || []).filter(Boolean)
/** The tags a body carries — and the body is the only place one lives.
 *  `#태그` is Obsidian's spelling, and markdown's own rule keeps it apart from
 *  a heading: `# ` has a space after the hash. */
export function bodyTags(body) {
  const out = []
  for (const m of String(body || '').matchAll(TAG_RE)) {
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
  return String(body || '').replace(TAG_RE, (m, lead, name) =>
    (tagKey(name) !== tagKey(from) ? m : to ? `${lead}#${to}` : lead))
}

/** The todo without its tags: they have a column of their own, and a list of a
 *  hundred reads better when the sentence is the sentence. The note keeps them
 *  — this is what the table shows, not what is saved. */
/** A day as this app writes one. The browser's own, not UTC: a note saved at
 *  half past midnight was saved today. */
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** When the FILE last changed. The list already carries it: `version` is the
 *  file's modification time in nanoseconds, which is what a save compares
 *  against — the date beside it is the one the note itself claims. */
const updatedOn = (n) => {
  const ms = Number(n.version) / 1e6
  return ms > 0 ? day(new Date(ms)) : ''
}

const untagged = (text) => String(text || '')
  .replace(TAG_RE, (m, lead) => lead)
  .replace(/\s{2,}/g, ' ')
  .trim()

const TODO_COLS = [
  { k: 'chk', w: 26, min: 26, fix: true },
  { k: 'num', w: 40, min: 30, fix: true, label: '#' },
  { k: 'text', w: 380, min: 120, label: tr("nt_todo") },
  { k: 'tags', w: 150, min: 60, label: 'tags' },
  { k: 'title', w: 200, min: 80, label: 'note' },
  { k: 'date', w: 100, min: 84, label: 'date' },
  { k: 'due', w: 100, min: 84, label: tr("nt_due") },
  { k: 'done', w: 100, min: 84, label: tr("nt_done") },
]
const TONE = { title: 'ink', text: 'ink', date: 'dim', updated: 'dim', tags: 'dim', excerpt: 'dim' }

const TODO_SORTERS = {
  text: (t) => t.text || '', title: (t) => t.title || '', date: (t) => t.date || '',
  tags: (t) => (t.tags || []).join(' '), done: (t) => t.doneAt || '',
  // A todo with no date is not due before everything that has one.
  due: (t) => t.due || '9999',
}

/** Which todos the tab shows. A list of things to do is mostly the ones not
 *  done; the done ones are a record, and both together are the whole note. */
/** Due, and not done: the only state a date makes urgent. */
const late = (t) => !t.done && !!t.due && t.due < new Date().toISOString().slice(0, 10)

const TODO_SCOPES = [
  { k: 'open', label: tr("nt_open"), is: (t) => !t.done },
  { k: 'all', label: tr("nt_all"), is: () => true },
  { k: 'done', label: tr("nt_finished"), is: (t) => t.done },
]


/** project_manager's projects, handed to what `+` offers and draws — while
 *  rendering, not after: the page drawn in this same pass asks it. */
function useProjectChoices() {
  const projects = useProjects()
  useMemo(() => setProjChoices(projects.map((p) => p.name)), [projects])
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
async function loadNotes() {
  const { body } = await ask('/notes')
  return { notes: body.notes || [], templates: body.templates || [], version: String(Date.now()) }
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
  for (const [id, n] of now) {
    const old = was.get(id)
    if (!old) continue
    const gone = tagsOf(old).filter((t) => !tagsOf(n).some((x) => same(x, t)))
    const came = tagsOf(n).filter((t) => !tagsOf(old).some((x) => same(x, t)))
    if (!gone.length && !came.length) continue
    const { body: cur } = await ask(`/notes/${encodeURIComponent(id)}`)
    let text = cur.body
    for (const g of gone) text = renameBodyTag(text, g, came.length === 1 ? came[0] : '')
    // A line that held only the tags taken out goes with them.
    const lines = String(cur.body || '').split('\n')
    text = text.split('\n').filter((l, i) => l.trim() || !lines[i]?.trim()).join('\n')
    for (const t of came) if (!bodyTags(text).some((x) => same(x, t))) text = `${String(text || '').replace(/\n+$/, '')}\n\n#${t}`
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
  // No rackstore behind it: no trash of the kit's (a note deleted is a file gone).
  trash: false,
  source: { load: loadNotes, save: saveNotes },
  item: {
    key: 'notes', noun: tr("nt_noun"), label: 'title', tabId: 'notes', allLabel: 'notes',
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
    search: (n, q, ctx) => [n.title, n.date, n.excerpt, ...tagsOf(n)]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)) || !!ctx.hits?.has(n.id),
    fields: [
      // A whole 2026-08-04 at 15px is 90px wide, and the cell keeps 6 either side.
      { k: 'date', label: 'date', get: (n) => n.date || '', col: { w: 106, min: 84 }, tone: 'dim' },
      // When the FILE last changed, beside the date the note gives itself.
      { k: 'updated', label: 'updated', get: updatedOn, col: { w: 106, min: 84 }, tone: 'dim' },
      { k: 'title', label: 'title', get: (n) => n.title || '', col: { w: 260, min: 100 }, tone: 'ink' },
      { k: 'tags', label: 'tags', type: 'tags', bulk: true, col: { w: 170, min: 60 }, tone: 'dim' },
      { k: 'todo', label: tr("nt_todo"), get: (n) => (n.todo ? `${n.todo}` : n.done ? '✓' : ''), col: { w: 52, min: 40 } },
      { k: 'words', label: 'words', get: (n) => (n.words ? `${n.words}` : ''), col: { w: 58, min: 40, drop: 1040 } },
      // While searching, the line the BODY matched on is more use than the first line.
      { k: 'excerpt', label: tr("nt_first_line"), get: (n, ctx) => ctx?.hits?.get(n.id) || n.excerpt || '',
        col: { w: 360, min: 120, drop: 1180 }, tone: 'dim' },
    ],
  },
  classes: [{ k: 'tags', label: 'tags', field: 'tags' }],
}
/** Notes just made: their editor takes the caret at the title, once. */
const FRESH = new Set()

/** The notes, listed by the kit's RackService as every rack service is — the
 *  table, the tags tab, the ⋯, the panes. What is a note's own is said here:
 *  the editor, a PDF, the to-dos, daily · templates · print. */
export default function App() {
  // What `#` and `+` offer in the editor.
  useTagChoices()
  useProjectChoices()
  const [tscope, setTscope] = useState(() => load(VIEW_KEY, {}).tscope || 'open')
  useEffect(() => { save(VIEW_KEY, { ...load(VIEW_KEY, {}), tscope }) }, [tscope])

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
    commands: (a) => <NoteCommands a={a} tscope={tscope} setTscope={setTscope} />,
    tabs: [{ id: 'todos', label: 'todos', render: (a) => <Todos a={a} tscope={tscope} /> }],
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
          onPdf={(nid, title, v) => {
            // A tab already open keeps what it was opened with, and the PDF
            // behind it has just changed — so the old one goes for the new one.
            a.closeEdit(`pdf:${nid}`)
            a.openEdit({ id: `pdf:${nid}`, kind: 'pdf', who: nid, label: `${title || nid}.pdf`,
              src: `${PORTAL_BASE}/api/pdf/${encodeURIComponent(nid)}?v=${v}` })
          }}
          onPrint={() => preview([t.who], a.setNote)}
          onClosed={() => { a.closeEdit(t.id); a.reload() }} />
      ),
      // The browser's own PDF viewer with its bar turned off — the pane is too
      // small to give half of it to a toolbar. Save it, or open it in a browser
      // tab where the whole viewer is.
      pdf: (t) => (
        <div className="nt-pdfpane">
          <div className="nt-pdfbar">
            <span className="rl-hint">{t.label}</span>
            <span className="rl-sp" />
            <a className="rl-btn" href={t.src} target="_blank" rel="noreferrer">{tr("nt_tex_btab")}</a>
            <a className="rl-btn" href={t.src} download={`${t.who}.pdf`}>{tr("nt_tex_save")}</a>
          </div>
          <iframe className="nt-pdf" src={`${t.src}#toolbar=0&navpanes=0`} title={t.label} />
        </div>
      ),
    },
  }), [tscope])

  return <RackService def={NOTE_DEF} slots={slots} />
}

/** The note as it reads, in a tab of its own — and that page is also what
 *  prints, because a PDF with Korean in it needs the system's fonts, which is
 *  the one thing a JS pdf library makes hard and a print dialog makes free. */
function preview(ids, say) {
  if (!ids.length) { say(tr("nt_pick_note")); return }
  window.open(`${PORTAL_BASE}/?print=${ids.join(',')}`, '_blank', 'noopener')
}

/** A note made (from a template, or today's) and opened. */
async function made(a, body, said) {
  await a.reload()
  FRESH.add(body.id)
  a.openEdit({ id: `item:${body.id}`, kind: 'item', who: body.id, label: body.title || body.id })
  a.setNote(said)
}

/** note's own line in the ⋯: today's note, a template, print what is picked —
 *  and, on the to-dos tab, which of them it shows. */
function NoteCommands({ a, tscope, setTscope }) {
  const notes = a.doc?.notes || []
  const templates = a.doc?.templates || []
  /** Today's note, under the name it always has. One a day: if today's is
   *  already there this opens it instead of making a second one, and a
   *  template called `daily` is used when there is one. */
  async function openDaily() {
    const title = `Daily ${day(new Date())}`
    const had = notes.find((n) => n.title === title)
    if (had) { a.openItem(had.id); a.setNote(tr("nt_opened", title)); return }
    try {
      const template = templates.includes('daily') ? 'daily' : null
      const { body } = await ask('/notes', { method: 'POST', body: JSON.stringify({ title, template }) })
      // The tag lives in the body, like every other tag here.
      if (!bodyTags(body.body).includes('daily')) {
        await putNote(body.id, body.version,
          { title, body: body.body ? `${body.body.replace(/\n+$/, '')}\n\n#daily` : '#daily' })
      }
      await made(a, { ...body, title }, tr("nt_made_named", title))
    } catch (e) { a.setNote(String(e.message || e)) }
  }
  async function fromTemplate(template) {
    try {
      const { body } = await ask('/notes', { method: 'POST', body: JSON.stringify({ title: tr("nt_untitled"), template }) })
      await made(a, body, tr("nt_made_from_template", template))
    } catch (e) { a.setNote(String(e.message || e)) }
  }
  return (
    <>
      <button type="button" className="rl-btn rl-go" title={tr("nt_today_hint")} onClick={openDaily}>daily</button>
      {!!templates.length && (
        /* A template is a note in templates/ — so this list is a folder
           listing, not a feature with a store behind it. */
        <select className="rl-btn rl-go rl-pick" value=""
          onChange={(e) => { if (e.target.value) fromTemplate(e.target.value) }}>
          <option value="">{tr("nt_from_template")}</option>
          {templates.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      <button type="button" className="rl-btn" disabled={!a.picked.size}
        onClick={() => preview([...a.picked], a.setNote)}>{tr("nt_preview_n", a.picked.size)}</button>
      {a.tab?.id === 'todos' && TODO_SCOPES.map((x) => (
        <button key={x.k} type="button" data-keep className={`rl-btn${tscope === x.k ? ' on' : ''}`}
          onClick={() => setTscope(x.k)}>{x.label}</button>
      ))}
    </>
  )
}

/** The to-dos: every GFM checkbox in every note, read by the server. A press
 *  ticks one (an edit to its note's text); a right-click opens the note. */
function Todos({ a, tscope }) {
  const [todos, setTodos] = useState(null)
  const [sort, setSort] = useState([{ k: 'date', dir: -1 }])
  const reload = useCallback(() => ask('/todos').then(({ body }) => setTodos(body.todos)).catch((e) => a.setNote(String(e.message || e))), [])   // eslint-disable-line react-hooks/exhaustive-deps
  // Read again whenever the notes are — a note saved may have ticked one.
  useEffect(() => { reload() }, [reload, a.doc])
  const rows = useMemo(() => {
    const q = (a.query || '').trim().toLowerCase()
    const keep = (TODO_SCOPES.find((x) => x.k === tscope) || TODO_SCOPES[0]).is
    return (todos || []).filter(keep)
      .filter((t) => !q || [t.text, t.title, ...(t.tags || [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .sort(byKeys(sort, TODO_SORTERS))
  }, [todos, a.query, tscope, sort])
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
    <RackTable cols={TODO_COLS} sort={sort} onSort={(k) => setSort((s) => bumpSort(s, k))}>
      {rows.map((t, i) => (
        <RackRow key={`${t.id}:${t.line}`} cols={TODO_COLS} tone={TONE}
          className={`rl-hit${t.done ? ' rl-done' : ''}${late(t) ? ' nt-late' : ''}`}
          title={tr("nt_todo_hint")}
          onClick={() => toggle(t)}
          onContextMenu={(e) => { e.preventDefault(); a.openItem(t.id) }}
          cell={{
            chk: <input type="checkbox" checked={t.done} aria-label={t.text}
              onChange={() => toggle(t)} onClick={(e) => e.stopPropagation()} />,
            num: i + 1,
            text: untagged(t.text) || D,
            title: (
              <button type="button" className="rl-lnk"
                onClick={(e) => { e.stopPropagation(); a.openItem(t.id) }}>{t.title}</button>
            ),
            date: t.date || D,
            tags: (t.tags || []).join(' ') || D,
            due: t.due || D,
            done: t.doneAt || D,
          }} />
      ))}
      {rows.length === 0 && <p className="rl-msg">{tr("nt_no_todos")}</p>}
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
  const closed = () => { ask(`/notes/${encodeURIComponent(id)}`).catch(() => setGone(true)) }
  return (
    <div className="rl nt-solo" style={brandStyle()}>
      {gone ? <p className="rl-msg">{tr("nt_deleted")}</p> : (
        <Editor id={id} say={say} onClosed={closed}
          onPrint={() => window.open(`${PORTAL_BASE}/?print=${encodeURIComponent(id)}`, '_blank', 'noopener')} />
      )}
      {said && <div className="rl-hint nt-solo-note">{said}</div>}
    </div>
  )
}

function Editor({ id, say, onSaved, onClosed, onPrint, takeCaret, onCaret, onOpenNote, onPdf }) {
  const [n, setN] = useState(null)
  const [f, setF] = useState(null)
  const [open, setOpen] = useState(false)     // the fold beside the title
  const [where, setWhere] = useState(null)   // the folders, once the fold asks
  // live (the text with the markdown drawn over it) · raw (the text alone) ·
  // read (the note as it reads, the sheet the printer gets)
  const [view, setView] = useState('live')
  const read = view === 'read'
  const orig = useRef(null)                  // how the tab found it — revert
  // `format: tex` in the front matter: this note is a LaTeX document, not
  // markdown. The backend keeps unknown front-matter keys as they are, so the
  // flag costs nothing there — the editor reads it and changes language, and
  // the note's files get a folder of their own (`files/<id>/`), because LaTeX
  // names a plain `fig1.pdf` that the compile copies next to main.tex.
  const tex = String(f?.fields?.format || '').toLowerCase() === 'tex'
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
  useEffect(() => { if (open && !where) whereIs(tex ? id : '').then(setWhere) }, [open, tex])   // eslint-disable-line react-hooks/exhaustive-deps
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
    if (cur && disk && !sameNote(cur, disk)) putNote(id, disk.version, cur)
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

  if (!f || !n) return <p className="rl-msg">{tr("nt_loading")}</p>
  const dirty = !sameNote(f, n)
  // Nothing has changed since the PDF was made: compiling again would spend
  // ten seconds writing the same file. Both stamps are nanoseconds, past what
  // a number holds exactly.
  const asPdf = !dirty && !!pdfAt && BigInt(pdfAt) > BigInt(n.version || 0)
  // Tags live in the BODY now (#태그), so this is what the note will carry the
  // moment it is saved — shown rather than edited.
  const tags = bodyTags(f.body)
  const refKey = String(f.fields?.reference || '').trim()
  const ref = refKey ? references.find((r) => r.citeKey === refKey) : null
  // Keys the body cites that this note's bib does not define: each one is a
  // `?` in the PDF. Checked only when there IS a bib — a note without one
  // has nothing to be measured against, not a hundred mistakes.
  const missing = !tex || !bib.length ? [] : (() => {
    const known = new Set(bib.map((c) => c.key))
    const out = []
    for (const m of f.body.matchAll(CITE_IN_TEXT)) {
      for (const k of m[1].split(',').map((x) => x.trim())) {
        if (k && k !== '*' && !known.has(k) && !out.includes(k)) out.push(k)
      }
    }
    return out
  })()
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
      if (!String(body.fields?.reference || '').trim()) setOpen(true)
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

  return (
    <div className="nt-edit">
      {/* The buttons sit above the title: everything below them is the note.
          The same bar every editor in every rack-list service wears. */}
      {/* The note saves itself; save is still here for the hand that wants to
          press it, and it is the one button that says whether it is needed. */}
      <RackActions key={id}
        onSave={() => saveNote()} saveDisabled={!dirty} pending={dirty}
        onCancel={() => onClosed?.(id)}
        extra={<>
          {/* Three ways to look at the same text, which is one choice, not
              three buttons that have to agree with each other. */}
          {tex ? <span className="rl-hint rl-mono">LaTeX</span> : (
            <select className="rl-in nt-mode" value={view} aria-label={tr("nt_mode")}
              onChange={(e) => setView(e.target.value)}>
              <option value="live">{tr("nt_live")}</option>
              <option value="raw">{tr("nt_raw")}</option>
              <option value="read">{tr("nt_preview")}</option>
            </select>
          )}
          {/* A file input wearing the bar's button: picking a file is the whole
              act, and it is the one explicit way in — a zip REPLACES the body,
              so it must not happen because something was dragged. */}
          {tex ? <label className="rl-btn nt-zipbtn" title={tr("nt_zip_hint")}>{tr("nt_zip")}
            <input type="file" accept=".zip,application/zip" hidden disabled={busy}
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) importZip(file) }} />
          </label> : null}
          {tex ? <button type="button" className="rl-btn" onClick={compile}
            disabled={busy || asPdf} title={asPdf ? tr("nt_tex_fresh") : undefined}>
            {busy ? tr("nt_tex_running") : tr("nt_tex_compile")}</button> : null}
          {/* Two ways to read what came out: a tab of this app's own, beside
              the text, or a browser tab with the whole PDF viewer in it. */}
          {tex && pdfAt ? (<>
            {/* Solo — one note inside another service — has no tab strip of
                its own to open one in. */}
            {onPdf ? <button type="button" className="rl-btn" title={tr("nt_tex_rtab_hint")}
              onClick={() => onPdf(id, f.title, pdfAt)}>rtab</button> : null}
            <button type="button" className="rl-btn" title={tr("nt_tex_btab_hint")}
              onClick={() => window.open(pdfUrl(false), `pdf-${id}`)}>btab</button>
          </>) : null}
          {read ? <button type="button" className="rl-btn" onClick={onPrint}>{tr("nt_print")}</button> : null}
        </>}
        onRevert={() => setF(orig.current)} revertTitle={tr("nt_revert_hint")}
        onDelete={remove}
        deleteWarn={tr("nt_delete_warn")} />

      {/* Reading, the sheet carries the title and the date itself. */}
      {/* One line: the title, its tags, and the fold — a button with a word on
          it, big enough to hit — which opens the date and the file's name below. */}
      <div className="nt-titlerow" hidden={read}>
        <input className="nt-title" ref={titleRef} value={f.title} placeholder={tr("nt_title")}
          onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} />
        {tags.length ? <span className="nt-tagline">{tags.map((t) => `#${t}`).join(' ')}</span> : null}
        <button type="button" className="rl-btn nt-fold" onClick={() => setOpen(!open)}
          title={open ? tr("nt_fold") : tr("nt_date_file")} aria-expanded={open}>{tr("nt_info")} <i className="nt-caret">{open ? '▾' : '▸'}</i>
        </button>
      </div>
      {open && !read && (
        <div className="nt-meta-open">
          <label className="rl-hint">{tr("nt_date_with", ' ')}<input type="date" className="rl-in nt-date" value={f.date || ''}
              onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />
          </label>
          <span className="rl-hint rl-mono">{f.id}.md</span>
          {where && (
            <>
              <span className="rl-hint rl-mono nt-path" title={where.files}>{where.files}</span>
              <button type="button" className="rl-btn" title={where.files}
                onClick={() => ask(`/reveal${noteQ(tex ? id : '')}`, { method: 'POST' })
                  .then(() => say(tr("nt_folder_opened")))
                  .catch(() => say(tr("nt_folder_no")))}>{tr("nt_folder_open")}</button>
            </>
          )}
          <label className="rl-hint" title={tr("nt_tex")}>
            <input type="checkbox" checked={tex} onChange={(e) => setF((s) => {
              const fields = { ...(s.fields || {}) }
              if (e.target.checked) fields.format = 'tex'
              else delete fields.format
              return { ...s, fields }
            })} /> LaTeX
          </label>
          {/* The paper this document is. Typed rather than picked from a list:
              reference_manager holds hundreds, and the browser's own datalist
              finds one as you type the key. */}
          {tex ? (<>
            <label className="rl-hint" title={tr("nt_ref_hint")}>cite
              <input className="rl-in nt-ref" list="nt-refs" value={refKey} placeholder={tr("nt_ref_none")}
                onChange={(e) => setF((s) => {
                  const fields = { ...(s.fields || {}) }
                  const v = e.target.value.trim()
                  if (v) fields.reference = v
                  else delete fields.reference
                  return { ...s, fields }
                })} />
            </label>
            <datalist id="nt-refs">
              {references.map((r) => <option key={r.id} value={r.citeKey}>{r.title}</option>)}
            </datalist>
            {ref ? (
              <button type="button" className="rl-btn" title={ref.title}
                onClick={() => openInService(ref.svc, ref.proj, ref.id)}>{tr("nt_ref_open")}</button>
            ) : refKey ? <span className="rl-hint nt-ref-no">{tr("nt_ref_unknown")}</span> : null}
          </>) : null}
          {Object.entries(f.fields || {}).filter(([k]) => k !== 'format' && k !== 'reference').map(([k, v]) => (
            <span key={k} className="rl-hint"><b className="rl-mono">{k}</b> {String(v ?? '')}</span>
          ))}
          <span className="rl-sp" />
          <span className="rl-hint">{tr("nt_n_words", f.body.split(/\s+/).filter(Boolean).length)}</span>
        </div>
      )}

      {read ? (
        /* The same sheet the print page draws, inside the pane — reading does
           not need a tab of its own, only printing does. */
        <div className="nt-read">
          <article className="nt-sheet">
            <h1>{f.title}</h1>
            <p className="nt-meta">{f.date}</p>
            <Rendered>{f.body}</Rendered>
          </article>
        </div>
      ) : (
        /* The file as it is on disk: nothing is written back. `원문` shows the
           text with its line numbers; `라이브` paints the markdown over it and
           keeps the marks on the line the caret is in. Either way what is
           saved is what is typed, character for character. */
        <>
          <SourceArea key={`${view}${tex}`} live={view === 'live'} tex={tex}
            fileSrc={(name) => fileSrc(name, tex ? id : '')} onOpenNote={onOpenNote}
            onFiles={(file) => putFile(file, tex ? id : '').catch((e) => { say(String(e.message || e)); return null })}
            value={f.body} onChange={(v) => setF((s) => ({ ...s, body: v }))} />
          {tex && imp ? (
            <div className="nt-zipin">
              <span>{tr("nt_zip_in", imp.main, imp.files?.length || 0, imp.bib_keys?.length || 0)}</span>
              {refKey ? null : <span className="rl-hint">{tr("nt_zip_cite")}</span>}
              <button type="button" className="rl-btn" onClick={() => setImp(null)}>×</button>
            </div>
          ) : null}
          {missing.length ? (
            <div className="nt-texerr">{tr("nt_cite_missing", missing.length)} <b>{missing.join(', ')}</b></div>
          ) : null}
          {tex && errs?.length ? (
            <div className="nt-texerr">
              {errs.map((e, i) => (
                <div key={i}>{e.line ? <b>{tr("nt_tex_line", e.line)}</b> : null}{e.text}</div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

// ─── Reading ────────────────────────────────────────────────────────────────
/** The body, rendered — with `#태그` drawn as a tag and `» 2026-12-24` as the
 *  calendar label the editor draws, rather than left as the text they are in
 *  the file. react-markdown hands text through as strings, so both are picked
 *  out of those on the way to the page. */
const CHIP_RE = new RegExp(`${TAG_RE.source}|(»|📅|✓|✅)\\s*(\\d{4}-\\d{2}-\\d{2})|${PROJ_RE.source}`, 'g')

function tagify(children) {
  return Children.map(children, (child) => {
    if (typeof child !== 'string') return child
    const out = []
    let last = 0
    for (const m of child.matchAll(CHIP_RE)) {
      // A tag (lead + #name), a date (mark + day) or a project (lead + +name) —
      // one project_manager has; any other `+word` stays text.
      const tag = m[2] !== undefined, proj = m[6] !== undefined
      if (proj && !isProject(m[6])) continue
      const at = m.index + (tag ? m[1].length : proj ? m[5].length : 0)
      if (at > last) out.push(child.slice(last, at))
      out.push(tag ? <span className="nt-tag" key={at}>{m[2]}</span>
        : proj ? <span className="nt-proj" key={at}>{m[6]}</span>
          : <span className={'»📅'.includes(m[3]) ? 'nt-due-in' : 'nt-done-in'} key={at}>{m[4]}</span>)
      last = at + (tag ? 1 + m[2].length : proj ? 1 + m[6].length : m[0].length)
    }
    out.push(child.slice(last))
    return out
  })
}
const tagged = (Tag) => function Tagged({ node, children, ...rest }) {
  return <Tag {...rest}>{tagify(children)}</Tag>
}
/** `![alt|400](…)` — the width rides in the alt text, as it does in the
 *  editor and in Obsidian. */
function Img({ node, alt, ...rest }) {
  const [text, w] = embedSpec(alt || '')
  // An embed that is not a picture — a pdf, a sheet, a document — is handed
  // over as a file rather than drawn as a broken image.
  if (!isImage(text)) {
    return <a className="nt-file" href={rest.src} target="_blank" rel="noreferrer">{text}</a>
  }
  return <img alt={text} {...rest} style={w ? { width: `${w}px` } : undefined} />
}
/** A link out of the note opens a tab of its own: this page is inside the
 *  portal's frame, and a site that refuses to be framed would otherwise just
 *  not arrive. */
function Link({ node, ...rest }) {
  return <a {...rest} target="_blank" rel="noreferrer" />
}
const RENDER = {
  p: tagged('p'), li: tagged('li'), td: tagged('td'), blockquote: tagged('blockquote'),
  h1: tagged('h1'), h2: tagged('h2'), h3: tagged('h3'), h4: tagged('h4'),
  img: Img, a: Link,
}
function Rendered({ children }) {
  // Maths is `$x^2$` and `$$…$$`, which KaTeX draws here and the editor leaves
  // as the text it is — the file is the same either way.
  // `![[name]]` is Obsidian's embed, not markdown — here it is turned into the
  // markdown image it means. Only on the way to the page: the file keeps its
  // own spelling.
  const md = String(children || '').replace(EMBED_RE, (_, spec) => {
    const [name] = embedSpec(spec)
    return `![${spec}](${fileSrc(name)})`
  })
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkSoftBreaks]}
      rehypePlugins={[rehypeKatex]} components={RENDER}>
      {md}
    </ReactMarkdown>
  )
}

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
          <Rendered>{n.body}</Rendered>
        </article>
      ))}
    </div>
  )
}
