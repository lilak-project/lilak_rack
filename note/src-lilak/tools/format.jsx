import '../strings.js'
import { useState } from 'react'
import { RackField } from 'racklist'
import { press } from './press.js'
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

/** `x` cells across and `y` rows of them, with the ruling under the first —
 *  which is the heading, so `y` counts the rows UNDER it, the way a person
 *  counting a table's rows does. */
export const table = (x, y) => {
  const row = `|${' |'.repeat(x)}`
  return [row, `|${' --- |'.repeat(x)}`, ...Array(Math.max(1, y)).fill(row), ''].join('\n')
}

function Body({ edit }) {
  const [x, setX] = useState(3)
  const [y, setY] = useState(2)
  // Pressed twice, the mark comes off: the line is read before it is written.
  const line = (mark) => edit.lines((text) => leading(text, mark))
  return (
    <div className="rl-rec nt-fmt">
      {/* Round what is selected. The keys are in the editor; these say so. */}
      <RackField label={tr("nt_fmt_text")}>
        <button type="button" className="rl-btn" title={tr("nt_fmt_bold_hint")}
          {...press(() => edit.wrap('**'))}><b>{tr("nt_fmt_bold")}</b></button>
        <button type="button" className="rl-btn" title={tr("nt_fmt_italic_hint")}
          {...press(() => edit.wrap('*'))}><i>{tr("nt_fmt_italic")}</i></button>
        <button type="button" className="rl-btn" {...press(() => edit.wrap('~~'))}>{tr("nt_fmt_strike")}</button>
        <button type="button" className="rl-btn rl-mono" {...press(() => edit.wrap('`'))}>{tr("nt_fmt_code")}</button>
      </RackField>

      <RackField label={tr("nt_fmt_link_label")}>
        <button type="button" className="rl-btn" title={tr("nt_fmt_link")}
          {...press(() => edit.wrap('[', '](url)'))}>{tr("nt_fmt_link_do")}</button>
        <span className="rl-hint">{tr("nt_fmt_link_hint")}</span>
      </RackField>

      {/* Over the lines the selection touches, on and off. */}
      <RackField label={tr("nt_fmt_lines")}>
        <button type="button" className="rl-btn" {...press(() => line('- '))}>{tr("nt_fmt_list")}</button>
        <button type="button" className="rl-btn" {...press(() => line('1. '))}>{tr("nt_fmt_num")}</button>
        <button type="button" className="rl-btn" {...press(() => line('- [ ] '))}>{tr("nt_fmt_todo")}</button>
        <button type="button" className="rl-btn" {...press(() => line('> '))}>{tr("nt_fmt_quote")}</button>
        <span className="rl-hint">{tr("nt_fmt_again")}</span>
      </RackField>

      <RackField label={tr("nt_fmt_head")}>
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" className="rl-btn" title={tr("nt_fmt_head_hint", n)}
            {...press(() => line(`${'#'.repeat(n)} `))}>{'#'.repeat(n)}</button>
        ))}
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

      <RackField label={tr("nt_fmt_rest")}>
        <span className="rl-hint">{tr("nt_fmt_typed")}</span>
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
