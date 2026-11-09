import '../strings.js'
import { useState } from 'react'
import { fileSrc, kb } from '../api.js'
import { press } from './press.js'
import { dropped } from '../liveedit.js'
import { EMBED_RE, embedSpec, figureList, isImage } from '../marks.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** 그림·파일 — what is in the note's folder, and what the note says about it.
 *
 *  A tool both kinds share. A tex note's folder is the manuscript's own tree
 *  (img/, style/, section/) and all of it matters — a `.sty` or a `.bib`
 *  missing is a compile that fails. A markdown note's folder is the one the
 *  whole vault shares, which holds everybody's pictures: there, what matters
 *  is the ones THIS note embeds.
 *
 *  What differs between the two kinds is only the TEXT a file turns into when
 *  it is put in the note, and liveedit already knows that (`dropped`) because
 *  a file dropped on the editor leaves exactly the same thing.
 */
/** `\includegraphics[width=…]{img/fig1}` — what a tex note calls for. */
const TEX_IMG = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g

/** The names a note embeds, in the order it embeds them. */
export const embedded = (body, tex) => {
  const out = []
  const want = tex
    ? [...String(body).matchAll(TEX_IMG)].map((m) => m[1].trim())
    : [...String(body).matchAll(EMBED_RE)].map((m) => embedSpec(m[1])[0])
  for (const name of want) if (name && !out.includes(name)) out.push(name)
  return out
}

/** The files a note NAMES that its folder does not have. A compile fails on
 *  these, and a reader sees a broken picture; both are cheap to say here.
 *
 *  Only when the folder has actually been READ: `null` (not asked) and `false`
 *  (could not be read) both mean we do not know, and saying "these 7 files are
 *  not there" when we never found out is worse than saying nothing. */
export function missingFiles(body, files, tex) {
  if (!Array.isArray(files)) return []
  const have = new Set(files.map((f) => f.name))
  // A tex `\includegraphics` may leave the extension off, as LaTeX allows.
  const stems = new Set(files.map((f) => f.name.replace(/\.[^./]+$/, '')))
  const out = []
  for (const name of embedded(body, tex)) {
    if (have.has(name) || (tex && stems.has(name.replace(/\.[^./]+$/, '')))) continue
    out.push(name)
  }
  return out
}

/** The steps the gathered pictures grow through: how wide a cell is at least,
 *  and how tall the picture in it. `100%` is one to a row — the column cannot
 *  fit two of them, which is the point. */
const GAL = [['96px', '72px'], ['150px', '110px'], ['230px', '170px'], ['360px', '260px'], ['100%', '60vh']]

/** The text for a file, on the clipboard. The portal frames this page, where
 *  the clipboard API is not always granted; the old way still works and costs
 *  three lines, so it is the fallback rather than an apology. */
async function toClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* framed */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:-50px;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  try { return document.execCommand('copy') } catch { return false } finally { ta.remove() }
}

/** `그림 3`, as a button that goes to the picture's line — the same glide the
 *  line numbers make (ctx.go). Nothing for a file that is not a figure. */
const FigNo = ({ fig, go }) => (fig ? (
  <button type="button" className="rl-btn nt-pin-go nt-fig-go" title={tr("nt_fig_go", fig.n)}
    {...press(() => go(fig.line))}>{tr("nt_fig_n", fig.n)}</button>
) : null)

/** One row of the list: its figure number, a thumbnail, the name, the size, `넣기` and `복사`. */
const Row = ({ x, src, put, copy, fig, go }) => (
  <li>
    <FigNo fig={fig} go={go} />
    {/* A picture says what it is better than its name does. */}
    {isImage(x.name)
      ? <img className="nt-thumb" src={src} alt="" loading="lazy" />
      : <span className="nt-thumb nt-thumb-no" aria-hidden="true" />}
    <a className="rl-mono nt-fname" href={src} target="_blank" rel="noreferrer">{x.name}</a>
    <span className="rl-hint">{kb(x.bytes)}</span>
    <button type="button" className="rl-btn" title={tr("nt_file_put")} {...press(put)}>{tr("nt_file_put_do")}</button>
    <button type="button" className="rl-btn" title={tr("nt_file_copy_hint")} {...press(copy)}>{tr("nt_file_copy")}</button>
  </li>
)

function Body({ note, edit, files, seeFiles, say, go, tex }) {
  const gone = missingFiles(note.body, files, note.tex)
  // Gathered or listed, and how big. A folder of figures is looked at, not
  // read — but the list is what tells you a `.sty` is there, so it is a switch
  // rather than a replacement.
  const [gathered, setGathered] = useState(true)
  // How big a gathered picture is drawn. Finding one among twenty wants them
  // small; looking AT one wants it big — so it is a step rather than a switch,
  // and the last step is one picture to a row, as wide as the column gets.
  const [z, setZ] = useState(GAL.length - 1)
  // Read through a clamp, not straight: a press that lands past either end
  // would be `undefined[0]`, and the whole page goes to the error screen for
  // the sake of a button that should simply have done nothing.
  const step = GAL[Math.min(Math.max(z, 0), GAL.length - 1)]
  const src = (x) => fileSrc(x.name, note.tex ? note.id : '')
  const all = Array.isArray(files) ? files : []
  // A markdown note's folder is the vault's: only what this note embeds is
  // its own. A tex note's folder IS its own, all of it.
  const mine = note.tex ? all : (() => {
    const want = embedded(note.body, false)
    return all.filter((x) => want.includes(x.name))
      .sort((a, b) => want.indexOf(a.name) - want.indexOf(b.name))
  })()
  const pics = mine.filter((x) => isImage(x.name))
  // Which figure a file is in THIS note (its first embedding), for the number
  // that goes there. A markdown note's pictures are numbered as the live view
  // numbers them (marks.js figureList); a tex note's are not figures here.
  const figs = new Map()
  if (!note.tex) for (const f of figureList(note.body)) if (!figs.has(f.name)) figs.set(f.name, f)
  const rest = mine.filter((x) => !isImage(x.name))
  // A line of its own, under the one the caret is in (App's `edit.block`):
  // a picture put in the middle of a word is never what was meant, least of
  // all in the middle of another picture's markup.
  const put = (x) => () => edit.block(dropped(x.name, note.tex))
  // What `넣기` would have written, on the clipboard instead: the same line,
  // for another note or another place in this one.
  const copy = (x) => () => {
    const text = dropped(x.name, note.tex).trim()
    toClipboard(text).then((ok) => say(ok ? tr("nt_file_copied", text) : tr("nt_file_copy_no")))
  }
  return (<>
    <div className="nt-mrow">
      {/* Two ways of looking at the same folder, as two buttons: a switch that
          was one button said what it would do next, never which one you were
          in. The list is what tells you a `.sty` is there; the pictures are
          what you look at. */}
      <button type="button" className={`rl-btn${gathered ? '' : ' on'}`} aria-pressed={!gathered}
        title={tr("nt_files_list_hint")} {...press(() => setGathered(false))}>{tr("nt_files_list")}</button>
      <button type="button" className={`rl-btn${gathered ? ' on' : ''}`} aria-pressed={gathered}
        title={tr("nt_files_gather_hint")} {...press(() => setGathered(true))}>{tr("nt_files_gather")}</button>
      {gathered ? (<>
        <button type="button" className="rl-btn" disabled={!z} title={tr("nt_files_smaller")}
          {...press(() => setZ((n) => Math.max(0, n - 1)))}>−</button>
        <button type="button" className="rl-btn" disabled={z >= GAL.length - 1} title={tr("nt_files_bigger")}
          {...press(() => setZ((n) => Math.min(GAL.length - 1, n + 1)))}>+</button>
      </>) : null}
      {/* A file input wearing the bar's button. Only on an empty tex note —
          see `empty` — so it is gone by the time there is a manuscript to
          overwrite. */}
      {tex?.empty ? <label className="rl-btn nt-zipbtn" title={tr("nt_zip_hint")}>{tr("nt_zip")}
        <input type="file" accept=".zip,application/zip" hidden disabled={tex.busy}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) tex.importZip(file) }} />
      </label> : null}
      <span className="rl-hint">{tr("nt_files_drop")}</span>
      <span className="rl-sp" />
      <button type="button" className="rl-btn" {...press(seeFiles)}>{tr("nt_files_again")}</button>
    </div>
    {tex?.imp ? (
      <div className="nt-mnote">
        <span>{tr("nt_zip_in", tex.imp.main, tex.imp.files?.length || 0, tex.imp.bib_keys?.length || 0)}</span>
        {tex.refKey ? null : <span className="rl-hint">{tr("nt_zip_cite")}</span>}
        <button type="button" className="rl-btn" {...press(() => tex.setImp(null))}>×</button>
      </div>
    ) : null}
    {/* What the note points at and the folder does not hold. */}
    {gone.length ? (
      <div className="nt-texerr">{tr("nt_files_gone", gone.length)} <b>{gone.join(', ')}</b></div>
    ) : null}
    {files === false ? <p className="rl-hint nt-empty nt-ref-no">{tr("nt_files_failed")}</p>
      : files === null ? <p className="rl-hint nt-empty">{tr("nt_loading")}</p>
      : !mine.length ? (
        <p className="rl-hint nt-empty">{note.tex ? tr("nt_files_none") : tr("nt_files_nomine", all.length)}</p>
      ) : gathered ? (
        /* The pictures as pictures. Pressing one puts it in the note. */
        !pics.length ? <p className="rl-hint nt-empty">{tr("nt_files_nopic")}</p> : (
          <div className="nt-gal" style={{ '--gal-w': step[0], '--gal-h': step[1] }}>
            {pics.map((x) => (
              <span key={x.name} className="nt-gal-cell">
                <button type="button" title={`${x.name} · ${kb(x.bytes)}`} {...press(put(x))}>
                  <img src={src(x)} alt="" loading="lazy" />
                  <span className="rl-mono">{x.name.split('/').pop()}</span>
                </button>
                <FigNo fig={figs.get(x.name)} go={go} />
              </span>
            ))}
          </div>
        )
      ) : (<>
        {/* Pictures and the rest are different things to a document: one is
            what it shows, the other is what it is made with. */}
        {pics.length ? (<>
          <p className="rl-hint nt-files-head">{tr("nt_files_pics", pics.length)}</p>
          <ul className="nt-files">
            {pics.map((x) => <Row key={x.name} x={x} src={src(x)} put={put(x)} copy={copy(x)} fig={figs.get(x.name)} go={go} />)}
          </ul>
        </>) : null}
        {rest.length ? (<>
          <p className="rl-hint nt-files-head">{tr("nt_files_rest", rest.length)}</p>
          <ul className="nt-files">
            {rest.map((x) => <Row key={x.name} x={x} src={src(x)} put={put(x)} copy={copy(x)} />)}
          </ul>
        </>) : null}
      </>)}
  </>)
}

export default {
  id: 'files',
  label: 'nt_tab_files',
  modes: ['md', 'tex'],
  badge: ({ note, files }) => missingFiles(note.body, files, note.tex).length || null,
  Body,
}
