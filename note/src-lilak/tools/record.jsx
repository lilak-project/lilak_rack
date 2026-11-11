import '../strings.js'
import { useEffect, useState } from 'react'
import Select from 'lilak-ui/components/Select.jsx'
import { api, fileSrc } from '../api.js'
import { LANGS, askReady, keepFile, setKeepFile, setLang, start, stop, useRecording } from '../recorder.js'
import { press } from './press.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** 녹음 — the buttons for the service's one recorder (recorder.js): on the
 *  원문 bar and in this tab, which also keeps the note's recordings. */
const REC_EMBED = /!\[\[(rec-[^\]|]+)\]\]/g
const two = (n) => String(n).padStart(2, '0')
const clock = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}` : `${Math.floor(s / 60)}`) + `:${two(s % 60)}`
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Which language to listen for. Set before a recording: a piece already sent
 *  was heard in the old one. */
export function LangPick() {
  const r = useRecording()
  return (
    <Select className="rl-in nt-rec-lang" value={r.lang} disabled={r.state !== 'idle'}
      aria-label={tr('nt_rec_lang')} onChange={(e) => setLang(e.target.value)}>
      {LANGS.map((k) => <option key={k} value={k}>{tr(`nt_rec_lang_${k}`)}</option>)}
    </Select>
  )
}

/** Start here, or stop this note's recording. Another note's recording is not
 *  this note's business: nothing is shown for it here. */
export function RecButton({ note, title }) {
  const r = useRecording()
  useEffect(askReady, [])
  if (r.state !== 'idle' && r.note !== note) return null
  if (r.state === 'rec') {
    return (
      <button type="button" className="rl-btn nt-rec-on" title={tr('nt_rec_stop')}
        {...press(() => stop())}>■ {clock(r.sec)}</button>
    )
  }
  return (
    <button type="button" className="rl-btn" disabled={!r.ready || r.state === 'busy'}
      title={r.ready === false ? tr('nt_rec_none') : tr('nt_rec_start')} {...press(() => start(note, title))}>
      {r.state === 'busy' ? tr('nt_rec_busy') : tr('nt_rec_start')}
    </button>
  )
}

function Body({ note, setNote, say }) {
  const r = useRecording()
  const [keep, setKeep] = useState(keepFile)
  const [sure, setSure] = useState('')                 // the recording a delete is asking about

  async function drop(name) {
    setSure('')
    const res = await api(`/record/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) { say(tr('nt_rec_del_failed')); return }
    // The line it stood on goes with it; the words written from it stay.
    const at = new RegExp(`^[ \\t]*!\\[\\[${escape(name)}\\]\\][ \\t]*\\n?|!\\[\\[${escape(name)}\\]\\]`, 'm')
    setNote((s) => ({ ...s, body: s.body.replace(at, '') }))
    say(tr('nt_rec_deleted', name))
  }

  const mine = [...new Set([...String(note.body).matchAll(REC_EMBED)].map((m) => m[1]))]
  return (
    <div className="nt-rec">
      <div className="nt-rec-row">
        <RecButton note={note.id} title={note.title} />
        {r.ready === false ? <span className="rl-hint">{tr('nt_rec_none')}</span> : null}
      </div>
      <label className="nt-rec-row">
        <span>{tr('nt_rec_lang')}</span>
        <LangPick />
      </label>
      <label className="nt-rec-row">
        <input type="checkbox" checked={keep} disabled={r.state !== 'idle'}
          onChange={(e) => { setKeep(e.target.checked); setKeepFile(e.target.checked) }} />
        <span>{tr('nt_rec_keep')}</span>
      </label>
      <div className="rl-hint">{tr('nt_rec_how')}</div>
      {mine.length ? <div className="rl-hint">{tr('nt_rec_list')}</div> : null}
      {mine.map((name) => (
        <div key={name} className="nt-rec-item">
          <span className="rl-mono rl-hint">{name}</span>
          <audio controls preload="none" src={fileSrc(name)} />
          {sure === name
            ? <button type="button" className="rl-btn rl-danger" {...press(() => drop(name))}>{tr('nt_rec_del_sure')}</button>
            : <button type="button" className="rl-btn" {...press(() => setSure(name))}>{tr('nt_rec_del')}</button>}
        </div>
      ))}
    </div>
  )
}

export default {
  id: 'record',
  label: 'nt_tab_record',
  modes: ['md'],
  badge: ({ note, recording }) => (recording?.state === 'rec' && recording.note === note.id ? 'dot' : null),
  Body,
}
