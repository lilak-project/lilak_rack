import { describe, it, expect } from 'vitest'
import { cutPages as cut, plainRules, headingNumbers, numberHeadings, pageTexts, ruleLines } from '../note/src-lilak/marks.js'

const b = (line, top, bottom, extra = {}) => ({ line, top, bottom, ...extra })
const INF = Infinity
const cutPages = (blocks, room) => cut(blocks, room).map(({ from, to }) => ({ from, to }))

describe('cutting a note into slides', () => {
  it('the first line is the title slide, alone', () => {
    expect(cutPages([b(1, 0, 40), b(3, 50, 90)], 1000)).toEqual([{ from: 1, to: 2 }, { from: 3, to: INF }])
  })
  it('a block that would run past the page starts the next one', () => {
    expect(cutPages([b(1, 0, 10), b(2, 20, 60), b(4, 70, 110), b(6, 120, 160)], 100))
      .toEqual([{ from: 1, to: 1 }, { from: 2, to: 5 }, { from: 6, to: INF }])
  })
  it('`---` ends a slide and is on neither side', () => {
    expect(cutPages([b(1, 0, 10), b(2, 20, 40), b(3, 50, 52, { rule: true }), b(4, 60, 90)], 1000))
      .toEqual([{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 4, to: INF }])
  })
  it('a `---` before anything leaves the title slide on its own', () => {
    expect(cutPages([b(1, 0, 2, { rule: true }), b(2, 10, 30)], 1000))
      .toEqual([{ from: 0, to: -1 }, { from: 2, to: INF }])
  })
  it('a # heading starts a slide', () => {
    expect(cutPages([b(1, 0, 10), b(2, 20, 30), b(3, 40, 50, { h1: true }), b(4, 60, 70)], 1000))
      .toEqual([{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: INF }])
  })
  it('a block too tall for any page stays on its own, to be cut', () => {
    expect(cutPages([b(1, 0, 10), b(2, 20, 500), b(3, 510, 540)], 100))
      .toEqual([{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: INF }])
  })
  it('a slide knows how much of its page it left empty', () => {
    expect(cut([b(1, 0, 10), b(2, 20, 50), b(4, 60, 70), b(6, 80, 400)], 100).map((p) => p.spare)).toEqual([90, 50, 0])
  })
  it('a slide is the lines it covers', () => {
    expect(pageTexts('a\nb\nc\nd', [{ from: 1, to: 2 }, { from: 4, to: INF }])).toEqual(['a\nb', 'd'])
  })
  it('headings number through the note, and code is not a heading', () => {
    const body = '# a\n## b\n### c\n## d\n```\n# no\n```\n# e\n### f'
    expect([...headingNumbers(body).values()]).toEqual(['1', '1.1', '1.1.1', '1.2', '2', '2.0.1'])
    expect(numberHeadings('# a\n\n## b\ntext')).toBe('# 1\u2002 a\n\n## 1.1\u2002 b\ntext')
    expect([...headingNumbers('## a\n## b').values()]).toEqual(['1', '2'])
  })
  it('the rules of a note, code blocks aside', () => {
    expect(ruleLines('a\n---\n```\n---\n```\n----')).toEqual([2, 6])
  })
  it('`---` under text is a rule, not a heading; in a fence it is code', () => {
    expect(plainRules('a\n---\n```\n---\n```')).toBe('a\n***\n```\n---\n```')
  })
})
