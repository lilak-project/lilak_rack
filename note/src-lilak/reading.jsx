import './strings.js'
import { Children } from 'react'
// The same renderer elog writes its logs with: GFM (so `- [ ]` is a checkbox)
// and one newline means one line break, because a note is typed, not typeset.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { remarkSoftBreaks } from 'lilak-ui/log/Markdown.jsx'
import { tr } from 'lilak-ui/i18n.jsx'
import { TAG_RE, PROJ_RE, AUTH_RE, URGENT_RE, FIGURE_RE, embedSpec, figureOf, isAudio, isPicture, isProject, isAuthor, authorShow, overdue, plainRules, replaceOutsideCode, dropComments, highlightSpans, withArrows } from './marks.js'
import { fileSrc } from './api.js'

/** The body, rendered — with `#태그` drawn as a tag and `» 2026-12-24` as the
 *  calendar label the editor draws, rather than left as the text they are in
 *  the file. react-markdown hands text through as strings, so both are picked
 *  out of those on the way to the page. `box` is the todo's checkbox, if this
 *  is a todo: a checked one has no day to be late for, and only an open one is
 *  urgent. */
const CHIP_RE = new RegExp(`${TAG_RE.source}|(»|📅|✓|✅)\\s*(\\d{4}-\\d{1,2}-\\d{1,2})|${PROJ_RE.source}|${AUTH_RE.source}|(?<!!)\\[\\[([^\\]]+)\\]\\]|${URGENT_RE.source}`, 'g')

function tagify(children, box) {
  const done = !!box?.properties.checked
  return Children.map(children, (child) => {
    if (typeof child !== 'string') return child
    const out = []
    let last = 0
    for (const m of child.matchAll(CHIP_RE)) {
      // A tag (lead + #name), a date (mark + day), a project (lead + +name) or
      // a person (lead + @name) — one project_manager or author_manager has;
      // any other `+word` or `@word` stays text. A name two people answer to
      // is nobody in particular, so it stays text too (isAuthor).
      const tag = m[2] !== undefined, proj = m[6] !== undefined, auth = m[8] !== undefined
      const wiki = m[9] !== undefined, urgent = m[10] !== undefined
      if (urgent && (!box || done)) continue
      if (proj && !isProject(m[6])) continue
      if (auth && !isAuthor(m[8])) continue
      const at = m.index + (tag ? m[1].length : proj ? m[5].length : auth ? m[7].length : urgent ? m[10].length : 0)
      if (at > last) out.push(child.slice(last, at))
      out.push(tag ? <span className="nt-tag" key={at}>{m[2]}</span>
        : proj ? <span className="nt-proj" key={at}>{m[6]}</span>
          : auth ? <span className="nt-auth" key={at}>{authorShow(m[8])}</span>
            : wiki ? <span className="nt-cm-wiki" key={at}>{m[9].split('|').pop().trim()}</span>
              : urgent ? <span className="nt-urgent" key={at}>!!</span>
                : <span className={'»📅'.includes(m[3]) ? `nt-due-in${!done && overdue(m[4]) ? ' nt-due-late' : ''}` : 'nt-done-in'} key={at}>{m[4]}</span>)
      last = at + (tag ? 1 + m[2].length : proj ? 1 + m[6].length : auth ? 1 + m[8].length : urgent ? 2 : m[0].length)
    }
    out.push(child.slice(last))
    return out
  })
}
const tagged = (Tag) => function Tagged({ node, children, ...rest }) {
  return <Tag {...rest}>{tagify(children, node?.children.find((c) => c.tagName === 'input'))}</Tag>
}
/** `![alt|400](…)` — the width rides in the alt text, as it does in the
 *  editor and in Obsidian. */
function Img({ node, alt, title, ...rest }) {
  const [text, w] = embedSpec(alt || '')
  // What it is goes by the address, because the alt of `![설명](a.png)` is words.
  // An embed that is not a picture — a pdf, a sheet, a document — is handed
  // over as a file rather than drawn as a broken image.
  if (isAudio(rest.src)) return <audio className="nt-audio" controls preload="none" src={rest.src} />
  if (!isPicture(rest.src)) {
    return <a className="nt-file" href={rest.src} target="_blank" rel="noreferrer">{text}</a>
  }
  const img = <img alt={text} {...rest} style={w ? { width: `${w}px` } : undefined} />
  // A title is the one thing markdown lets a picture carry: the slides' caption.
  return title ? <span className="nt-fig-wrap">{img}<span className="nt-fig-cap">{title}</span></span> : img
}
/** A link out of the note opens a tab of its own: this page is inside the
 *  portal's frame, and a site that refuses to be framed would otherwise just
 *  not arrive. */
function Link({ node, ...rest }) {
  if (rest.href === HIGHLIGHT) return <mark className="nt-hl">{tagify(rest.children)}</mark>
  return <a {...rest} target="_blank" rel="noreferrer" />
}
const HIGHLIGHT = '#nt-highlight'
const RENDER = {
  p: tagged('p'), li: tagged('li'), td: tagged('td'), blockquote: tagged('blockquote'),
  h1: tagged('h1'), h2: tagged('h2'), h3: tagged('h3'), h4: tagged('h4'), h5: tagged('h5'), h6: tagged('h6'),
  img: Img, a: Link,
}
/** `==말==` written as a link to nowhere (Link, above), because a link is the
 *  inline thing markdown already reads the insides of: `==**굵게**==` stays
 *  bold. Same line, so `data-line` still holds. */
function highlighted(text) {
  let out = '', last = 0
  for (const [a, b] of highlightSpans(text)) {
    out += `${text.slice(last, a)}[${text.slice(a + 2, b - 2).replace(/[[\]]/g, '\\$&')}](${HIGHLIGHT})`
    last = b
  }
  return out + text.slice(last)
}
/** `$$x$$` in a line is what the parser calls inline, and a display formula
 *  everywhere else in this app. The dollars are gone by here; the source span
 *  still says how many there were. */
const isMath = (n, cls) => n.tagName === 'code' && n.properties?.className?.includes(cls)
const rehypeDisplay = () => (tree) => {
  const walk = (n) => {
    if (isMath(n, 'math-inline') && n.position && n.position.end.offset - n.position.start.offset >= n.children[0].value.length + 4) {
      n.properties.className = ['language-math', 'math-display']
    }
    n.children?.forEach(walk)
  }
  walk(tree)
}
/** Each element says which line of the file it came from (`data-line`), so a
 *  slide can be cut where the renderer says the page ends (slides.jsx). A `$$`
 *  block is swapped whole for what KaTeX draws, so the line goes on a box
 *  around it. */
const rehypeLines = () => (tree) => {
  const walk = (n) => {
    if (n.type === 'element' && n.position) (n.properties ||= {}).dataLine = n.position.start.line
    n.children?.forEach((c, i) => {
      if (c.tagName === 'pre' && c.children.some((x) => isMath(x, 'math-display'))) {
        n.children[i] = { type: 'element', tagName: 'div', properties: {}, position: c.position, children: [c] }
        n.children[i].properties.dataLine = c.position.start.line
      } else walk(c)
    })
  }
  walk(tree)
}
/** `figures`: draw each picture's number under it, counting on from that many
 *  (a slide is handed only its own part of the note). */
export function Rendered({ children, lines = false, figures }) {
  // Maths is `$x^2$` and `$$…$$`, which KaTeX draws here and the editor leaves
  // as the text it is — the file is the same either way.
  // `![[name]]` is Obsidian's embed, not markdown — here it is turned into the
  // markdown image it means. Only on the way to the page: the file keeps its
  // own spelling.
  let n = figures
  const md = replaceOutsideCode(plainRules(highlighted(withArrows(dropComments(children)))), FIGURE_RE, (all, spec, alt) => {
    const f = figureOf(all)
    const cap = figures != null && f.picture ? ` "${tr('nt_fig_n', n += 1)}"` : ''
    return `![${spec ?? alt}](${f.url(fileSrc)}${cap})`
  })
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkSoftBreaks]}
      rehypePlugins={lines ? [rehypeDisplay, rehypeLines, rehypeKatex] : [rehypeDisplay, rehypeKatex]} components={RENDER}>
      {md}
    </ReactMarkdown>
  )
}

