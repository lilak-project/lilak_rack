import { describe, expect, it } from 'vitest'
import { shownAfter } from '../racklist/panes.jsx'

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
