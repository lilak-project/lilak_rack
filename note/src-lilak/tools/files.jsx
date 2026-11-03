import '../strings.js'
import { useState } from 'react'
import { fileSrc, kb } from '../api.js'
import { press } from './press.js'
import { dropped } from '../liveedit.js'
import { EMBED_RE, embedSpec, isImage } from '../marks.js'
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

/** One row of the list: a thumbnail, the name, the size, and `넣기`. */
const Row = ({ x, src, put }) => (
  <li>
    {/* A picture says what it is better than its name does. */}
    {isImage(x.name)
      ? <img className="nt-thumb" src={src} alt="" loading="lazy" />
      : <span className="nt-thumb nt-thumb-no" aria-hidden="true" />}
    <a className="rl-mono nt-fname" href={src} target="_blank" rel="noreferrer">{x.name}</a>
    <span className="rl-hint">{kb(x.bytes)}</span>
    <button type="button" className="rl-btn" title={tr("nt_file_put")} {...press(put)}>{tr("nt_file_put_do")}</button>
  </li>
)

function Body({ note, edit, files, seeFiles, tex }) {
  const gone = missingFiles(note.body, files, note.tex)
  // Gathered or listed, and how big. A folder of figures is looked at, not
  // read — but the list is what tells you a `.sty` is there, so it is a switch
  // rather than a replacement.
  const [gathered, setGathered] = useState(false)
  const [big, setBig] = useState(false)
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
  const rest = mine.filter((x) => !isImage(x.name))
  const put = (x) => () => edit.put(dropped(x.name, note.tex))
  return (<>
    <div className="nt-mrow">
      <button type="button" className={`rl-btn${gathered ? ' on' : ''}`} aria-pressed={gathered}
        title={tr("nt_files_gather_hint")} {...press(() => setGathered(!gathered))}>{tr("nt_files_gather")}</button>
      {gathered ? (
        <button type="button" className={`rl-btn${big ? ' on' : ''}`} aria-pressed={big}
          title={tr("nt_files_big_hint")} {...press(() => setBig(!big))}>{tr("nt_files_big")}</button>
      ) : null}
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
          <div className={`nt-gal${big ? ' big' : ''}`}>
            {pics.map((x) => (
              <button key={x.name} type="button" title={`${x.name} · ${kb(x.bytes)}`} {...press(put(x))}>
                <img src={src(x)} alt="" loading="lazy" />
                <span className="rl-mono">{x.name.split('/').pop()}</span>
              </button>
            ))}
          </div>
        )
      ) : (<>
        {/* Pictures and the rest are different things to a document: one is
            what it shows, the other is what it is made with. */}
        {pics.length ? (<>
          <p className="rl-hint nt-files-head">{tr("nt_files_pics", pics.length)}</p>
          <ul className="nt-files">
            {pics.map((x) => <Row key={x.name} x={x} src={src(x)} put={put(x)} />)}
          </ul>
        </>) : null}
        {rest.length ? (<>
          <p className="rl-hint nt-files-head">{tr("nt_files_rest", rest.length)}</p>
          <ul className="nt-files">
            {rest.map((x) => <Row key={x.name} x={x} src={src(x)} put={put(x)} />)}
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
