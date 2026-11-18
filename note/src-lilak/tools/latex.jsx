import '../strings.js'
import { useState } from 'react'
import { RackField } from 'racklist'
import { comments } from '../comments.js'
import { press } from './press.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** LaTeX — what a tex note does and what it is written with: typeset it, fold
 *  its comments away, and the commands that are typed over and over, put round
 *  what is selected. The tex note's own `서식`, with the compile that used to
 *  stand in `공용`.
 *
 *  Like 서식, these are not a toolbar: they are where the spelling is found
 *  (`\textbf{…}`, the six lines a figure takes) by someone who does not type
 *  it every day. Each writes plain LaTeX; nothing here is a second syntax.
 */

/** `\section{…}` round a line's words, over whatever heading it already
 *  wears: the same one comes off (press twice to undo), another takes its
 *  place. Indentation stays. */
const HEAD = /^(\s*)\\(?:sub){0,2}section\*?\{(.*)\}\s*$/
export const heading = (text, cmd) => {
  if (!text.trim()) return text
  const m = HEAD.exec(text)
  const indent = m ? m[1] : /^\s*/.exec(text)[0]
  const words = m ? m[2] : text.trim()
  return m && text.trim().startsWith(`\\${cmd}{`) ? indent + words : `${indent}\\${cmd}{${words}}`
}

/** `% ` in front of a line, or off it. */
export const commented = (text) => (/^\s*%/.test(text) ? text.replace(/^(\s*)% ?/, '$1') : text.replace(/^(\s*)/, '$1% '))

/** The selected lines as the items of a list, in its environment. Nothing
 *  selected: one empty item to type in. */
export const listOf = (env, sel) => {
  const items = sel.split('\n').map((l) => l.trim()).filter(Boolean)
  return `\\begin{${env}}\n${(items.length ? items : ['']).map((l) => `  \\item ${l}`).join('\n')}\n\\end{${env}}\n`
}

/** What is selected, inside an environment (`quote`, `center`, `abstract`). */
export const inEnv = (env, sel) => `\\begin{${env}}\n${sel.trim() ? sel.replace(/\n+$/, '') : '  '}\n\\end{${env}}\n`

/** `x` columns and `y` rows under a heading row, ruled the plain way. */
export const tabular = (x, y) => {
  const row = `  ${Array(x).fill('').join(' & ')} \\\\`
  return [
    '\\begin{table}[htbp]', '  \\centering', `  \\begin{tabular}{${'l'.repeat(x)}}`, '    \\hline',
    `  ${row}`, '    \\hline', ...Array(Math.max(1, y)).fill(`  ${row}`), '    \\hline',
    '  \\end{tabular}', '  \\caption{}', '  \\label{tab:}', '\\end{table}', '',
  ].join('\n')
}

const FIGURE = ['\\begin{figure}[htbp]', '  \\centering', '  \\includegraphics[width=0.8\\linewidth]{}',
  '  \\caption{}', '  \\label{fig:}', '\\end{figure}', ''].join('\n')
const EQUATION = ['\\begin{equation}', '  ', '  \\label{eq:}', '\\end{equation}', ''].join('\n')
const ALIGN = ['\\begin{align}', '   &=  \\\\', '   &= ', '\\end{align}', ''].join('\n')

function Body({ note, edit, go, fold, tex }) {
  const [x, setX] = useState(3)
  const [y, setY] = useState(2)
  const wrap = (before, after = '}') => () => edit.wrap(before, after)
  const cmd = (name, face) => (
    <button key={name} type="button" className="rl-btn" title={`\\${name}{…}`} {...press(wrap(`\\${name}{`))}>{face}</button>
  )
  return (
    <div className="rl-rec nt-fmt">
      {/* Typeset it, and read what came out. */}
      <RackField label={tr("nt_tab_compile")}>
        <button type="button" className="rl-btn nt-go" disabled={tex.busy || tex.asPdf}
          title={tex.asPdf ? tr("nt_tex_fresh") : undefined} {...press(tex.compile)}>
          {tex.busy ? tr("nt_tex_running") : tr("nt_tex_compile")}</button>
        {/* Two ways to read the PDF: a tab of this app's own beside the text,
            or a browser tab with the whole PDF viewer in it. */}
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
        <button type="button" className="rl-btn" title={tr("nt_ltx_comment_hint")}
          {...press(() => edit.lines(commented))}>%</button>
        <span className="rl-hint">{tr("nt_cmt_n", comments(note.body).length)}</span>
      </RackField>

      {/* Round what is selected; pressed again, off it comes (wrapSel). */}
      <RackField label={tr("nt_fmt_text")}>
        {cmd('textbf', <b>{tr("nt_fmt_bold")}</b>)}
        {cmd('textit', <i>{tr("nt_fmt_italic")}</i>)}
        {cmd('emph', <em>emph</em>)}
        {cmd('underline', <u>{tr("nt_ltx_under")}</u>)}
        {cmd('texttt', <code className="nt-code">{tr("nt_fmt_code")}</code>)}
        {cmd('footnote', tr("nt_ltx_footnote"))}
      </RackField>

      <RackField label={tr("nt_ltx_math")}>
        <button type="button" className="rl-btn" title="$…$" {...press(wrap('$', '$'))}>$x$</button>
        <button type="button" className="rl-btn" title="\[ … \]" {...press(wrap('\\[\n  ', '\n\\]'))}>\[ \]</button>
        <button type="button" className="rl-btn" title="equation" {...press(() => edit.put(EQUATION))}>equation</button>
        <button type="button" className="rl-btn" title="align" {...press(() => edit.put(ALIGN))}>align</button>
      </RackField>

      {/* Over the lines the selection touches, on and off. */}
      <RackField label={tr("nt_fmt_head")}>
        {['section', 'subsection', 'subsubsection'].map((c, i) => (
          <button key={c} type="button" className="rl-btn" title={`\\${c}{…}`}
            {...press(() => edit.lines((t) => heading(t, c)))}>{'§'.repeat(i + 1)}</button>
        ))}
        <span className="rl-hint">{tr("nt_fmt_again")}</span>
      </RackField>

      <RackField label={tr("nt_fmt_lines")}>
        <button type="button" className="rl-btn" title="itemize" {...press(() => edit.swap((s) => listOf('itemize', s)))}>
          <span className="nt-fmt-as">•</span>{tr("nt_fmt_list")}</button>
        <button type="button" className="rl-btn" title="enumerate" {...press(() => edit.swap((s) => listOf('enumerate', s)))}>
          <span className="nt-fmt-as">1.</span>{tr("nt_fmt_num")}</button>
        <button type="button" className="rl-btn" title="quote" {...press(() => edit.swap((s) => inEnv('quote', s)))}>
          <span className="nt-fmt-q">{tr("nt_fmt_quote")}</span></button>
        <button type="button" className="rl-btn" title="center" {...press(() => edit.swap((s) => inEnv('center', s)))}>{tr("nt_ltx_center")}</button>
      </RackField>

      {/* What points at what. The keys themselves are in 목차 (labels) and
          참고문헌 (cite keys); these write the command round a name. */}
      <RackField label={tr("nt_ltx_refs")}>
        <button type="button" className="rl-btn" title="\label{…}" {...press(wrap('\\label{'))}>label</button>
        <button type="button" className="rl-btn" title="\ref{…}" {...press(wrap('\\ref{'))}>ref</button>
        <button type="button" className="rl-btn" title="\eqref{…}" {...press(wrap('\\eqref{'))}>eqref</button>
        <button type="button" className="rl-btn" title="\cite{…}" {...press(wrap('\\cite{'))}>cite</button>
        <button type="button" className="rl-btn" title="\url{…}" {...press(wrap('\\url{'))}>url</button>
      </RackField>

      <RackField label={tr("nt_ltx_figure")}>
        <button type="button" className="rl-btn" title={tr("nt_ltx_figure_hint")} {...press(() => edit.put(FIGURE))}>figure</button>
        <button type="button" className="rl-btn" title="\includegraphics[width=…]{…}"
          {...press(wrap('\\includegraphics[width=0.8\\linewidth]{'))}>includegraphics</button>
      </RackField>

      {/* Say how many across and how many down, then make it. */}
      <RackField label={tr("nt_fmt_table")}>
        <form className="nt-tbl" onSubmit={(e) => { e.preventDefault(); edit.put(tabular(x, y)) }}>
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
      </RackField>
    </div>
  )
}

export default {
  id: 'latex',
  label: 'nt_tool_latex',
  modes: ['tex'],
  // A compile that stopped: the dot the 공용 tab used to wear for it.
  badge: ({ tex }) => (tex?.errs?.length ? 'dot' : null),
  Body,
}
