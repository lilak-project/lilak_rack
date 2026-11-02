/**
 * A .bib, out of reference_manager's records.
 *
 * BibTeX is the format these services speak to each other in: reference_manager
 * keeps the papers, a note writes a manuscript that `\cite{}`s them, and the
 * compile wants a file. So the writer lives here, in the shared kit, rather
 * than in either of them — a .bib a note generates and a .bib the reference
 * list prints would otherwise be two spellings of one format, and two
 * spellings drift.
 *
 * It reads reference_manager's document and nothing else: `{ references,
 * authors, journals }`, the same shape `loadReferences` fetches (tags.js).
 */

// An author carries three spellings (see reference_manager's paper.js); the
// one a .bib wants is BibTeX's own order, `Lynch, W. G.`.
/** given words and the family word, reading BibTeX's comma the right way. */
export const nameParts = (name) => {
  const t = String(name || '').trim()
  if (t.includes(',')) {
    const [family, given] = [t.slice(0, t.indexOf(',')).trim(), t.slice(t.indexOf(',') + 1).trim()]
    return [given.replace(/[.]/g, ' ').split(/\s+/).filter(Boolean), family]
  }
  const w = t.replace(/[.]/g, ' ').split(/\s+/).filter(Boolean)
  return [w.slice(0, -1), w[w.length - 1] || '']
}

/** BibTeX's order, out of a name written the usual way. */
export const bibOrder = (name) => {
  const [given, family] = nameParts(name)
  if (!family) return String(name || '')
  return given.length ? `${family}, ${given.map((w) => (w.length <= 2 ? `${w}.` : w)).join(' ')}` : family
}

/** A journal is referenced by its record's id (a name typed before it had a
 *  record stays text). */
export const journalRec = (doc, r) => (r.journal
  && (doc?.journals || []).find((j) => j.id === r.journal || j.name === r.journal)) || null
/** The name a citation uses — Astrophys. J. */
export const jAbbrev = (doc, r) => journalRec(doc, r)?.abbrev || journalRec(doc, r)?.name || r.journal || ''

/** `Lynch, W. G. and Tsang, M. B.` — a .bib's author field is ONE string, and
 *  this is it. A registered author's own `bibName` wins, because a name nobody
 *  can derive (van der Waals, 李) is why that field exists. */
export const bibAuthors = (doc, r) => (r.authors || [])
  .filter((a) => a && (a.name || a.ref))
  .map((a) => {
    const rec = a.ref ? (doc?.authors || []).find((x) => x.id === a.ref) : null
    return rec?.bibName || bibOrder((rec && (rec.fullName || rec.name)) || a.name || '')
  })
  .filter(Boolean).join(' and ')

// What a record's kind is called in a .bib. Only a paper is an @article; the
// rest are @misc, which BibTeX will print rather than refuse.
const ENTRY = { paper: 'article', thesis: 'phdthesis', report: 'techreport' }

/** One entry. Empty fields are left out — `volume = {}` is noise a reader has
 *  to step over, and bibtex treats it as a volume that is blank rather than
 *  one that is unknown. */
export function bibEntry(doc, r) {
  const key = String(r?.citeKey || '').trim()
  if (!key) return ''
  const fields = [
    ['author', bibAuthors(doc, r)], ['title', r.title], ['journal', jAbbrev(doc, r)],
    ['year', r.year], ['volume', r.volume], ['pages', r.pages],
    ['doi', r.doi], ['url', r.url], ['note', r.inst],
  ].filter(([, v]) => String(v || '').trim())
  return `@${ENTRY[r.type] || 'misc'}{${key},\n`
    + fields.map(([k, v]) => `  ${k} = {${String(v).trim()}},`).join('\n')
    + '\n}'
}

/** The file. A key that appears twice is written once — a manuscript may cite
 *  the same paper from the body and from its reference list. */
export function bibText(doc, records) {
  const seen = new Set()
  return records
    .filter((r) => {
      const k = String(r?.citeKey || '').trim()
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((r) => bibEntry(doc, r)).filter(Boolean).join('\n\n') + '\n'
}
