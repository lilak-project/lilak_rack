import './strings.js'
import { useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { authHeaders, linkProject, PORTAL_BASE, useProjects } from 'racklist'

/**
 * The inbox's moving parts (def.jsx declares its fields): what approving
 * makes, and the buttons — in the table's last column and in the editor's
 * bar. Yes makes the record in the service it belongs to — an activity
 * through activities' POST /api/records, a note through note's own
 * POST and PUT — then saves the candidate approved, with where it went; [열기]
 * opens that in a pane here.
 *
 * A candidate with `match` ({id}) is about a record that already exists in
 * that service. `mode: 'update'` lays its filled fields over the activity (or
 * adds its body to the end of the note) — [업데이트]; `mode: 'checked'` means the
 * mail brought nothing new — [확인]. Either way [열기] opens the record.
 */
const ACTIVITY = ['name', 'kind', 'start', 'startTime', 'end', 'endTime', 'place', 'link', 'comment']
// an update may also touch the trip/talk side of an existing activity
const UPDATABLE = [...ACTIVITY, 'tripKind', 'tripStart', 'tripEnd', 'role', 'title', 'host', 'talkDate', 'talkTime']
const SVC = { activity: 'activities', note: 'note', job: 'jobboard', note_delete: 'note' }
// A tags candidate's items with something to add (backend/approve.py tag_items).
const tagItems = (r) => (r.items || []).filter((it) => it?.service && it?.id && (it.add || []).length)
// As the backend keeps it (_order): what is still to be decided, then the newest mail.
const when = (c) => `${String(c.date || c.createdAt || '').slice(0, 10)}|${c.createdAt || ''}|${c.id}`
const decided = (c) => (c.status || 'waiting') !== 'waiting'
const inboxOrder = (a, b) => decided(a) - decided(b) || (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0)
const now = () => new Date().toISOString()
const words = (v) => String(v || '').split(/\s+/).map((t) => t.replace(/^#/, '')).filter(Boolean)

const call = (path, opts = {}) => fetch(path, { ...opts,
  headers: { ...authHeaders(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } })
  .then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.detail || `${r.status}`)
    return j
  })
// The project a candidate goes to: the one it names, else its service's main one.
const projOf = (r) => r.destProj || linkProject(SVC[r.target])

/** The tags the candidate's project brings (its `project` is a link to one of
 *  project_manager's; `projects` as racklist's loadProjects gives them). */
const projectTags = (r, projects) => (projects || []).find((p) => p.id === (r.project?.id ?? r.project))?.tags || []

const today = () => new Date().toLocaleDateString('sv')   // YYYY-MM-DD
const GMAIL = 'https://mail.google.com/mail/u/0/'
const mailLink = (r) => (/^[0-9a-f]+$/.test(r.threadId || '') ? `${GMAIL}#all/${r.threadId}` : '')
const fromLine = (r) => [r.from, r.date].filter(Boolean).join(', ') + (r.subject ? `, 「${r.subject}」` : '')
  + (mailLink(r) ? ` ${mailLink(r)}` : '')

/** What an update lays over: the activity's filled fields, or the note's added part. */
function changes(r) {
  if (r.target === 'activity') return Object.fromEntries(UPDATABLE.filter((k) => String(r[k] || '')).map((k) => [k, String(r[k])]))
  const from = fromLine(r)
  return { add: `\n\n## ${tr('ib_update_head', today())}\n\n${String(r.body || '').trim()}\n${from ? `\n출처: ${from}\n` : ''}` }
}

/** The record a match points at, as its service has it now. */
async function current(r) {
  const svc = SVC[r.target], p = projOf(r)
  if (r.target === 'note') return call(`/pp/${svc}/${p}/api/notes/${encodeURIComponent(r.match.id)}`)
  const d = await call(`/pp/${svc}/${p}/api/data`)
  const rec = (d.activities || []).find((x) => String(x.id) === String(r.match.id))
  if (!rec) throw new Error(tr('ib_gone'))
  return rec
}

/** A job candidate's parameters, as the agent wrote them (JSON); null when they do not read. */
const jobParams = (r) => { try { const p = JSON.parse(r.params || '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p : null } catch { return null } }

// ponytail: makes/missing/changes are the editor's live preview of unsaved edits; what approving does is
// backend/approve.py (the same rules, in Python). Change one, change the other.
/** What approving makes: { record } for an activity, { title, text } for a note,
 *  { job } — what jobrun is asked to run — for a job an agent wants to submit. */
export function makes(r, projects) {
  if (r.target === 'job') {
    return { job: { recipe: String(r.recipe || ''), project: String(r.jobProject || ''), params: jobParams(r) || {},
      ...(r.server ? { server: String(r.server) } : {}) } }
  }
  const tags = projectTags(r, projects)
  if (r.target === 'activity') {
    const rec = Object.fromEntries(ACTIVITY.map((k) => [k, String(r[k] || '')]))
    return { record: { ...rec, repeat: null, ...(tags.length ? { tags } : {}) } }
  }
  const from = fromLine(r)
  const all = [...new Set([...words(r.noteTags), ...tags])].map((t) => `#${t}`).join(' ')
  return { title: String(r.title || '').trim(),
    text: `${all}\n\n${String(r.body || '').trim()}\n${from ? `\n출처: ${from}\n` : ''}` }
}
const isDelete = (r) => r.target === 'note_delete' || r.target === 'record_delete'
const missing = (r, out) => (r.target === 'note_delete' ? (r.noteId ? '' : tr('ib_need_note_id'))
  : r.target === 'record_delete' ? (r.svc && r.key && r.recordId ? '' : tr('ib_need_record'))
  : r.target === 'tags' ? (tagItems(r).length ? '' : tr('ib_need_tags'))
  : r.target === 'job'
  ? (!out.job.recipe || !out.job.project || !jobParams(r) ? tr('ib_need_job') : '')
  : r.mode === 'update'
  ? (r.target === 'activity' ? (Object.keys(changes(r)).length ? '' : tr('ib_need_change')) : (String(r.body || '').trim() ? '' : tr('ib_need_change')))
  : r.target === 'activity'
  ? (!out.record.name || !/^\d{4}-\d{2}-\d{2}$/.test(out.record.start) ? tr('ib_need_activity') : '')
  : (!out.title ? tr('ib_need_note') : ''))

/** The editor's read-only field: exactly what approving will make. */
export function MakesField({ rec: r }) {
  const projects = useProjects()
  if (r.mode === 'update' && r.match?.id) return <UpdateField r={r} />
  if (isDelete(r) || r.target === 'tags') {
    const bad = missing(r, {})
    if (bad) return <span className="rl-warn">{bad}</span>
    return (
      <div className="rl-mono" style={{ whiteSpace: 'pre-wrap' }}>{r.target === 'note_delete'
        ? `${tr('ib_trash')}: ${r.title || r.noteId}\n${String(r.excerpt || '').trim() || '—'}`
        : r.target === 'record_delete'
        ? `${tr('ib_trash')}: ${r.svc}/${r.destProj || ''} · ${r.key}\n${JSON.stringify(r.snapshot || {}, null, 1)}`
        : tagItems(r).map((it) => `${it.title || it.id}  (${it.service}/${it.project || ''})  ${it.add.map((a) => `#${String(a).replace(/^#/, '')}`).join(' ')}`).join('\n')}</div>
    )
  }
  const out = makes(r, projects)
  const bad = missing(r, out)
  if (bad) return <span className="rl-warn">{bad}</span>
  return (
    <div className="rl-mono" style={{ whiteSpace: 'pre-wrap' }}>{r.target === 'job'
      ? `${out.job.recipe}${out.job.server ? ` @ ${out.job.server}` : ''}\nproject: ${out.job.project}\n${JSON.stringify(out.job.params, null, 2)}`
      : r.target === 'activity'
      ? Object.entries(out.record).filter(([, v]) => v && v.length !== 0).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n')
      : `${out.title}\n\n${out.text}`}</div>
  )
}

/** A candidate with no title of its own (an update naming only what changes):
 *  the record it is about, by the name it has now, dimmed. Asked once per record. */
const named = new Map()
export function MatchName({ r }) {
  const key = `${r.target}:${r.match.id}`
  const [name, setName] = useState(null)
  useEffect(() => {
    if (!named.has(key)) named.set(key, current(r).then((c) => (r.target === 'note' ? c.title : c.name) || '', () => ''))
    named.get(key).then(setName)
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="rl-dim">{name ?? '…'}</span>
}

/** The mail behind a candidate: a link to it, what it carries, and its text as the
 *  task copied it, asked for when opened (plain text; nothing in it runs). */
export function MailField({ rec: r }) {
  const [text, setText] = useState(null)
  const ask = (e) => {
    if (!e.target.open || text !== null) return
    call(`${PORTAL_BASE}/api/inbox/${encodeURIComponent(r.id)}/mail`)
      .then((d) => setText(d.text || tr('ib_mail_none')), (err) => setText(String(err.message || err)))
  }
  const link = mailLink(r)
  const find = `${GMAIL}#search/${encodeURIComponent(`subject:"${r.subject || ''}"`)}`
  return (
    <div>
      <a className="rl-lnk" href={link || find} target="_blank" rel="noreferrer">{tr(link ? 'ib_mail_open' : 'ib_mail_find')}</a>
      {r.attachments?.length > 0 && <span className="rl-dim"> · 📎 {tr('ib_attach', r.attachments.join(', '))}</span>}
      <details onToggle={ask}>
        <summary>{tr('ib_mail_text')}</summary>
        <div className="rl-mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' }}>{text ?? '…'}</div>
      </details>
    </div>
  )
}

/** An update's preview: each field old → new, or the note's added part. */
function UpdateField({ r }) {
  const [cur, setCur] = useState(null)
  useEffect(() => { current(r).then(setCur, (e) => setCur({ error: String(e.message || e) })) }, [r.match?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const bad = missing(r)
  if (bad) return <span className="rl-warn">{bad}</span>
  if (!cur) return <span className="rl-dim">…</span>
  if (cur.error) return <span className="rl-warn">{cur.error}</span>
  const hl = { background: 'var(--rk-cite)', color: 'var(--rk-cite-t)' }
  if (r.target === 'note') return (
    <div className="rl-mono" style={{ whiteSpace: 'pre-wrap' }}>
      <div className="rl-dim">{`${cur.title}\n…`}</div>
      <div style={{ ...hl, padding: '2px 6px', borderLeft: '3px solid var(--rk-cite-t)' }}>{changes(r).add.trim()}</div>
    </div>)
  const ch = changes(r)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr 1fr', gap: '1px 10px', alignItems: 'baseline' }}>
      <b style={{ gridColumn: '1 / -1' }}>{cur.name}</b>
      {UPDATABLE.filter((k) => k in ch || (k !== 'name' && String(cur[k] || ''))).map((k) => {
        const old = String(cur[k] || ''), neu = k in ch ? ch[k] : old, diff = neu !== old
        return [
          <span key={k} className="rl-dim">{k}</span>,
          <span key={`${k}o`} className={diff ? 'rl-dim' : ''} style={diff ? { textDecoration: 'line-through' } : null}>{old || '—'}</span>,
          <span key={`${k}n`} style={diff ? { ...hl, padding: '0 4px', fontWeight: 600 } : { color: 'var(--rk-dim)' }}>{diff ? neu : '='}</span>,
        ]
      })}
    </div>)
}

/** The candidate saved with what changed, the inbox kept waiting first. */
const save = (ctx, r, change, said) => ctx.commit({
  inbox: (ctx.doc?.inbox || []).map((x) => (x.id === r.id ? { ...r, ...change } : x))
    .sort(inboxOrder),
}, said)

/** A decision, made by the backend (approve / update make the record where the
 *  candidate goes, as the person deciding). An editor's unsaved edits are saved
 *  first, so what is approved is what is on screen. What changed comes back. */
async function decide(r, ctx, action, said) {
  const had = (ctx.doc?.inbox || []).find((x) => x.id === r.id)
  const edited = had && Object.keys(r).some((k) => k !== 'mailView' && JSON.stringify(r[k]) !== JSON.stringify(had[k]))
  if (edited && !(await save(ctx, r, {}, null))) throw new Error(tr('ib_not_saved'))
  const c = await call(`${PORTAL_BASE}/api/inbox/${encodeURIComponent(r.id)}/decide`,
    { method: 'POST', body: JSON.stringify({ action }) })
  await ctx.reload?.()
  ctx.say?.(said)
  return { status: c.status, made: c.made || null, decidedAt: c.status === 'waiting' ? '' : now() }
}

const openMade = async (r, ctx) => ctx.openRecord?.({
  ...(r.made || { svc: SVC[r.target], proj: projOf(r), id: r.match?.id }),
  label: r.target === 'note' ? r.title : r.name })

/** In the menu: every candidate still to be decided, each in an editor
 *  (the first in front, as the list has them), so they can be gone through
 *  without a right click on each. */
const editorId = (r) => `item:${r.id}`
export function OpenWaiting({ api: { doc, openEdit } }) {
  const waiting = (doc?.inbox || []).filter((r) => !decided(r))
  if (!waiting.length) return null
  const edit = (r) => openEdit({ id: editorId(r), kind: 'item', who: r.id,
    label: (r.target === 'note' ? r.title : r.name) || r.subject || r.id })
  return (
    <button type="button" className="rl-btn" onClick={() => { waiting.forEach(edit); edit(waiting[0]) }}>
      {tr('ib_open_waiting', waiting.length)}</button>
  )
}

/** The buttons a candidate has where it stands: waiting [승인][버림],
 *  (nothing new in the mail: only [확인], which changes no record either),
 *  approved [열기], discarded [되살리기]. `after` hears what changed (the
 *  editor keeps its form in step); a decision made in the editor closes it
 *  (`close`) and shows the next waiting one if that is open too; one that
 *  failed leaves it open with what it said. A waiting update's [열기] (the record it
 *  would change) is the editor's only: its row has no room, and the editor
 *  shows the change beside it. */
export function InboxActions({ r, ctx, after, row, close }) {
  if (!r?.id) return null
  const stop = (e) => e.stopPropagation()
  const run = (fn, decides) => async (e) => {
    stop(e)
    try {
      const ch = await fn()
      if (ch) after?.(ch)
      if (decides && close) {
        const waiting = (ctx.doc?.inbox || []).filter((x) => !decided(x))
        const at = waiting.findIndex((x) => x.id === r.id)
        const next = waiting[at + 1] || waiting[at - 1]
        close(next && editorId(next))
      }
    } catch (err) { ctx.say?.(String(err.message || err)) }
  }
  const out = makes(r, [])          // the project's tags change what is made, never whether it can be
  const bad = missing(r, out)
  const open = (r.made?.id || r.match?.id)
    ? <button type="button" className="rl-btn" onClick={(e) => { stop(e); openMade(r, ctx) }}>{tr('ib_open')}</button> : null
  if (r.status === 'approved' || r.status === 'checked') return open
  if (r.status === 'discarded') {
    return (
      <button type="button" className="rl-btn" onClick={run(() => decide(r, ctx, 'restore', tr('ib_restored')))}>{tr('ib_restore')}</button>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }} onClick={stop}>
      {r.mode === 'checked'
        ? <button type="button" className="rl-btn rl-go" onClick={run(() => decide(r, ctx, 'check', tr('ib_checked')), true)}>{tr('ib_check')}</button>
        : <button type="button" className="rl-btn rl-go" disabled={!!bad} title={bad || undefined}
            onClick={run(() => decide(r, ctx, isDelete(r) ? 'trash' : r.mode === 'update' ? 'update' : 'approve',
              tr('ib_approved', (r.target === 'note' || isDelete(r) ? r.title : r.name) || '')), true)}>
            {tr(isDelete(r) ? 'ib_trash' : r.mode === 'update' ? 'ib_update' : 'ib_approve')}</button>}
      {r.mode !== 'checked' && <button type="button" className="rl-btn rl-danger" onClick={run(() => decide(r, ctx, 'discard', tr('ib_discarded')), true)}>{tr('ib_discard')}</button>}
      {r.match?.id && !row && open}
    </span>
  )
}
