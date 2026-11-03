import '../strings.js'
import { openInService } from 'racklist'
import { press } from './press.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** `\cite{a,b}`, `\citep[see][]{c}` — the keys a body calls for. */
const CITE_IN_TEXT = /\\[a-zA-Z]*cite[a-zA-Z]*(?:\[[^\]]*\])*\{([^}]*)\}/g

/** Every key the body cites: where it first stands, and how many times it is
 *  called. A `%` line is not in the document, so its `\cite` is not either —
 *  a manuscript is half commented-out paragraphs, and counting those as
 *  citations is how a `.bib` grows entries nothing needs. */
export function citedIn(body) {
  const out = new Map()
  String(body || '').split('\n').forEach((raw, i) => {
    const line = raw.replace(/\\%/g, '\u0000').split('%')[0]
    for (const m of line.matchAll(CITE_IN_TEXT)) {
      for (const k of m[1].split(',').map((x) => x.trim())) {
        if (!k || k === '*') continue
        const had = out.get(k)
        if (had) had.used += 1
        else out.set(k, { key: k, n: i + 1, used: 1 })
      }
    }
  })
  return [...out.values()]
}

/** The `.bib`'s entries against the body's citations:
 *    rows   every entry, with how often it is cited and where first
 *    loose  the citations the `.bib` has no entry for — a `?` in the PDF
 *    cited  how many distinct keys the body calls for
 */
export function citeMap(body, keys) {
  const cited = new Map(citedIn(body).map((c) => [c.key, c]))
  const have = new Set((keys || []).map((e) => e.key))
  return {
    rows: (keys || []).map((e) => ({ ...e, used: cited.get(e.key)?.used || 0, n: cited.get(e.key)?.n || 0 })),
    loose: [...cited.values()].filter((c) => !have.has(c.key)),
    cited: cited.size,
  }
}

/** 참고문헌 — the paper this manuscript IS, and the `.bib` it compiles with.
 *  Both come out of reference_manager: the record collects the reference list,
 *  and the list is written here as BibTeX (racklist/bib.js, the one writer). */
function Body({ note, setNote, go, edit, tex }) {
  const none = !tex.keys.length
  const { rows, loose, cited } = citeMap(note.body, tex.keys)
  return (<>
    <div className="nt-mrow">
      {/* The paper this document IS. Typed rather than picked from a list:
          reference_manager holds hundreds, and the browser's own datalist
          finds one as you type the key. */}
      <label className="rl-hint" title={tr("nt_ref_hint")}>cite
        <input className="rl-in nt-ref" list="nt-refs" value={tex.refKey} placeholder={tr("nt_ref_none")}
          onChange={(e) => setNote((st) => {
            const fields = { ...(st.fields || {}) }
            const v = e.target.value.trim()
            if (v) fields.reference = v
            else delete fields.reference
            return { ...st, fields }
          })} />
      </label>
      <datalist id="nt-refs">
        {tex.references.map((r) => <option key={r.id} value={r.citeKey}>{r.title}</option>)}
      </datalist>
      {tex.ref ? (
        <button type="button" className="rl-btn" title={tex.ref.title}
          {...press(() => openInService(tex.ref.svc, tex.ref.proj, tex.ref.id))}>{tr("nt_ref_open")}</button>
      ) : tex.refKey ? (<>
        <span className="rl-hint nt-ref-no">{tr("nt_ref_unknown")}</span>
        {/* A manuscript IS a paper, and the library should hold it from the
            day it is written rather than the day it is published: the key
            typed here becomes a record, and that record is what collects the
            reference list. */}
        <button type="button" className="rl-btn" disabled={tex.busy} title={tr("nt_ref_make_hint")}
          {...press(tex.makeRef)}>{tr("nt_ref_make")}</button>
      </>) : null}
      <span className="rl-sp" />
      {/* The .bib, out of reference_manager — what the body cites, plus the
          reference list of the paper this note is. */}
      <button type="button" className="rl-btn nt-go" disabled={tex.busy}
        title={tr("nt_bib_hint")} {...press(tex.planBib)}>{tr("nt_bib_do")}</button>
    </div>
    {tex.plan ? (
      /* Shown before it is written, not after: the file it lands on is the
         bibliography the document compiles with, and the keys reference_manager
         does not have are the ones that will come out of the PDF as a `?`
         whatever we write. */
      <div className="nt-mnote">
        <span>{tr("nt_bib_plan", tex.plan.name, tex.plan.have.length, tex.plan.cited)}</span>
        {tex.plan.gone.length ? (
          <span className="nt-ref-no">{tr("nt_bib_gone", tex.plan.gone.length)} <b>{tex.plan.gone.join(', ')}</b></span>
        ) : null}
        <button type="button" className="rl-btn" disabled={tex.busy || !tex.plan.have.length}
          {...press(tex.writeBib)}>{tr("nt_bib_write")}</button>
        <button type="button" className="rl-btn" {...press(() => tex.setPlan(null))}>×</button>
      </div>
    ) : null}
    {/* A `\cite` the .bib has never heard of comes out of the PDF as a `?`.
        With no .bib at all that is every citation in the manuscript, which is
        not news — the line below says the one thing worth saying. */}
    {!none && loose.length ? (
      <div className="nt-texerr">
        {tr("nt_cite_missing", loose.length)}{' '}
        {loose.map((c) => (
          <button key={c.key} type="button" className="rl-btn nt-pin-go" title={tr("nt_pin_go", c.n)}
            {...press(() => go(c.n))}>{c.key}</button>
        ))}
      </div>
    ) : null}
    {/* The bibliography itself: what is in it, what the body actually calls
        for, and — the point of a list — a key written into the text. */}
    {none ? <p className="rl-hint nt-empty">{tr("nt_bib_none_yet")}</p> : (<>
      <ul className="nt-refs nt-bibs">
        {rows.map((e) => (
          <li key={e.key} className={e.used ? '' : 'off'}>
            <button type="button" className="nt-out" disabled={!e.used}
              title={e.used ? tr("nt_bib_where", e.n) : tr("nt_refs_unused")}
              {...press(() => e.used && go(e.n))}>
              <span className="nt-out-text rl-mono">{e.key}</span>
              <span className="rl-hint nt-bib-title">{e.title}</span>
              <span className="rl-hint nt-out-n">{e.used ? tr("nt_refs_used", e.used) : tr("nt_refs_unused")}</span>
            </button>
            <button type="button" className="rl-btn" title={tr("nt_bib_put")}
              {...press(() => edit.put(`\\cite{${e.key}}`))}>{tr("nt_file_put_do")}</button>
          </li>
        ))}
      </ul>
      <p className="rl-hint nt-fmt-hint">{tr("nt_bib_sum", rows.length, cited)}</p>
    </>)}
  </>)
}

export default {
  id: 'bib',
  label: 'nt_tab_bib',
  modes: ['tex'],
  badge: ({ note, tex }) => (tex?.keys?.length ? citeMap(note.body, tex.keys).loose.length || null : null),
  Body,
}
