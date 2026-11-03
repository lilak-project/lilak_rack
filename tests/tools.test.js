import { describe, expect, it } from 'vitest'
import { missingFiles } from '../note/src-lilak/tools/files.jsx'
import { leading, table } from '../note/src-lilak/tools/format.jsx'
import { headings, refMap } from '../note/src-lilak/tools/outline.jsx'
import { citeMap, citedIn } from '../note/src-lilak/tools/bib.jsx'
import { comments } from '../note/src-lilak/comments.js'
import { wonPair } from '../note/src-lilak/liveedit.js'

// 목차 — `#` and `\section` are one tool's two spellings.
describe('headings', () => {
  it('reads markdown, with its level and its line', () => {
    expect(headings('# One\n\ntext\n## Two\n', false))
      .toEqual([{ n: 1, depth: 1, text: 'One' }, { n: 4, depth: 2, text: 'Two' }])
  })
  it('is not fooled by a `#` inside a code fence', () => {
    expect(headings('# Real\n\n```c\n#include <v>\n```\n', false).map((h) => h.text)).toEqual(['Real'])
  })
  it('wants the space markdown wants (`#tag` is not a heading)', () => {
    expect(headings('#tag only\n', false)).toEqual([])
  })
  it('reads LaTeX, starred and short-titled, and plains the macros', () => {
    expect(headings('\\section{A}\n\\subsection*[short]{\\textit{B} rays}\n', true))
      .toEqual([{ n: 1, depth: 2, text: 'A' }, { n: 2, depth: 3, text: 'B rays' }])
  })
  it('stops at the brace that closes the title, not the last one on the line', () => {
    expect(headings('\\section{Introduction}\\label{sec:intro}\n', true))
      .toEqual([{ n: 1, depth: 2, text: 'Introduction' }])
  })
  it('counts a commented-out section as what it is: text, not a heading', () => {
    // `%\section{x}` compiles to nothing, so it is not in the document.
    expect(headings('%\\section{Gone}\n\\section{Here}\n', true).map((h) => h.text)).toEqual(['Here'])
  })
})

// 그림·파일 — what the note points at and the folder does not hold.
describe('missingFiles', () => {
  const files = [{ name: 'img/fig1.png' }, { name: 'a.png' }]
  it('says nothing before the folder has been read', () => {
    expect(missingFiles('![[nope.png]]', null, false)).toEqual([])
  })
  it('finds a markdown embed with no file', () => {
    expect(missingFiles('![[a.png]] and ![[nope.png|300]]', files, false)).toEqual(['nope.png'])
  })
  it('finds a figure with no file, and allows LaTeX its missing extension', () => {
    expect(missingFiles('\\includegraphics[width=2cm]{img/fig1}\\includegraphics{img/gone}', files, true))
      .toEqual(['img/gone'])
  })
})

// 서식 — a mark goes on the line, and comes off it.
describe('leading', () => {
  it('puts the mark after the indentation, not before it', () => {
    expect(leading('  deep', '- ')).toBe('  - deep')
  })
  it('takes the SAME mark off — pressed twice, it is undone', () => {
    expect(leading('- item', '- ')).toBe('item')
    expect(leading('  1. item', '1. ')).toBe('  item')
    expect(leading('- [ ] do', '- [ ] ')).toBe('do')
    expect(leading('> said', '> ')).toBe('said')
    expect(leading('## head', '## ')).toBe('head')
  })
  it('puts a DIFFERENT mark in its place', () => {
    // `#` then `##` is a level-2 heading, not a `#` line with nothing on it.
    expect(leading('# head', '## ')).toBe('## head')
    expect(leading('### head', '# ')).toBe('# head')
    expect(leading('- item', '1. ')).toBe('1. item')
    expect(leading('- item', '- [ ] ')).toBe('- [ ] item')
    expect(leading('- [ ] do', '- ')).toBe('- do')
    expect(leading('  - deep', '> ')).toBe('  > deep')
  })
  it('counts a heading as a lead, so `##` twice is not `## ## `', () => {
    expect(leading('hi', '## ')).toBe('## hi')
    expect(leading('## hi', '## ')).toBe('hi')
    expect(leading('# hi', '## ')).toBe('## hi')   // the level changes in one press
  })
  it('leaves a blank line alone — it is not a list item', () => {
    expect(leading('', '- ')).toBe('')
    expect(leading('   ', '- ')).toBe('   ')
  })
})

describe('table', () => {
  it('is x cells across, with the ruling and y rows under the heading', () => {
    expect(table(2, 1).split('\n')).toEqual(['| | |', '| --- | --- |', '| | |', ''])
  })
  it('counts the rows under the heading, and never fewer than one', () => {
    expect(table(3, 3).split('\n').length).toBe(6)     // head + rule + 3 + ''
    expect(table(2, 0).split('\n').length).toBe(4)
  })
})

// 참조 — \\label and what points at it.
describe('refMap', () => {
  it('counts the calls on each label', () => {
    const { labels, loose } = refMap('\\section{A}\\label{sec:a}\nSee \\ref{sec:a} and \\autoref{sec:a}.\n')
    expect(labels).toEqual([{ name: 'sec:a', n: 1, used: 2, dup: false }])
    expect(loose).toEqual([])
  })
  it('names a \\ref that points nowhere, once, with its line', () => {
    const { loose } = refMap('\\ref{gone}\n\\ref{gone}\n')
    expect(loose).toEqual([{ name: 'gone', n: 1 }])
  })
  it('reads \\cref{a,b} as two calls', () => {
    const { labels } = refMap('\\label{a}\\label{b}\n\\cref{a,b}\n')
    expect(labels.map((l) => l.used)).toEqual([1, 1])
  })
  it('does not count a commented-out line — it is not in the document', () => {
    const { labels, loose } = refMap('% \\label{old} and \\ref{old}\n\\label{new}\n')
    expect(labels.map((l) => l.name)).toEqual(['new'])
    expect(loose).toEqual([])
  })
  it('names a label defined twice, and says the later one wins', () => {
    const { labels, dups } = refMap('\\label{fig}\nmid\n\\label{fig}\n\\ref{fig}\n')
    expect(dups).toEqual(['fig'])
    expect(labels.map((l) => [l.n, l.used, l.dup])).toEqual([[1, 0, true], [3, 1, true]])
  })
  it('knows `\\%` is a percent, not a comment', () => {
    expect(refMap('50\\% \\label{half}\n').labels.map((l) => l.name)).toEqual(['half'])
  })
})

// 참고문헌 — the .bib against what the body cites.
describe('citedIn', () => {
  it('counts every spelling of a citation, once per key', () => {
    expect(citedIn('\\cite{a} \\citep[see][]{b,a} \\textcite{c}').map((c) => [c.key, c.used]))
      .toEqual([['a', 2], ['b', 1], ['c', 1]])
  })
  it('keeps the line a key is first cited on', () => {
    expect(citedIn('x\n\\cite{a}\n\\cite{a}\n')[0]).toEqual({ key: 'a', n: 2, used: 2 })
  })
  it('does not count a commented-out citation — it is not in the document', () => {
    expect(citedIn('% \\cite{old}\n\\cite{new}\n').map((c) => c.key)).toEqual(['new'])
    expect(citedIn('50\\% \\cite{half}').map((c) => c.key)).toEqual(['half'])
  })
  it('ignores `\\nocite{*}`', () => {
    expect(citedIn('\\nocite{*}')).toEqual([])
  })
})

describe('citeMap', () => {
  const keys = [{ key: 'a', title: 'A paper' }, { key: 'b', title: 'B paper' }]
  it('says how often each entry is cited, and which are not', () => {
    const { rows, cited } = citeMap('\\cite{a} and \\cite{a}', keys)
    expect(rows.map((r) => [r.key, r.used])).toEqual([['a', 2], ['b', 0]])
    expect(cited).toBe(1)
  })
  it('names a citation the .bib has no entry for', () => {
    expect(citeMap('\\cite{a,ghost}', keys).loose.map((c) => c.key)).toEqual(['ghost'])
  })
})

// 주석 — the `%` lines, with their own `%` taken off.
describe('comments', () => {
  it('finds the lines that are ALL comment, with their line number', () => {
    expect(comments('text\n% a note\n  %% deeper\n'))
      .toEqual([{ n: 2, text: 'a note' }, { n: 3, text: 'deeper' }])
  })
  it('leaves a trailing comment alone — half a line folded is unreadable', () => {
    expect(comments('x = 1 % why')).toEqual([])
  })
  it('keeps an empty comment as an empty line, not as nothing', () => {
    expect(comments('%\n%  \n')).toEqual([{ n: 1, text: '' }, { n: 2, text: '' }])
  })
})

// ₩코드₩ — the easy key on a Korean keyboard, written to the file as `code`.
describe('wonPair', () => {
  it('finds the ₩ that opens the chip', () => {
    expect(wonPair('짜 ₩npm run build')).toBe(2)
  })
  it('leaves a price alone', () => {
    expect(wonPair('값은 ₩5,000 이고 ')).toBe(-1)
  })
  it('wants something between the two', () => {
    expect(wonPair('아 ₩')).toBe(-1)
    expect(wonPair('아 ₩  ')).toBe(-1)
  })
  it('takes the nearest one, so the first pair closes first', () => {
    expect(wonPair('₩a` 그리고 ₩b')).toBe(8)
  })
  it('says no when there is none', () => {
    expect(wonPair('그냥 글')).toBe(-1)
  })
})
