import './strings.js'
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * Find inside an editor pane: ⌘F while you are looking at an editor (the last
 * press or focus was in it) opens this bar at the pane's top instead of the
 * list's search. Every match is lit, the current one brighter and scrolled to;
 * Enter goes on, ⇧Enter back, Esc closes.
 *
 * What it reads, in the pane's order:
 *   - the text on screen (lit with the CSS Custom Highlight API);
 *   - what is typed in the fields (input, textarea: the field is outlined and
 *     scrolled to, as a field's value cannot be lit);
 *   - an editor that shows only part of its text at a time (CodeMirror) says
 *     how to search the rest: `el.rackFind = { find(q) => n, show(i) => Range?, clear() }`
 *     on its element (note's SourceArea); show may answer later (a Promise).
 */
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SELECT', 'OPTION'])
const FIELD = (el) => el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && ['', 'text', 'search', 'email', 'url', 'tel'].includes(el.getAttribute('type') || ''))

function hitsIn(root, q) {
  const out = []
  if (!q) return out
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
      if (n.classList?.contains('rl-pfind') || SKIP.has(n.tagName) || n.rackFind || FIELD(n)) {
        // Read below, as a whole; nothing inside it is walked.
        return n.classList?.contains('rl-pfind') || SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      }
      return NodeFilter.FILTER_SKIP
    },
  })
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const s = n.data.toLowerCase()
      for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + q.length)) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + q.length)
        out.push({ range: r })
      }
    } else if (n.rackFind) {
      const k = n.rackFind.find(q)
      for (let i = 0; i < k; i += 1) out.push({ editor: n, i })
      walk.currentNode = lastIn(n)
    } else {
      const s = String(n.value || '').toLowerCase()
      for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + q.length)) out.push({ field: n, at: i })
      walk.currentNode = lastIn(n)            // a textarea's text child is its first value, not its value
    }
  }
  return out
}
const lastIn = (el) => { let x = el; while (x.lastChild) x = x.lastChild; return x }

const lit = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined'
function paint(hits, now) {
  if (lit) {
    CSS.highlights.set('rl-find', new Highlight(...hits.filter((h) => h.range).map((h) => h.range)))
    const cur = hits[now]
    if (cur?.range) CSS.highlights.set('rl-find-now', new Highlight(cur.range))
    else CSS.highlights.delete('rl-find-now')
  }
  document.querySelectorAll('.rl-find-field').forEach((el) => el.classList.remove('rl-find-field', 'now'))
  for (const h of hits) if (h.field) h.field.classList.add('rl-find-field')
  const cur = hits[now]
  if (!cur) return
  if (cur.range) cur.range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
  if (cur.field) { cur.field.classList.add('now'); cur.field.scrollIntoView({ block: 'center', inline: 'nearest' }) }
  // An editor scrolls to its match and hands back where it is now on screen.
  if (cur.editor) {
    Promise.resolve(cur.editor.rackFind.show(cur.i)).then((r) => {
      if (r && lit) CSS.highlights.set('rl-find-now', new Highlight(r))
    })
  }
}
function unpaint(root) {
  if (lit) { CSS.highlights.delete('rl-find'); CSS.highlights.delete('rl-find-now') }
  document.querySelectorAll('.rl-find-field').forEach((el) => el.classList.remove('rl-find-field', 'now'))
  root?.querySelectorAll('*').forEach((el) => el.rackFind?.clear?.())
}

/** The bar. `again` changes when ⌘F is pressed once more (back to the box). */
export function PaneFind({ again, onClose }) {
  const box = useRef(null)
  const [q, setQ] = useState('')
  const [now, setNow] = useState(0)
  const [hits, setHits] = useState([])
  const root = () => box.current?.closest('.rl-epane')
  useEffect(() => { box.current?.querySelector('input')?.select() }, [again])
  useEffect(() => {
    const h = hitsIn(root(), q.trim().toLowerCase())
    setHits(h)
    setNow(0)
    paint(h, 0)
  }, [q])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => unpaint(root()), [])   // eslint-disable-line react-hooks/exhaustive-deps
  // The text may have changed since (an edit, a tab): read it again, then step.
  const step = (d) => {
    const h = hitsIn(root(), q.trim().toLowerCase())
    const n = h.length ? (Math.min(now, h.length - 1) + d + h.length) % h.length : 0
    setHits(h)
    setNow(n)
    paint(h, n)
  }
  return (
    <div className="rl-pfind" ref={box}>
      <input type="search" className="rl-find" autoFocus value={q} placeholder={tr("rk_find_in_editor")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }} />
      <span className="rl-n">{q.trim() ? `${hits.length ? now + 1 : 0}/${hits.length}` : ''}</span>
      <button type="button" className="rl-btn" disabled={!hits.length} title="⇧Enter" onClick={() => step(-1)}>↑</button>
      <button type="button" className="rl-btn" disabled={!hits.length} title="Enter" onClick={() => step(1)}>↓</button>
      <button type="button" className="rl-btn" title="Esc" onClick={onClose}>×</button>
    </div>
  )
}
