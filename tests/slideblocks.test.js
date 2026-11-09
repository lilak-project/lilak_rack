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
})
