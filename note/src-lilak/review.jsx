import './strings.js'
import { useEffect, useState } from 'react'
import { ask } from './api.js'
import { Rendered } from './reading.jsx'
import { placeBack, placeSave } from './scrolled.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** Review: the note in pieces — sentences, paragraphs or lines, and the whole
 *  of it on top — each with its evidence (`[@key]` in the text) and the
 *  comments on it. The server cuts the pieces and keeps the comments
 *  (backend/review.py): the agents' tools read the same pieces, by the same
 *  hash, so a comment made here is the one an agent answers there.
 *
 *  Nothing here edits the text but evidence: a key picked for a piece is
 *  written at its end. The comments are kept beside the text, not in it. */
const LEVELS = ['sentence', 'paragraph', 'line']

/** `onTouched`: a comment was written — the note's file (and so its version)
 *  moved on, and the editor must hear it or its next save is a conflict. */
export default function ReviewPane({ id, version, references, flush, onNote, onTouched, say }) {
  const [level, setLevel] = useState(() => placeBack(`${id}:rvlevel`) || 'sentence')
  useEffect(() => { placeSave(`${id}:rvlevel`, level) }, [id, level])
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)        // the piece whose thread is open: n, or 0 for the whole note
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let on = true
    ask(`/notes/${encodeURIComponent(id)}/units?level=${level}`)
      .then(({ body }) => { if (on) setData(body) })
      .catch((e) => say(String(e.message || e)))
    return () => { on = false }
  }, [id, level, version, again])   // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setAgain((x) => x + 1)
  const post = async (path, body) => {
    try {
      const r = await ask(`/notes/${encodeURIComponent(id)}${path}`, { method: 'POST', body: JSON.stringify(body) })
      if (r.conflict) { say(r.body?.detail || tr('nt_rv_changed')); reload() }
      return r.conflict ? null : r.body
    } catch (e) { say(String(e.message || e)); return null }
  }
  const comment = async (text, n) => {
    if (await post('/reviews', n ? { level, n, text } : { level: 'doc', text })) onTouched()
  }
  const cite = async (u, key) => {
    await flush()                       // what is being typed first: the server writes the key into the file
    const note = await post('/cite', { level, n: u.n, hash: u.hash, key })
    if (note) onNote(note)
  }
  // A piece being rewritten here (a double-click): its text as shown, and as typed.
  const [editing, setEditing] = useState(null)
  const rewrite = async () => {
    const { n, was, text } = editing
    if (text === was) { setEditing(null); return }
    await flush()
    const note = await post('/piece', { level, n, was, text })
    // Refused (changed meanwhile): the box stays, what was typed with it.
    if (note) { setEditing(null); onNote(note) }
  }
  if (!data) return <div className="nt-rv" />
  const c = data.counts
  const thread = (u, list) => (
    <Thread list={list} canCite={!!u && u.kind === 'text' && references.length > 0} references={references}
      onComment={(t) => comment(t, u?.n)}
      onReply={async (rid, t) => { if (await post(`/reviews/${rid}/replies`, { text: t })) onTouched() }}
      onState={async (rid, s) => { if (await post(`/reviews/${rid}/state`, { state: s })) onTouched() }}
      onCite={(key) => cite(u, key)} />
  )
  const count = (list) => {
    const live = list.filter((r) => r.state !== 'resolved').length
    return list.length ? <span className={`nt-rv-count${live ? ' on' : ''}`} title={tr('nt_rv_count_hint', live, list.length)}>{live || '✓'}</span> : null
  }
  return (
    <div className="nt-rv" ref={(el) => { if (el && el.dataset.at !== id) { el.dataset.at = id; el.scrollTop = placeBack(`${id}:rv`) || 0 } }}
      onScroll={(e) => placeSave(`${id}:rv`, e.currentTarget.scrollTop)}>
      <div className="nt-rv-bar">
        <div className="rl-seg">
          {LEVELS.map((k) => (
            <button key={k} type="button" className={`rl-btn${level === k ? ' on' : ''}`} onClick={() => { setLevel(k); setOpen(null) }}>{tr(`nt_rv_${k}`)}</button>
          ))}
        </div>
        <span className="nt-rv-tally">
          {tr('nt_rv_tally', c.need, c.none, c.open, c.resolved)}
          {c.moved ? <> · <b>{tr('nt_rv_moved_n', c.moved)}</b></> : null}
        </span>
      </div>
      <div className={`nt-rv-row nt-rv-doc${open === 0 ? ' on' : ''}`} onClick={() => setOpen(open === 0 ? null : 0)}>
        <span className="nt-rv-n">∑</span>
        <span className="nt-rv-text">{tr('nt_rv_doc')}</span>
        <span className="nt-rv-side">{count(data.doc.comments)}</span>
      </div>
      {open === 0 ? thread(null, data.doc.comments) : null}
      {data.units.map((u) => (
        <div key={`${level}${u.n}`}>
          <div className={`nt-rv-row${open === u.n ? ' on' : ''}${u.needs && !u.keys.length ? ' nt-rv-miss' : ''}${u.kind === 'block' ? ' nt-rv-block' : ''}`}
            title={u.needs && !u.keys.length ? `${tr('nt_rv_miss_hint')}\n${tr('nt_rv_edit_hint')}` : tr('nt_rv_edit_hint')}
            onClick={(e) => { if (!e.target.closest('a') && editing?.n !== u.n) setOpen(open === u.n ? null : u.n) }}
            onDoubleClick={(e) => { if (!e.target.closest('a') && editing?.n !== u.n) { window.getSelection()?.removeAllRanges(); setEditing({ n: u.n, was: u.text, text: u.text }) } }}>
            <span className="nt-rv-n">{u.n}</span>
            {editing?.n === u.n ? (
              <div className="nt-rv-edit" onClick={(e) => e.stopPropagation()}>
                <textarea className="rl-in" autoFocus rows={Math.max(2, editing.text.split('\n').length + 1)} value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); rewrite() }
                  }} />
                <div className="nt-rv-new">
                  <button type="button" className="rl-btn" onClick={rewrite}>{tr('nt_rv_save')}</button>
                  <button type="button" className="rl-btn" onClick={() => setEditing(null)}>{tr('nt_rv_cancel')}</button>
                  <span className="rl-hint">{tr('nt_rv_save_hint')}</span>
                </div>
              </div>
            ) : <div className="nt-rv-text"><Rendered>{u.text}</Rendered></div>}
            <span className="nt-rv-side">
              {u.keys.map((k) => <span key={k} className="nt-rv-key">@{k}</span>)}
              {count(u.comments)}
            </span>
          </div>
          {open === u.n ? thread(u, u.comments) : null}
        </div>
      ))}
      {data.moved.length ? (
        <div className="nt-rv-moved">
          <h4>{tr('nt_rv_moved')}</h4>
          <p className="rl-hint">{tr('nt_rv_moved_hint')}</p>
          {thread(null, data.moved)}
        </div>
      ) : null}
    </div>
  )
}

/** One piece's comments, a box to add one, and — a piece of text, in a note
 *  that can see a library — the evidence to pick for it. */
function Thread({ list, canCite, references, onComment, onReply, onState, onCite }) {
  const [text, setText] = useState('')
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const found = picking ? references.filter((r) => `${r.citeKey} ${r.title || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30) : []
  return (
    <div className="nt-rv-thread" onClick={(e) => e.stopPropagation()}>
      {list.map((r) => <Comment key={r.id} r={r} onReply={(t) => onReply(r.id, t)} onState={(s) => onState(r.id, s)} />)}
      <div className="nt-rv-new">
        <textarea className="rl-in" rows={2} value={text} placeholder={tr('nt_rv_new')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) { onComment(text); setText('') } }} />
        <button type="button" className="rl-btn" disabled={!text.trim()} onClick={() => { onComment(text); setText('') }}>{tr('nt_rv_add')}</button>
        {canCite ? <button type="button" className={`rl-btn${picking ? ' on' : ''}`} onClick={() => setPicking(!picking)}>{tr('nt_rv_cite')}</button> : null}
      </div>
      {picking ? (
        <div className="nt-rv-pick">
          <input className="rl-in" autoFocus value={q} placeholder={tr('nt_rv_cite_find')} onChange={(e) => setQ(e.target.value)} />
          <ul>
            {found.map((r) => (
              <li key={r.citeKey}><button type="button" className="nt-rv-ref" onClick={() => { setPicking(false); onCite(r.citeKey) }}>
                <b>@{r.citeKey}</b> {r.title}</button></li>
            ))}
            {!found.length ? <li className="rl-hint">{tr('nt_rv_cite_none')}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function Comment({ r, onReply, onState }) {
  const [text, setText] = useState('')
  const [replying, setReplying] = useState(false)
  const who = (x) => <span className="nt-rv-by">{x.by}{x.via ? ` · ${x.via}` : ''} · {String(x.at || '').slice(0, 16).replace('T', ' ')}</span>
  return (
    <div className={`nt-rv-c${r.state === 'resolved' ? ' done' : ''}`}>
      <div className="nt-rv-chead">
        {who(r)}
        {r.drift ? <span className="nt-rv-drift" title={tr('nt_rv_drift_hint')}>{tr('nt_rv_drift')}</span> : null}
        <button type="button" className="rl-btn" onClick={() => onState(r.state === 'resolved' ? 'open' : 'resolved')}>
          {tr(r.state === 'resolved' ? 'nt_rv_reopen' : 'nt_rv_resolve')}</button>
      </div>
      <div className="nt-rv-ctext">{r.text}</div>
      {(r.replies || []).map((x, i) => (
        <div key={i} className="nt-rv-reply">{who(x)}<div className="nt-rv-ctext">{x.text}</div></div>
      ))}
      {replying ? (
        <div className="nt-rv-new">
          <textarea className="rl-in" rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="rl-btn" disabled={!text.trim()} onClick={() => { onReply(text); setText(''); setReplying(false) }}>{tr('nt_rv_reply')}</button>
        </div>
      ) : <button type="button" className="nt-rv-link" onClick={() => setReplying(true)}>{tr('nt_rv_reply')}</button>}
    </div>
  )
}
