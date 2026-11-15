/** The place rule, checked. Runs from tests/parts.test.js (needs the kit alias). */
import assert from 'node:assert/strict'
import { place, citeKeyFor, partsOf, parentOf } from './paper.js'

const same = (got, want, why) => assert.equal(got, want, `${why}: ${got} ≠ ${want}`)

// Every spelling of one place becomes the one spelled-out English form.
for (const v of ['Figure 3', 'Fig. 3', 'Fig.3', 'fig 3', 'FIG 3', '그림 3', '그림3', 'figure  3'])
  same(place(v), 'Figure 3', `figure from ${v}`)
for (const v of ['Table 2', 'Tab. 2', 'tbl.2', '표 2']) same(place(v), 'Table 2', `table from ${v}`)
for (const v of ['Equation 7', 'Eq. 7', 'eqn 7', '식 7']) same(place(v), 'Equation 7', `equation from ${v}`)
for (const v of ['Page 1234', 'p. 1234', 'pg.1234', '쪽 1234']) same(place(v), 'Page 1234', `page from ${v}`)
for (const v of ['Section 4.2', 'Sec. 4.2', '절 4.2']) same(place(v), 'Section 4.2', `section from ${v}`)
same(place('Theorem 1'), 'Theorem 1', 'theorem')
same(place('정리 1'), 'Theorem 1', 'theorem in Korean')
same(place('슬라이드 12'), 'Slide 12', 'slide')

// A range points at more than one, however it was written.
same(place('pp. 1234-1236'), 'Pages 1234-1236', 'page range')
same(place('p. 1234-1236'), 'Pages 1234-1236', 'range given as one page')
same(place('pp. 1234'), 'Page 1234', 'one page given as a range word')
same(place('Fig. 3-5'), 'Figures 3-5', 'figure range')
same(place('그림 3~5'), 'Figures 3~5', 'figure range with a wave')

// What the table does not know is left alone: a locator may be prose.
same(place('the abstract'), 'the abstract', 'prose')
same(place('Figure'), 'Figure', 'a word with nothing after it')
same(place(''), '', 'empty')
same(place(null), '', 'nothing')
same(place('  Fig.  3(b) '), 'Figure 3(b)', 'a letter after the number, and loose spaces')
same(place('Table S3'), 'Table S3', 'supplementary')

// Idempotent: normalising twice must not drift.
for (const v of ['Fig.3', 'pp. 1-2', '그림 3', 'the abstract'])
  same(place(place(v)), place(v), `twice over ${v}`)


// ─── A part's key ───────────────────────────────────────────────────────────
const src = { id: 'p1', type: 'paper', citeKey: 'MWang_ChinPC_2021' }
const doc = { references: [src] }
const part = (locator, extra = {}) => ({ id: 'x', type: 'part', parent: { id: 'p1' }, locator, ...extra })

// However the place was typed, the key carries the one spelling.
for (const v of ['Figure 3', 'Fig.3', 'fig 3', '그림 3'])
  same(citeKeyFor(doc, part(v)), 'MWang_ChinPC_2021/Figure_3', `key from ${v}`)
same(citeKeyFor(doc, part('pp. 1234-1236')), 'MWang_ChinPC_2021/Pages_1234-1236', 'key from a page range')
same(citeKeyFor(doc, part('Theorem 1')), 'MWang_ChinPC_2021/Theorem_1', 'key from a theorem')

// A half-typed part leaves no stray token and no dangling slash.
same(citeKeyFor(doc, { id: 'x', type: 'part', locator: 'Fig.3' }), 'Figure_3', 'no source yet')
same(citeKeyFor(doc, part('')), 'MWang_ChinPC_2021', 'no place yet')
same(citeKeyFor(doc, { id: 'x', type: 'part' }), '', 'neither')

// The source and its parts find each other.
const kids = [part('Figure 3'), { ...part('Figure 10'), id: 'y' }, { ...part('Figure 2'), id: 'z' }]
const d2 = { references: [src, ...kids] }
same(parentOf(d2, kids[0])?.citeKey, 'MWang_ChinPC_2021', 'a part finds its source')
same(parentOf(d2, src), null, 'a source has no source')
same(partsOf(d2, 'p1').map((r) => r.locator).join(' '), 'Figure 2 Figure 3 Figure 10', 'parts read in number order')
same(partsOf(d2, 'nobody').length, 0, 'a source with no parts')

console.log('parts.check: ok')
