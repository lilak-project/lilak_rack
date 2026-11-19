import { describe, expect, it } from 'vitest'
import { colInUse, shownAfter } from '../racklist/panes.jsx'

const tabs = ['a', 'b', 'c', 'd'].map((id) => ({ id }))

describe('shownAfter: the tab a column shows once one leaves', () => {
  it('goes to the nearest on the left', () => expect(shownAfter(tabs, 'c', 'c')).toBe('b'))
  it('or, the first one leaving, to the right', () => expect(shownAfter(tabs, 'a', 'a')).toBe('b'))
  it('stays where it is when another one leaves', () => expect(shownAfter(tabs, 'b', 'd')).toBe('b'))
  it('takes the last as shown when none is named', () => {
    expect(shownAfter(tabs, undefined, 'a')).toBe('d')
    expect(shownAfter(tabs, 'gone', 'd')).toBe('c')
  })
  it('has nothing to show when the only one leaves', () => expect(shownAfter([{ id: 'a' }], 'a', 'a')).toBe(null))
  it('has nothing to show in an empty column', () => expect(shownAfter([], undefined, 'a')).toBe(null))
})

describe('colInUse: the column ⌘X closes a tab of', () => {
  const pane = (col) => {
    const el = document.createElement('div')
    el.className = 'rl-pane rl-epane'
    el.dataset.col = col
    const field = el.appendChild(document.createElement('textarea'))
    document.body.appendChild(el)
    return field
  }
  it('is the one the focus is in, not the first', () => {
    expect(colInUse({ cols: [0, 1], col: 0 }, pane(1))).toBe(1)
    expect(colInUse({ cols: [0, 1], col: 1 }, pane(0))).toBe(0)
    expect(colInUse({ cols: ['full'], col: 1 }, pane('full'))).toBe('full')
  })
  it('is the one last pressed when the focus is somewhere else', () => {
    expect(colInUse({ cols: [0, 1], col: 1 }, document.body)).toBe(1)
  })
  it('is the first when that one has gone', () => {
    expect(colInUse({ cols: [0], col: 1 }, document.body)).toBe(0)
    expect(colInUse({ cols: ['full'], col: 1 }, null)).toBe('full')
  })
})
