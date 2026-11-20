// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { blocksOf } from '../note/src-lilak/slides.jsx'

describe('what can start a slide', () => {
  it('picture lines straight under a list item are lines, not one tall item', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h1 data-line="1">x</h1><ul data-line="2"><li data-line="2">text<br><img><br><img></li></ul>'
    let top = 0
    vi.spyOn(document, 'createRange').mockImplementation(() => ({
      setStartBefore() {}, setEndAfter() {},
      getBoundingClientRect: () => ({ top: (top += 10), bottom: top + 5 }),
    }))
    expect(blocksOf(root).map((b) => b.line)).toEqual([1, 2, 3, 4])
  })
  it('an item with a list under it is its own words, then each item under it', () => {
    const root = document.createElement('div')
    root.innerHTML = '<ul data-line="1"><li data-line="1">top<br>more<ul data-line="3"><li data-line="3">a</li>'
      + '<li data-line="4">b<ol data-line="5"><li data-line="5">c</li></ol></li></ul></li><li data-line="6">d</li></ul>'
    expect(blocksOf(root).map((b) => b.line)).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('a slide starting inside a list starts at the left, not as code', async () => {
    const { pageTexts } = await import('../note/src-lilak/marks.js')
    const body = '- top\n  - a\n    - b\n      - c\n  - d'
    expect(pageTexts(body, [{ from: 1, to: 2 }, { from: 3, to: 5 }])).toEqual(['- top\n  - a', '- b\n  - c\n- d'])
  })
})

describe('slides follow their lines', async () => {
  const { EditorState } = await import('@codemirror/state')
  const { deckField, setDeck } = await import('../note/src-lilak/slides.jsx')
  it('a line typed above a cut moves the cut with it; gaps stay', () => {
    let s = EditorState.create({ doc: 'a\n# two\nb\n# three\nc', extensions: [deckField] })
    const pages = [{ from: 1, to: 1, spare: 0 }, { from: 2, to: 3, spare: 10 }, { from: 4, to: 5, spare: 0 }]
    s = s.update({ effects: setDeck.of({ pages, title: 'a', h: 562 }) }).state
    s = s.update({ changes: { from: 1, insert: '\nnew' } }).state   // a line under line 1
    expect(s.field(deckField).deckIn.pages.map((p) => [p.from, p.to])).toEqual([[1, 2], [3, 4], [5, 6]])
  })
})
