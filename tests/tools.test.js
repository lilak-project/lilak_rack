import { describe, expect, it } from 'vitest'
import { missingFiles } from '../note/src-lilak/tools/files.jsx'
import { leading, table } from '../note/src-lilak/tools/format.jsx'
import { headings, refMap } from '../note/src-lilak/tools/outline.jsx'
import { unindent } from '../note/src-lilak/tools/format.jsx'
import { citeMap, citedIn } from '../note/src-lilak/tools/bib.jsx'
import { comments } from '../note/src-lilak/comments.js'
import { backJamo, dueAt, isText, leadIn, moveDay, wonPair } from '../note/src-lilak/liveedit.js'
import { item, MATH } from '../note/src-lilak/livemd.js'

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

// A wrapped list item hangs by its marker, so the second line starts under the
// words of the first.
describe('item', () => {
  it('measures the marker, not the line', () => {
    expect(item('- 할 일')).toEqual({ depth: 0, pad: 0, at: 0, wide: 2 })
    expect(item('12. 할 일')).toEqual({ depth: 0, pad: 0, at: 0, wide: 4 })
  })
  it('steps in under another item, and still hangs', () => {
    expect(item('  - 할 일')).toEqual({ depth: 1, pad: 26, at: 2, wide: 2 })
    expect(item('\t- 할 일')).toEqual({ depth: 1, pad: 26, at: 1, wide: 2 })
  })
  it('is not a list', () => {
    expect(item('그냥 글')).toBe(null)
    expect(item('-빈칸없음')).toBe(null)
  })
})

// `$…$` in a markdown note is set as a formula — but a price is a price.
describe('MATH', () => {
  const found = (t) => [...t.matchAll(MATH)].map((m) => m[2])
  it('finds a formula', () => {
    expect(found('보자 $x^2 + y^2$ 이것')).toEqual(['x^2 + y^2'])
    expect(found('$$\\frac{1}{2}$$ 블록')).toEqual(['\\frac{1}{2}'])
  })
  it('leaves money alone', () => {
    expect(found('$5 랑 $10 은 돈')).toEqual([])
    expect(found('A4 용지 $3 하고 커피 $4 샀다')).toEqual([])
  })
})

// Pressing a due date opens the little calendar on the day already written.
describe('dueAt', () => {
  const line = '- [ ] 한번 해보기 » 2026-11-5 끝'
  it('finds the date under the press, padded for the input', () => {
    expect(dueAt(line, line.indexOf('2026') + 2)).toEqual({
      at: line.indexOf('»'), to: line.indexOf('»') + '» 2026-11-5'.length, was: '2026-11-05',
    })
  })
  it('is nothing when the press is elsewhere on the line', () => {
    expect(dueAt(line, 3)).toBe(null)
    expect(dueAt('아무 날짜 없는 줄', 4)).toBe(null)
  })
})

// 미니 달력 — the keys and the arrows walk the month without it walking off.
describe('moveDay', () => {
  it('steps a day and a week, across the end of a month', () => {
    expect(moveDay('2026-11-04', 1)).toBe('2026-11-05')
    expect(moveDay('2026-11-04', -7)).toBe('2026-10-28')
    expect(moveDay('2026-11-30', 7)).toBe('2026-12-07')
  })
  it('keeps a month step inside the month it lands in', () => {
    expect(moveDay('2026-01-31', 0, 1)).toBe('2026-02-28')
    expect(moveDay('2026-03-15', 0, -1)).toBe('2026-02-15')
    expect(moveDay('2026-12-10', 0, 1)).toBe('2027-01-10')
  })
})

// 원문으로 끌어온 텍스트 파일은 내용이 들어간다 — 그 판단.
describe('isText', () => {
  const f = (name, size = 100, type = '') => ({ name, size, type })
  it('takes a text file the system gave no type to', () => {
    expect(isText(f('main.tex'))).toBe(true)
    expect(isText(f('refs.bib'))).toBe(true)
    expect(isText(f('run.py'))).toBe(true)
    expect(isText(f('notes.txt', 100, 'text/plain'))).toBe(true)
  })
  it('leaves a picture, an archive and a huge log to be stored', () => {
    expect(isText(f('fig1.png', 100, 'image/png'))).toBe(false)
    expect(isText(f('paper.zip'))).toBe(false)
    expect(isText(f('run.log', 50 << 20))).toBe(false)
  })
})

// 쓰고 있던 글자는 자음·모음 하나씩 — 그 한 글자의 계산.
describe('backJamo', () => {
  it('takes the final consonant off, then the vowel, then gives up', () => {
    expect(backJamo('한')).toBe('하')
    expect(backJamo('하')).toBe('ㅎ')
    expect(backJamo('ㅎ')).toBe(null)
  })
  it('undoes one key at a time, not one jamo', () => {
    expect(backJamo('값')).toBe('갑')   // ㅄ was two presses
    expect(backJamo('갑')).toBe('가')
    expect(backJamo('과')).toBe('고')   // ㅘ was ㅗ then ㅏ
    expect(backJamo('뭐')).toBe('무')
    expect(backJamo('읽')).toBe('일')
  })
  it('comes apart for a jamo standing on its own, where there is a part to keep', () => {
    expect(backJamo('ㅘ')).toBe('ㅗ')
    expect(backJamo('ㄱ')).toBe(null)
  })
  it('leaves everything else to the ordinary backspace', () => {
    expect(backJamo('a')).toBe(null)
    expect(backJamo('漢')).toBe(null)
    expect(backJamo(' ')).toBe(null)
  })
})

// 목록 표시는 한 글자처럼 한 번에 지워진다 — 어디까지가 그 표시인가.
describe('leadIn', () => {
  it('takes the bullet, the number and the task box with the indent', () => {
    expect(leadIn('- hello')).toBe('- ')
    expect(leadIn('    * hello')).toBe('    * ')
    expect(leadIn('12. hello')).toBe('12. ')
    expect(leadIn('- [ ] hello')).toBe('- [ ] ')
    expect(leadIn('  - [x] hello')).toBe('  - [x] ')
  })
  it('is nothing on a line that is not a list', () => {
    expect(leadIn('hello')).toBe('')
    expect(leadIn('# heading')).toBe('')
    expect(leadIn('-no space')).toBe('')
    expect(leadIn('> quoted')).toBe('')
  })
})

// 앞 공백 지우기 — 고른 줄 앞의 자리만, 줄 안쪽은 그대로.
describe('unindent', () => {
  it('takes spaces and tabs off the front', () => {
    expect(unindent('    hello')).toBe('hello')
    expect(unindent('\t\thello')).toBe('hello')
    expect(unindent('  \t - [ ] 할 일')).toBe('- [ ] 할 일')
  })
  it('leaves the rest of the line, and a line with no room in front', () => {
    expect(unindent('hello  world')).toBe('hello  world')
    expect(unindent('hello')).toBe('hello')
    expect(unindent('')).toBe('')
  })
  it('empties a line that was nothing but space', () => {
    expect(unindent('     ')).toBe('')
  })
})
