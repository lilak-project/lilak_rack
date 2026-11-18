import { describe, expect, it } from 'vitest'
import { commented, heading, inEnv, listOf, tabular } from '../note/src-lilak/tools/latex.jsx'
import { citeRows, findCites } from '../note/src-lilak/tools/bib.jsx'

/** The LaTeX tab's commands, and the references tab's one list. */
describe('LaTeX tab', () => {
  it('puts a heading round a line, changes its level, and takes it off', () => {
    expect(heading('  서론', 'section')).toBe('  \\section{서론}')
    expect(heading('\\section{서론}', 'subsection')).toBe('\\subsection{서론}')
    expect(heading('\\subsection{서론}', 'subsection')).toBe('서론')
    expect(heading('', 'section')).toBe('')
  })
  it('comments a line and uncomments it', () => {
    expect(commented('  문장')).toBe('  % 문장')
    expect(commented('  % 문장')).toBe('  문장')
  })
  it('makes the selected lines the items of a list', () => {
    expect(listOf('itemize', '하나\n\n  둘')).toBe('\\begin{itemize}\n  \\item 하나\n  \\item 둘\n\\end{itemize}\n')
    expect(listOf('enumerate', '')).toBe('\\begin{enumerate}\n  \\item \n\\end{enumerate}\n')
    expect(inEnv('quote', '말\n')).toBe('\\begin{quote}\n말\n\\end{quote}\n')
  })
  it('rules a table of x by y', () => {
    const t = tabular(3, 2)
    expect(t).toContain('\\begin{tabular}{lll}')
    expect(t.split('\n').filter((l) => l.includes('&')).length).toBe(3)       // the heading row and two more
  })
})

describe('references tab', () => {
  const LIB = {
    authors: [{ id: 'a1', fullName: 'William G. Lynch' }],
    references: [
      { id: 'r1', citeKey: 'Lynch2009', title: 'Probing the symmetry energy', year: '2009', authors: [{ ref: 'a1' }, { name: 'M. B. Tsang' }], journal: 'PPNP' },
      { id: 'r2', citeKey: 'Pain2007', title: 'ORRUBA', year: '2007', authors: [{ name: 'S. D. Pain' }] },
    ],
  }
  const BODY = 'a \\cite{Lynch2009} b \\cite{Lynch2009,orruba}\n% \\cite{Pain2007}\n'
  const rows = citeRows(BODY, [{ key: 'Lynch2009', title: '' }], LIB)
  const by = (k) => rows.find((r) => r.key === k)
  it('says of each key whether the bib, the library and the text have it', () => {
    expect(by('Lynch2009')).toMatchObject({ inBib: true, inLib: true, used: 2, n: 1, year: '2009' })
    expect(by('Lynch2009').by).toBe('William G. Lynch, M. B. Tsang')
    expect(by('Pain2007')).toMatchObject({ inBib: false, inLib: true, used: 0 })      // a commented cite is not one
    expect(by('orruba')).toMatchObject({ inBib: false, inLib: false, used: 1 })
  })
  it('finds by any word of key, title, author or year', () => {
    expect(findCites(rows, 'tsang 2009').map((r) => r.key)).toEqual(['Lynch2009'])
    expect(findCites(rows, 'orruba').map((r) => r.key).sort()).toEqual(['Pain2007', 'orruba'])
    expect(findCites(rows, '').length).toBe(3)
  })
})
