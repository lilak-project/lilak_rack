import '../strings.js'
import { outsideCode } from '../marks.js'
import { press } from './press.js'
import { tr } from 'lilak-ui'

/** 목차 — the note's own headings, as a list that goes there.
 *
 *  The first tool two kinds of note share. `#` and `\section` are the same
 *  thing said in two spellings, so the tool is one and only the reading of a
 *  line is two — which is the whole point of `modes` holding both.
 */
const MD = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/
const TEX = /^[ \t]*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?[ \t]*(?:\[[^\]]*\])?[ \t]*\{/

/** What `{` opens, to the `}` that closes IT — `\section{A}\label{b}` is one
 *  heading called A, and a regex to the last brace on the line called it
 *  `A}\label{b`. */
const braced = (line, open) => {
  let depth = 0
  for (let i = open; i < line.length; i += 1) {
    if (line[i] === '{') depth += 1
    else if (line[i] === '}' && --depth === 0) return line.slice(open + 1, i)
  }
  return line.slice(open + 1)
}
const DEPTH = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 }

/** `\textit{Gamma} rays` → `Gamma rays`: a heading is read, not compiled. */
const plain = (s) => String(s).replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}$\\]/g, '').trim()

/** [{ n, depth, text }] — the headings of a body, in the order they stand.
 *  Code is not prose: a `# comment` in a ```fence is not a heading (marks.js). */
export function headings(body, tex) {
  const out = []
  outsideCode(body).split('\n').forEach((line, i) => {
    const m = (tex ? TEX : MD).exec(line)
    if (!m) return
    out.push(tex
      ? { n: i + 1, depth: DEPTH[m[1]] || 3, text: plain(braced(line, m[0].length - 1)) }
      : { n: i + 1, depth: m[1].length, text: m[2] })
  })
  return out
}

const LABEL = /\\label\s*\{([^}]+)\}/g
// `\ref`, `\eqref`, `\autoref`, `\cref`, `\Cref`, `\pageref` — and `\cref{a,b}`
// names several at once.
const REF = /\\(?:page|auto|eq|[cC])?refs?\s*\{([^}]+)\}/g

/** { labels: [{ name, n, used, dup }], loose: [{ name, n }], dups: [name] } —
 *  the labels a body defines with where they stand and how often they are
 *  called for, the calls that name nothing, and the names defined twice.
 *  Comments are LaTeX's own: a `%` line is not in the document, so neither is
 *  its label. */
export function refMap(body) {
  const lines = String(body || '').split('\n')
  const labels = []
  const calls = []
  lines.forEach((raw, i) => {
    // Everything after an unescaped `%` is a comment, and `\%` is a percent.
    const line = raw.replace(/\\%/g, '\u0000').split('%')[0]
    for (const m of line.matchAll(LABEL)) labels.push({ name: m[1].trim(), n: i + 1, used: 0 })
    for (const m of line.matchAll(REF)) {
      for (const k of m[1].split(',').map((x) => x.trim())) if (k) calls.push({ name: k, n: i + 1 })
    }
  })
  // The LAST definition wins, which is also LaTeX's own answer: the .aux is
  // written in order and `\ref` resolves to whatever was written last. So the
  // count lands on the last one and the earlier one reads as unused — which is
  // exactly the trouble a duplicate causes, said plainly.
  const by = new Map(labels.map((l) => [l.name, l]))
  const loose = []
  for (const c of calls) {
    const l = by.get(c.name)
    if (l) l.used += 1
    else if (!loose.some((x) => x.name === c.name)) loose.push(c)
  }
  // Defined twice: LaTeX says `multiply defined labels` and carries on with
  // the last, so the figure you meant is not the figure it numbers.
  const seen = new Map()
  for (const l of labels) seen.set(l.name, (seen.get(l.name) || 0) + 1)
  for (const l of labels) l.dup = seen.get(l.name) > 1
  return { labels, loose, dups: [...seen].filter(([, n]) => n > 1).map(([name]) => name) }
}

function Body({ note, go, edit }) {
  const rows = headings(note.body, note.tex)
  // The shallowest heading in THIS note is the left edge: a document whose
  // every heading is `\subsection` is not indented four steps for it.
  const top = rows.length ? Math.min(...rows.map((r) => r.depth)) : 1
  // A LaTeX document's other table of contents: what it can point AT.
  const { labels, loose, dups } = note.tex ? refMap(note.body) : { labels: [], loose: [], dups: [] }
  return (<>
    {!rows.length ? <p className="rl-hint nt-empty">{tr("nt_outline_none")}</p> : (
      <div className="nt-outline">
        {rows.map((r) => (
          <button key={`${r.n}`} type="button" className="nt-out" title={tr("nt_pin_go", r.n)}
            style={{ paddingLeft: `${8 + (r.depth - top) * 14}px` }}
            {...press(() => go(r.n))}>
            <span className="nt-out-text">{r.text}</span>
            <span className="rl-hint nt-out-n">{r.n}</span>
          </button>
        ))}
      </div>
    )}

    {/* `\label` and what points at it — the same question as the outline (where
        is what), so the same list rather than a tab of its own. */}
    {note.tex ? (<>
      <div className="nt-mrow nt-outline-head">
        <span className="rl-hint">{tr("nt_refs_head", labels.length)}</span>
      </div>
      {dups.length ? (
        <div className="nt-texerr">{tr("nt_refs_dup", dups.length)} <b className="rl-mono">{dups.join(', ')}</b></div>
      ) : null}
      {loose.length ? (
        <div className="nt-texerr">
          {tr("nt_refs_loose", loose.length)}{' '}
          {loose.map((c) => (
            <button key={c.name} type="button" className="rl-btn nt-pin-go" title={tr("nt_pin_go", c.n)}
              {...press(() => go(c.n))}>{c.name}</button>
          ))}
        </div>
      ) : null}
      {!labels.length ? <p className="rl-hint nt-empty">{tr("nt_refs_none")}</p> : (
        <ul className="nt-refs">
          {labels.map((l) => (
            <li key={`${l.name}:${l.n}`} className={`${l.used ? '' : 'off'}${l.dup ? ' dup' : ''}`}>
              <button type="button" className="nt-out" title={tr("nt_pin_go", l.n)} {...press(() => go(l.n))}>
                <span className="nt-out-text rl-mono">{l.name}</span>
                {l.dup ? <span className="nt-dupmark" title={tr("nt_refs_dup_hint")}>{tr("nt_refs_dup_one")}</span> : null}
                <span className="rl-hint nt-out-n">{l.used ? tr("nt_refs_used", l.used) : tr("nt_refs_unused")}</span>
                <span className="rl-hint nt-out-n">{l.n}</span>
              </button>
              <button type="button" className="rl-btn" title={tr("nt_refs_put")}
                {...press(() => edit.put(`\\ref{${l.name}}`))}>{tr("nt_file_put_do")}</button>
            </li>
          ))}
        </ul>
      )}
    </>) : null}
  </>)
}

export default {
  id: 'outline',
  label: 'nt_tool_outline',
  modes: ['md', 'tex'],
  // A `\ref` that names nothing, a label defined twice: the PDF says `??` and
  // numbers the wrong figure, and neither is visible in the text.
  badge: ({ note }) => {
    if (!note.tex) return null
    const { loose, dups } = refMap(note.body)
    return loose.length + dups.length || null
  },
  Body,
}
