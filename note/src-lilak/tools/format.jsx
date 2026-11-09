import '../strings.js'
import { useState } from 'react'
import { RackField } from 'racklist'
import { press } from './press.js'
import { RATIOS } from '../slides.jsx'
import { tr } from 'lilak-ui/i18n.jsx'

/** 서식 — the marks markdown is made of, put round what is selected.
 *
 *  Not a toolbar: a button you must open a column to reach is slower than the
 *  key, so the keys are in the editor (⌘B, ⌘I — SourceArea) and this is where
 *  you find out they exist. What it is really for is the line work — a list, a
 *  quote, a table — which no key spells.
 */
/** `- `, `1. `, `> `, `- [ ] `, `## ` — what a line already wears, and how
 *  long that is. A heading counts: otherwise pressing `##` twice wrote
 *  `## ## `, which is not a heading at all. */
const LEAD = /^([ \t]*)(?:([-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\][ \t]+)?|(>[ \t]?)|(#{1,6}[ \t]+))?/

/** `mark` put at the head of the line, over whatever it already wears: the
 *  SAME mark comes off (press twice to undo), a different one takes its place
 *  (`#` then `##` is a level-2 heading, not a `#` with nothing). Indentation
 *  stays either way, so a nested item nests still. */
export const leading = (text, mark) => {
  if (!text.trim()) return text          // a blank line is not a list item
  const m = LEAD.exec(text)
  const had = text.slice(m[1].length, m[0].length)
  return m[1] + (had === mark ? '' : mark) + text.slice(m[0].length)
}

/** A line with the room in front of it taken off.
 *
 *  Tabs go with the spaces: a line indented with one looks exactly like a line
 *  indented with the other, and "take the space off the front" said of a line
 *  that turns out to hold a tab is not an answer anybody wants twice.
 *
 *  A line of nothing BUT space becomes empty, which is what it looked like. */
export const unindent = (text) => text.replace(/^[ \t]+/, '')

/** `x` cells across and `y` rows of them, with the ruling under the first —
 *  which is the heading, so `y` counts the rows UNDER it, the way a person
 *  counting a table's rows does. */
export const table = (x, y) => {
  const row = `|${' |'.repeat(x)}`
  return [row, `|${' --- |'.repeat(x)}`, ...Array(Math.max(1, y)).fill(row), ''].join('\n')
}

function Body({ edit, slide, numbered }) {
  const [x, setX] = useState(3)
  const [y, setY] = useState(2)
  // Pressed twice, the mark comes off: the line is read before it is written.
  const line = (mark) => edit.lines((text) => leading(text, mark))
  return (
    <div className="rl-rec nt-fmt">
      {slide ? (
        <RackField label={tr("nt_fmt_ratio")}>
          {RATIOS.map(([k, label], i) => {
            const on = (slide.ratio || RATIOS[0][0]) === k
            return <button key={k} type="button" className={`rl-btn${on ? ' on' : ''}`} aria-pressed={on}
              {...press(() => slide.setRatio(k))}>{label}</button>
          })}
        </RackField>
      ) : null}
      {/* Round what is selected. The keys are in the editor; these say so. */}
      <RackField label={tr("nt_fmt_text")}>
        <button type="button" className="rl-btn" title={tr("nt_fmt_bold_hint")}
          {...press(() => edit.wrap('**'))}><b>{tr("nt_fmt_bold")}</b></button>
        <button type="button" className="rl-btn" title={tr("nt_fmt_italic_hint")}
          {...press(() => edit.wrap('*'))}><i>{tr("nt_fmt_italic")}</i></button>
        {/* Each button wears what it does: the fastest way to say what `~~`
            and a backtick come out as is to come out as it. */}
        <button type="button" className="rl-btn" {...press(() => edit.wrap('~~'))}><s>{tr("nt_fmt_strike")}</s></button>
        <button type="button" className="rl-btn" {...press(() => edit.wrap('`'))}><code className="nt-code">{tr("nt_fmt_code")}</code></button>
      </RackField>

      <RackField label={tr("nt_fmt_link_label")}>
        <button type="button" className="rl-btn" title={tr("nt_fmt_link")}
          {...press(() => edit.wrap('[', '](url)'))}>{tr("nt_fmt_link_do")}</button>
        <span className="rl-hint">{tr("nt_fmt_link_hint")}</span>
      </RackField>

      {/* Over the lines the selection touches, on and off. */}
      <RackField label={tr("nt_fmt_lines")}>
        <button type="button" className="rl-btn" {...press(() => line('- '))}>
          <span className="nt-fmt-as">•</span>{tr("nt_fmt_list")}</button>
        <button type="button" className="rl-btn" {...press(() => line('1. '))}>
          <span className="nt-fmt-as">1.</span>{tr("nt_fmt_num")}</button>
        <button type="button" className="rl-btn" {...press(() => line('- [ ] '))}>
          <span className="nt-fmt-as">☐</span>{tr("nt_fmt_todo")}</button>
        <button type="button" className="rl-btn" {...press(() => line('> '))}>
          <span className="nt-fmt-q">{tr("nt_fmt_quote")}</span></button>
        <span className="rl-hint">{tr("nt_fmt_again")}</span>
      </RackField>

      {/* Not a mark, so not in the row above: nothing toggles back on. */}
      <RackField label={tr("nt_fmt_space")}>
        <button type="button" className="rl-btn" title={tr("nt_fmt_dedent_hint")}
          {...press(() => edit.lines(unindent))}>{tr("nt_fmt_dedent")}</button>
      </RackField>

      <RackField label={tr("nt_fmt_head")}>
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" className="rl-btn" title={tr("nt_fmt_head_hint", n)}
            {...press(() => line(`${'#'.repeat(n)} `))}>{'#'.repeat(n)}</button>
        ))}
        <button type="button" className={`rl-btn${numbered.on ? ' on' : ''}`} aria-pressed={numbered.on}
          title={tr("nt_fmt_head_num_hint")} {...press(() => numbered.set(!numbered.on))}>{tr("nt_fmt_head_num")}</button>
      </RackField>

      {/* Say how many across and how many down, then make it. A form, so
          Enter makes it too. */}
      <RackField label={tr("nt_fmt_table")}>
        <form className="nt-tbl" onSubmit={(e) => { e.preventDefault(); edit.put(table(x, y)) }}>
          <label className="rl-hint">x
            <input className="rl-in nt-num" type="number" min="1" max="12" value={x}
              onChange={(e) => setX(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
          </label>
          <label className="rl-hint">y
            <input className="rl-in nt-num" type="number" min="1" max="40" value={y}
              onChange={(e) => setY(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} />
          </label>
          <button type="submit" className="rl-btn" title={tr("nt_fmt_table_hint", x, y)}>{tr("nt_fmt_make")}</button>
        </form>
        <span className="rl-hint">{tr("nt_fmt_table_how")}</span>
      </RackField>

    </div>
  )
}

export default {
  id: 'format',
  label: 'nt_tool_format',
  modes: ['md'],
  Body,
}
