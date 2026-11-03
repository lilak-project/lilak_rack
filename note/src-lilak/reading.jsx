import './strings.js'
import { Children } from 'react'
// The same renderer elog writes its logs with: GFM (so `- [ ]` is a checkbox)
// and one newline means one line break, because a note is typed, not typeset.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { remarkSoftBreaks } from 'lilak-ui/log/Markdown.jsx'
import { TAG_RE, PROJ_RE, AUTH_RE, EMBED_RE, embedSpec, isImage, isProject, isAuthor, authorShow } from './marks.js'
import { fileSrc } from './api.js'

/** The body, rendered — with `#태그` drawn as a tag and `» 2026-12-24` as the
 *  calendar label the editor draws, rather than left as the text they are in
 *  the file. react-markdown hands text through as strings, so both are picked
 *  out of those on the way to the page. */
const CHIP_RE = new RegExp(`${TAG_RE.source}|(»|📅|✓|✅)\\s*(\\d{4}-\\d{1,2}-\\d{1,2})|${PROJ_RE.source}|${AUTH_RE.source}`, 'g')

function tagify(children) {
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
      if (proj && !isProject(m[6])) continue
      if (auth && !isAuthor(m[8])) continue
      const at = m.index + (tag ? m[1].length : proj ? m[5].length : auth ? m[7].length : 0)
      if (at > last) out.push(child.slice(last, at))
      out.push(tag ? <span className="nt-tag" key={at}>{m[2]}</span>
        : proj ? <span className="nt-proj" key={at}>{m[6]}</span>
          : auth ? <span className="nt-auth" key={at}>{authorShow(m[8])}</span>
            : <span className={'»📅'.includes(m[3]) ? 'nt-due-in' : 'nt-done-in'} key={at}>{m[4]}</span>)
      last = at + (tag ? 1 + m[2].length : proj ? 1 + m[6].length : auth ? 1 + m[8].length : m[0].length)
    }
    out.push(child.slice(last))
    return out
  })
}
const tagged = (Tag) => function Tagged({ node, children, ...rest }) {
  return <Tag {...rest}>{tagify(children)}</Tag>
}
/** `![alt|400](…)` — the width rides in the alt text, as it does in the
 *  editor and in Obsidian. */
function Img({ node, alt, ...rest }) {
  const [text, w] = embedSpec(alt || '')
  // An embed that is not a picture — a pdf, a sheet, a document — is handed
  // over as a file rather than drawn as a broken image.
  if (!isImage(text)) {
    return <a className="nt-file" href={rest.src} target="_blank" rel="noreferrer">{text}</a>
  }
  return <img alt={text} {...rest} style={w ? { width: `${w}px` } : undefined} />
}
/** A link out of the note opens a tab of its own: this page is inside the
 *  portal's frame, and a site that refuses to be framed would otherwise just
 *  not arrive. */
function Link({ node, ...rest }) {
  return <a {...rest} target="_blank" rel="noreferrer" />
}
const RENDER = {
  p: tagged('p'), li: tagged('li'), td: tagged('td'), blockquote: tagged('blockquote'),
  h1: tagged('h1'), h2: tagged('h2'), h3: tagged('h3'), h4: tagged('h4'),
  img: Img, a: Link,
}
export function Rendered({ children }) {
  // Maths is `$x^2$` and `$$…$$`, which KaTeX draws here and the editor leaves
  // as the text it is — the file is the same either way.
  // `![[name]]` is Obsidian's embed, not markdown — here it is turned into the
  // markdown image it means. Only on the way to the page: the file keeps its
  // own spelling.
  const md = String(children || '').replace(EMBED_RE, (_, spec) => {
    const [name] = embedSpec(spec)
    return `![${spec}](${fileSrc(name)})`
  })
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkSoftBreaks]}
      rehypePlugins={[rehypeKatex]} components={RENDER}>
      {md}
    </ReactMarkdown>
  )
}

