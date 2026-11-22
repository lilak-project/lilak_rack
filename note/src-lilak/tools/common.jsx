import Select from 'lilak-ui/components/Select.jsx'
import '../strings.js'
import { useState } from 'react'
import { RackField, PathLine } from 'racklist'
import { press } from 'racklist'
import { tr } from 'lilak-ui/i18n.jsx'

/** 공용 — what every note has, whatever it is written in.
 *
 *  This was the fold beside the title (`정보`), which could hold a line of
 *  things and no more. It is a field grid now, the same one activity's editor
 *  is: label on the left, the thing on the right.
 */
// Fields the app writes and shows in its own way (the mode, the lock, the
// title slide, Review's comments), not as a line of their own here.
const OWN = new Set(['format', 'reference', 'ratio', 'numbered', 'mode', 'readonly', 'locked_by', 'locked_at', 'locked_via',
  'reviews', 'subtitle', 'presenter', 'when'])

function Body({ note, setNote, go, keep, where, read, slide, print, say, ask, tags, words, make, lock }) {
  const { pins, last, marks } = keep
  return (
    <div className="rl-rec nt-common">
      {/* Where this note is, whole, to hand an agent (get_note takes it). */}
      <PathLine kind="notes" id={note.id} />
      {/* 읽기 전용: nothing it says can be changed, by anyone, until unlocked —
          and only the one who locked it, or a manager, may unlock it. */}
      <RackField label={tr("nt_lock")}>
        {lock.on ? (<>
          <span className="nt-locked">{tr("nt_locked")}</span>
          <span className="rl-hint">{tr("nt_locked_by", lock.via ? `${lock.by || '?'} · ${lock.via}` : (lock.by || '?'), String(lock.at).slice(0, 10))}</span>
          <button type="button" className="rl-btn" disabled={!lock.can}
            title={lock.can ? tr("nt_unlock_hint") : tr("nt_unlock_no")} {...press(() => { if (lock.can) lock.set(false) })}>{tr("nt_unlock")}</button>
        </>) : (
          <button type="button" className="rl-btn" title={tr("nt_lock_hint")} {...press(() => lock.set(true))}>{tr("nt_lock_btn")}</button>
        )}
      </RackField>
      <RackField label={tr("nt_date")}>
        <input type="date" className="rl-in nt-date" value={note.date || ''} disabled={lock.on}
          onChange={(e) => setNote((s) => ({ ...s, date: e.target.value }))} />
      </RackField>

      <RackField label={tr("nt_tool_file")}>
        <span className="rl-hint rl-mono">{note.id}.md</span>
        {where ? (<>
          <span className="rl-hint rl-mono nt-path" title={where.files}>{where.files}</span>
          <button type="button" className="rl-btn" title={where.files}
            {...press(() => ask('/reveal' + (note.tex ? `?note=${encodeURIComponent(note.id)}` : ''), { method: 'POST' })
              .then(() => say(tr("nt_folder_opened")))
              .catch(() => say(tr("nt_folder_no"))))}>{tr("nt_folder_open")}</button>
        </>) : null}
      </RackField>

      {/* The `#tags` the body wears. They are in the text already — this is a
          reading of it, not a field to type in. */}
      <RackField label={tr("nt_tool_tags")}>
        {tags.length ? <span className="nt-tagline">{tags.map((t) => `#${t}`).join(' ')}</span>
          : <span className="rl-hint">{tr("rk_none")}</span>}
        {/* LaTeX has no `#tag` of its own: `#` is a macro's argument there. */}
        {note.tex ? <span className="rl-hint">{tr("nt_tags_tex_hint")}</span> : null}
      </RackField>

      {/* The lines worth coming back to. A number is a button that goes
          there; the gutter is where one is made and unmade (the ribbon in the
          title bar). Until a line is bookmarked this is the last line typed
          in, which is why it wears the fainter mark and has nothing to clear. */}
      <RackField label={tr("nt_tool_marks")}>
        {marks.length ? (<>
          {marks.map((ln) => (
            <button key={ln} type="button" className={`rl-btn nt-pin-go${pins.length ? '' : ' nt-pin-tmp'}`}
              title={tr(pins.length ? "nt_pin_go" : "nt_pin_last", ln)} {...press(() => go(ln))}>{ln}</button>
          ))}
          {pins.length ? (
            <button type="button" className="rl-btn" title={tr("nt_pin_clear_hint")}
              {...press(keep.clear)}>{tr("nt_pin_clear")}</button>
          ) : null}
        </>) : <span className="rl-hint">{tr("rk_none")}</span>}
      </RackField>

      {/* Whatever else the front matter holds. The backend keeps keys it does
          not know, so a note brought from somewhere else loses nothing. */}
      {Object.entries(note.fields || {})
        .filter(([k]) => !OWN.has(k))
        .map(([k, v]) => (
          <RackField key={k} label={<span className="rl-mono">{k}</span>}>
            <span className="rl-hint">{String(v ?? '')}</span>
          </RackField>
        ))}

      {/* How the note is LOOKED at, which is about the note rather than about
          its text — and markdown is the only kind with two ways. Reading takes
          the editor's place rather than standing beside it: the same words
          twice is not a comparison. */}
      {note.tex ? null : (
        <RackField label={tr("nt_tool_look")}>
          {slide ? (
            <button type="button" className="rl-btn" title={tr("nt_show_hint")} {...press(slide.show)}>{tr("nt_show")}</button>
          ) : (
            <button type="button" className={`rl-btn${read.on ? ' on' : ''}`} aria-pressed={read.on}
              title={tr("nt_preview_hint")} {...press(() => read.set(!read.on))}>{tr("nt_preview")}</button>
          )}
          <button type="button" className="rl-btn" title={tr("nt_print_hint")} {...press(print)}>{tr("nt_print")}</button>
        </RackField>
      )}

      {/* Compiling and the comments fold are the LaTeX tab's (tools/latex.jsx). */}

      <RackField label={tr("nt_tool_note")}>
        <span className="rl-hint">{tr("nt_n_words", words)}</span>
      </RackField>

      {/* A NEW note — the one thing here that is not about the note in front
          of you. It sat in the ⋯ menu; it is parked here because note has no
          other field grid. `daily` is a button rather than a line in the list
          because it is the one that gets pressed. */}
      {make ? (<>
        <RackField label={tr("nt_tool_new")}>
          <button type="button" className="rl-btn rl-go" title={tr("nt_today_hint")}
            {...press(make.daily)}>daily</button>
          {/* A template is a note in `templates/`, so this list is a folder
              listing and nothing more. */}
          {make.templates.length ? (
            <Select className="rl-in rl-pick" value=""
              onChange={(e) => { if (e.target.value) make.from(e.target.value) }}>
              <option value="">{tr("nt_from_template")}</option>
              {make.templates.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          ) : <span className="rl-hint">{tr("nt_tmpl_none")}</span>}
        </RackField>
        <Keep make={make} say={say} />
      </>) : null}
    </div>
  )
}

/** This note, kept as a template under a name. Its own little form: a name
 *  nobody typed yet is not a template, so the button waits for one. */
function Keep({ make, say }) {
  const [name, setName] = useState('')
  const keep = () => {
    if (!name.trim()) return
    make.save(name.trim()).then(() => setName('')).catch((e) => say(String(e.message || e)))
  }
  return (
    <RackField label={tr("nt_tmpl_keep")}>
      <input className="rl-in" value={name} placeholder={tr("nt_tmpl_name")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); keep() } }} />
      <button type="button" className="rl-btn" disabled={!name.trim()}
        title={tr("nt_tmpl_keep_hint")} {...press(keep)}>{tr("nt_tmpl_keep_do")}</button>
    </RackField>
  )
}

export default {
  id: 'common',
  label: 'nt_tool_common',
  modes: ['md', 'tex'],
  Body,
}
