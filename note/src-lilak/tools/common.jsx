import '../strings.js'
import { useState } from 'react'
import { RackField } from 'racklist'
import { comments } from '../comments.js'
import { press } from './press.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** 공용 — what every note has, whatever it is written in.
 *
 *  This was the fold beside the title (`정보`), which could hold a line of
 *  things and no more. It is a field grid now, the same one activity's editor
 *  is: label on the left, the thing on the right.
 */
function Body({ note, setNote, go, keep, where, read, slide, print, say, ask, tags, words, fold, tex, make }) {
  const { pins, last, marks } = keep
  return (
    <div className="rl-rec nt-common">
      <RackField label={tr("nt_date")}>
        <input type="date" className="rl-in nt-date" value={note.date || ''}
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
        .filter(([k]) => k !== 'format' && k !== 'reference' && k !== 'ratio' && k !== 'numbered' && k !== 'mode')
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

      {/* What a LaTeX note DOES, as against what it is: typeset it, and put
          the commented-out half of it out of the way. Both are one press, so
          both are a row here rather than a tab of their own. */}
      {tex ? (<>
        <RackField label={tr("nt_tab_compile")}>
          <button type="button" className="rl-btn nt-go" disabled={tex.busy || tex.asPdf}
            title={tex.asPdf ? tr("nt_tex_fresh") : undefined} {...press(tex.compile)}>
            {tex.busy ? tr("nt_tex_running") : tr("nt_tex_compile")}</button>
          {/* Two ways to read what came out: a tab of this app's own beside
              the text, or a browser tab with the whole PDF viewer in it. */}
          {tex.pdfAt ? (<>
            {/* Solo — one note inside another service — has no tab strip of
                its own to open one in. */}
            {tex.rtab ? <button type="button" className="rl-btn" title={tr("nt_tex_rtab_hint")}
              {...press(tex.rtab)}>{tr("nt_tex_rtab")}</button> : null}
            <button type="button" className="rl-btn" title={tr("nt_tex_btab_hint")}
              {...press(tex.btab)}>{tr("nt_tex_btab")}</button>
          </>) : <span className="rl-hint">{tr("nt_tex_nopdf")}</span>}
        </RackField>
        {/* When it last came out, and whether that is still this text. */}
        {tex.pdfAt ? (
          <RackField label={tr("nt_tex_made")}>
            <span className="rl-hint">{tex.madeAt}</span>
            {tex.asPdf ? null : <span className="rl-hint nt-ref-no">{tr("nt_tex_stale")}</span>}
          </RackField>
        ) : null}
        {tex.errs?.length ? (
          <RackField label={tr("nt_tex_stopped")}>
            <div className="nt-texerr">
              {tex.errs.map((e, i) => (
                <div key={i}>{e.line ? (
                  <button type="button" className="rl-btn nt-pin-go" title={tr("nt_pin_go", e.line)}
                    {...press(() => go(e.line))}>{e.line}</button>
                ) : null}{e.text}</div>
              ))}
            </div>
          </RackField>
        ) : null}
        <RackField label={tr("nt_tool_comments")}>
          <button type="button" className={`rl-btn${fold.on ? ' on' : ''}`} aria-pressed={fold.on}
            title={tr("nt_cmt_hint")} {...press(() => fold.set(!fold.on))}>{tr("nt_cmt_fold")}</button>
          <span className="rl-hint">{tr("nt_cmt_n", comments(note.body).length)}</span>
        </RackField>
      </>) : null}

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
            <select className="rl-in rl-pick" value=""
              onChange={(e) => { if (e.target.value) make.from(e.target.value) }}>
              <option value="">{tr("nt_from_template")}</option>
              {make.templates.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
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
