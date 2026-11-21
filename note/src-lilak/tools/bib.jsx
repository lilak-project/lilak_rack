import '../strings.js'
import { useEffect, useMemo, useState } from 'react'
import { openInService } from 'racklist'
import { press } from 'racklist'
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

/** Everything that could be cited, as one list: the `.bib`'s entries and the
 *  library's papers, by cite key. Each says where it stands —
 *    inBib   the `.bib` this note compiles with has it
 *    inLib   reference_manager has it (so it can be opened, and written out)
 *    used/n  how often the body cites it, and the line it first does
 *  `by` and `year` are the library's, for the search. */
export function citeRows(body, keys, lib) {
  const cited = new Map(citedIn(body).map((c) => [c.key, c]))
  const authors = new Map((lib?.authors || []).map((a) => [a.id, a.fullName || a.name || '']))
  const rows = new Map()
  for (const e of keys || []) rows.set(e.key, { key: e.key, title: e.title || '', inBib: true, inLib: false, by: '', year: '' })
  for (const r of lib?.references || []) {
    const key = String(r.citeKey || '').trim()
    if (!key) continue
    const names = (r.authors || []).map((x) => (x?.ref ? authors.get(x.ref) : '') || x?.name || '').filter(Boolean)
    const row = rows.get(key) || { key, title: '', inBib: false }
    rows.set(key, { ...row, id: r.id, inLib: true, title: r.title || row.title, year: String(r.year || ''),
      by: names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : ''), journal: r.journal || '' })
  }
  for (const c of cited.values()) if (!rows.has(c.key)) rows.set(c.key, { key: c.key, title: '', inBib: false, inLib: false, by: '', year: '' })
  return [...rows.values()].map((r) => ({ ...r, used: cited.get(r.key)?.used || 0, n: cited.get(r.key)?.n || 0 }))
}

/** The rows a search keeps: every word of it somewhere in the key, the title,
 *  the authors, the year or the journal. */
export function findCites(rows, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return rows
  return rows.filter((r) => {
    const hay = `${r.key} ${r.title} ${r.by} ${r.year} ${r.journal || ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

const SHOWN = 60          // a list to pick from, not the library: the search narrows it

/** 참고문헌 — the paper this manuscript IS, the `.bib` it compiles with, and
 *  the library to cite from. All of it is reference_manager's: the record
 *  collects the reference list, the list is written here as BibTeX
 *  (racklist/bib.js, the one writer), and the search below is over its papers. */
function Body({ note, setNote, go, edit, tex }) {
  const [q, setQ] = useState('')
  const [which, setWhich] = useState('all')        // all | in | out — of the body
  // The library is asked for when this tab is first looked at.
  useEffect(() => { if (tex.lib === null) tex.seeLib() }, [tex.lib])   // eslint-disable-line react-hooks/exhaustive-deps
  const none = !tex.keys.length
  const { loose, cited } = citeMap(note.body, tex.keys)
  const all = useMemo(() => citeRows(note.body, tex.keys, tex.lib || null), [note.body, tex.keys, tex.lib])
  // Nothing asked for: what this paper already has to do with — its .bib and
  // what it cites. A search is over everything.
  const base = q.trim() ? findCites(all, q) : all.filter((r) => r.inBib || r.used)
  const rows = base.filter((r) => (which === 'in' ? r.used : which === 'out' ? !r.used : true))
    .sort((x, y) => (y.used > 0) - (x.used > 0) || x.key.localeCompare(y.key))
  /** `\cite{key}` at the caret — and into the .bib, when it is the library's
   *  and the .bib has not got it: cited and not defined is a `?` in the PDF. */
  const put = (r) => {
    edit.put(`\\cite{${r.key}}`)
    if (!r.inBib && r.inLib) tex.addToBib(r.key)
  }
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
    {/* Finding one to cite: over the .bib AND the library, by any word of its
        key, title, authors or year — and whether the body has it already. */}
    <div className="nt-mrow nt-cite-find">
      <input className="rl-in nt-cite-q" value={q} placeholder={tr("nt_cite_find")}
        onChange={(e) => setQ(e.target.value)} />
      <span className="rl-seg">
        {[['all', "nt_all"], ['in', "nt_cite_in"], ['out', "nt_cite_out"]].map(([k, label]) => (
          <button key={k} type="button" className={`rl-btn${which === k ? ' on' : ''}`} aria-pressed={which === k}
            {...press(() => setWhich(k))}>{tr(label)}</button>
        ))}
      </span>
    </div>
    {tex.lib === false ? <p className="rl-hint nt-empty nt-ref-no">{tr("nt_ref_no_svc")}</p> : null}
    {!rows.length ? (
      <p className="rl-hint nt-empty">{q.trim() ? tr("nt_cite_nothing") : none ? tr("nt_bib_none_yet") : tr("nt_cite_nothing")}</p>
    ) : (
      <ul className="nt-refs nt-bibs">
        {rows.slice(0, SHOWN).map((e) => (
          <li key={e.key} className={e.used ? '' : 'off'}>
            {/* Two lines: the key with where it stands, then what it is with
                what can be done — a toolbox is 320px wide, and a cite key alone
                is half of that. */}
            <div className="nt-cite-row">
              <button type="button" className="nt-out nt-cite-key" disabled={!e.used}
                title={e.used ? tr("nt_bib_where", e.n) : tr("nt_cite_out")}
                {...press(() => e.used && go(e.n))}>
                <span className="nt-out-text rl-mono">{e.key}</span>
              </button>
              {/* In the text or not — the thing to know before citing it again. */}
              <span className={`nt-cite-n${e.used ? ' on' : ''}`} title={e.used ? tr("nt_cite_in") : tr("nt_cite_out")}>
                {e.used ? tr("nt_refs_used", e.used) : tr("nt_cite_no")}</span>
              {/* Where it is kept: in the .bib (it will print), only in the
                  library (the insert button writes it into the .bib too), or in
                  neither — cited by the body and known to nobody. */}
              {e.inBib ? <span className="nt-cite-at" title={tr("nt_cite_bib_hint")}>bib</span>
                : e.inLib ? <span className="nt-cite-at off" title={tr("nt_cite_lib_hint")}>refs</span>
                : <span className="nt-dupmark" title={tr("nt_cite_none_hint")}>?</span>}
            </div>
            <div className="nt-cite-row">
              <span className="rl-hint nt-cite-what" title={[e.title, e.by, e.year].filter(Boolean).join(' · ')}>
                {[e.title, e.by, e.year].filter(Boolean).join(' · ')}</span>
              {e.inLib ? (
                <button type="button" className="rl-btn" title={tr("nt_ref_open")}
                  {...press(() => openInService('reference_manager', tex.references[0]?.proj, e.id))}>↗</button>
              ) : null}
              <button type="button" className="rl-btn" disabled={tex.busy} title={e.inBib || !e.inLib ? tr("nt_bib_put") : tr("nt_bib_put_add")}
                {...press(() => put(e))}>{tr("nt_file_put_do")}</button>
            </div>
          </li>
        ))}
      </ul>
    )}
    <p className="rl-hint nt-fmt-hint">
      {rows.length > SHOWN ? `${tr("nt_cite_more", rows.length - SHOWN)} · ` : ''}
      {tr("nt_bib_sum", tex.keys.length, cited)}
      {tex.lib ? ` · ${tr("nt_cite_lib_n", (tex.lib.references || []).length)}` : ''}
    </p>
  </>)
}

export default {
  id: 'bib',
  label: 'nt_tab_bib',
  modes: ['tex'],
  badge: ({ note, tex }) => (tex?.keys?.length ? citeMap(note.body, tex.keys).loose.length || null : null),
  Body,
}
