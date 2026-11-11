import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Rendered } from '../note/src-lilak/reading.jsx'
import { cutPages as cut, plainRules, headingNumbers, numberHeadings, pageTexts, ruleLines, blankHeights, tagLine, mathFences, figureList, figureOf, isPicture, commentSpans, blankComments, dropComments, highlightSpans } from '../note/src-lilak/marks.js'

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

describe('blankHeights', () => {
  const at = (body, caret = 0, starts = new Set()) => [...blankHeights(body.split('\n'), caret, starts)]
  it('is a paragraph gap between text, once however many', () => {
    expect(at('a\n\n\nb')).toEqual([[2, 'gap'], [3, 'none']])
  })
  it('is nothing beside a heading or where a slide ends', () => {
    expect(at('# h\n\na\n\n# i')).toEqual([[2, 'none'], [4, 'none']])
    expect(at('a\n\nb', 0, new Set([3]))).toEqual([[2, 'none']])
    expect(at('a\n\n---\n')).toEqual([[2, 'none'], [4, 'none']])
  })
  it('leaves the caret\'s line alone', () => {
    expect(at('a\n\nb', 2)).toEqual([])
    expect(at('\na', 1)).toEqual([[1, 'idle']])
  })
  it('counts a ``` as nothing and the empty lines inside one as lines', () => {
    expect(at('```\nx\n\ny\n```\n\nz')).toEqual([[6, 'gap'], [1, 'none'], [5, 'none']])
    expect(at('```\nx\n```\nz')).toEqual([[1, 'none'], [3, 'gap']])
    expect(at('z\n```\nx\n```')).toEqual([[2, 'gap'], [4, 'none']])
  })
  it('keeps a ``` the caret is in, for as long as the caret is typing', () => {
    expect(at('```\nx\n```', 2)).toEqual([[1, 'idle'], [3, 'idle']])
  })
  it('takes the tags that open a note off the title slide', () => {
    const lines = '#a #b\n\n부제'.split('\n')
    expect([...blankHeights(lines, 3, new Set(), true)].sort()).toEqual([[1, 'none'], [2, 'none']])
    expect([...blankHeights(lines, 1, new Set(), true)].sort()).toEqual([[1, 'idle'], [2, 'idle']])
  })
})

describe('what the show and the editor both read', () => {
  it('passes tags over when it looks for the title slide\'s line', () => {
    expect(cutPages([b(1, 0, 10, { tags: true }), b(2, 20, 30), b(5, 40, 50)], 100))
      .toEqual([{ from: 2, to: 4 }, { from: 5, to: INF }])
  })
  it('leaves the title alone when the first line is empty or a # heading', () => {
    const alone = { from: 0, to: -1 }
    expect(cutPages([b(2, 0, 10), b(3, 20, 30)], 100)).toEqual([alone, { from: 2, to: INF }])
    expect(cutPages([b(1, 0, 10, { h1: true }), b(3, 20, 30)], 100)).toEqual([alone, { from: 1, to: INF }])
    expect(cutPages([b(1, 0, 10, { tags: true }), b(3, 20, 30)], 100)).toEqual([alone, { from: 3, to: INF }])
  })
  it('knows a line of tags', () => {
    expect(tagLine('#a #b/c')).toBe(true)
    expect(tagLine('#a 글')).toBe(false)
    expect(tagLine('# 제목')).toBe(false)
    expect(tagLine('')).toBe(false)
  })
  it('finds $$ blocks that are closed and outside code', () => {
    expect(mathFences('$$\nx\n$$\n```\n$$\n```\n$$\ny')).toEqual([[1, 3]])
  })
  it('tells a picture by its address', () => {
    expect(['a.png', 'a.png?x=1', 'https://x/img'].map(isPicture)).toEqual([true, true, true])
    expect(['a.pdf', 'foo', 'https://x/a.pdf'].map(isPicture)).toEqual([false, false, false])
  })
  it('numbers both spellings of a picture, and none in code', () => {
    expect(figureList('![[a.png]]\n`![[b.png]]`\n![글](c.png)\n![글](d.pdf)').map((f) => [f.n, f.line, f.name]))
      .toEqual([[1, 1, 'a.png'], [2, 3, 'c.png']])
  })
  it('rewrites a width in the spelling it was written in', () => {
    expect(figureOf('![[a.png|40]]').sized(300)).toBe('![[a.png|300]]')
    expect(figureOf('![[a.png|40]]').sized(0)).toBe('![[a.png]]')
    expect(figureOf('![글|40](a.png)').sized(300)).toBe('![글|300](a.png)')
  })
  it('asks for files by name and leaves addresses alone', () => {
    const f = (n) => `/f/${n}`
    expect(figureOf('![글](my%20a.png)').url(f)).toBe('/f/my a.png')
    expect(figureOf('![글](https://x/a.png)').url(f)).toBe('https://x/a.png')
  })
})

describe('%% comments and ==highlights==', () => {
  const said = (t) => t.map(([a, b], i) => b - a + i)
  it('finds comments over lines, and none in code', () => {
    expect(commentSpans('a %%b%% c')).toEqual([[2, 7]])
    expect(commentSpans('%%a\nb%%')).toEqual([[0, 7]])
    expect(commentSpans('`%%a%%`\n```\n%%b%%\n```')).toEqual([])
  })
  it('keeps every position, or at least every line', () => {
    expect(blankComments('a %%b%% c')).toBe('a       c')
    expect(dropComments('a\n%%b\nc%%\nd')).toBe('a\n\n\nd')
  })
  it('does not number a picture nobody will see', () => {
    expect(figureList('%%![[a.png]]%%\n![[b.png]]').map((f) => [f.n, f.name])).toEqual([[1, 'b.png']])
  })
  it('highlights words and leaves the other uses of == alone', () => {
    expect(highlightSpans('a ==b c== d')).toEqual([[2, 9]])
    for (const t of ['a == b == c', '=====', '$a==b$ $c==d$', 'https://x/?a==&b==', '`==a==`', '%%==a==%%']) {
      expect(highlightSpans(t)).toEqual([])
    }
    expect(said(highlightSpans('==a== ==b=='))).toEqual([5, 6])
  })
  it('draws them on the page', () => {
    const html = renderToStaticMarkup(createElement(Rendered, null, '앞 ==**굵게** a[b]== %%숨김%% 뒤'))
    expect(html).toContain('<mark class="nt-hl"><strong>굵게</strong> a[b]</mark>')
    expect(html).not.toContain('숨김')
    expect(html).not.toContain('%%')
  })
})
