import { describe, it, expect } from 'vitest'
import { bibAuthors, bibEntry, bibOrder, bibText, jAbbrev } from '../racklist/bib.js'

// reference_manager's document, in miniature.
const doc = {
  authors: [
    { id: 'a1', name: 'W. G. Lynch', fullName: 'William G Lynch' },
    { id: 'a2', name: 'J. W. Lee', bibName: 'Lee, Jung Woo' },
  ],
  journals: [{ id: 'j1', name: 'The Astrophysical Journal', shortName: 'ApJ', abbrev: 'Astrophys. J.' }],
}

describe('a .bib out of reference_manager', () => {
  it("writes BibTeX's name order, and never argues with a bibName", () => {
    expect(bibOrder('W. G. Lynch')).toBe('Lynch, W. G.')
    expect(bibOrder('Lynch, W. G.')).toBe('Lynch, W. G.')
    // The record's own spelling wins — it exists because nobody can derive it.
    expect(bibAuthors(doc, { authors: [{ ref: 'a2' }] })).toBe('Lee, Jung Woo')
    // A registered author is spelled from the record's fullest name, and a
    // one-letter given word is an initial — William G Lynch → Lynch, William G.
    expect(bibAuthors(doc, { authors: [{ ref: 'a1' }] })).toBe('Lynch, William G.')
    // A name typed on the paper, with no record behind it, still turns round.
    expect(bibAuthors(doc, { authors: [{ name: 'M. B. Tsang' }] })).toBe('Tsang, M. B.')
    expect(bibAuthors(doc, { authors: [{ ref: 'a1' }, { name: 'M. B. Tsang' }] }))
      .toBe('Lynch, William G. and Tsang, M. B.')
  })

  it('cites the journal the way a citation does', () => {
    expect(jAbbrev(doc, { journal: 'j1' })).toBe('Astrophys. J.')
    // A journal typed before it had a record is still a journal.
    expect(jAbbrev(doc, { journal: 'Nuclear Physics A' })).toBe('Nuclear Physics A')
  })

  it('leaves an empty field out rather than writing it blank', () => {
    const e = bibEntry(doc, { citeKey: 'Lee2026', type: 'paper', title: 'ELARK', year: '2026',
      journal: 'j1', volume: '', pages: '', doi: '10.1/x', authors: [{ ref: 'a2' }] })
    expect(e).toBe('@article{Lee2026,\n'
      + '  author = {Lee, Jung Woo},\n  title = {ELARK},\n  journal = {Astrophys. J.},\n'
      + '  year = {2026},\n  doi = {10.1/x},\n}')
    expect(e).not.toContain('volume')
  })

  it('is @misc unless it is a paper, and nothing at all without a key', () => {
    expect(bibEntry(doc, { citeKey: 'P1', type: 'proposal', title: 'a' })).toContain('@misc{P1,')
    expect(bibEntry(doc, { citeKey: 'T1', type: 'thesis', title: 'a' })).toContain('@phdthesis{T1,')
    expect(bibEntry(doc, { citeKey: '  ', title: 'no key' })).toBe('')
  })

  it('writes one entry per key — a paper may be cited from the body AND listed', () => {
    const recs = [{ citeKey: 'A', title: 'a' }, { citeKey: 'A', title: 'a' }, { citeKey: 'B', title: 'b' }]
    expect(bibText(doc, recs).match(/@misc\{/g)).toHaveLength(2)
    expect(bibText(doc, []).trim()).toBe('')
  })
})
