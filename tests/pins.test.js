import { describe, it, expect } from 'vitest'
import { clearPins, lastEdit, marksOf, pinned, sawEdit, togglePin } from '../note/src-lilak/pins.js'

// A note id per case: the store is keyed by note, which is also what makes
// one note's bookmarks none of another's business.
let n = 0
const note = () => `2026-11-02-paper-${++n}`

describe('bookmarked lines', () => {
  it('a line number clicked is bookmarked, clicked again is not', () => {
    const id = note()
    expect(togglePin(id, 40)).toEqual([40])
    expect(togglePin(id, 12)).toEqual([40, 12])
    expect(pinned(id)).toEqual([40, 12])
    expect(togglePin(id, 40)).toEqual([12])
  })

  it('keeps them in the order they were made — the last is the last', () => {
    const id = note()
    togglePin(id, 90); togglePin(id, 3); togglePin(id, 50)
    // Where a note reopens: the bookmark made last, not the highest number.
    expect(marksOf(id).at(-1)).toBe(50)
  })

  it('shows the line last edited until a line is bookmarked', () => {
    const id = note()
    sawEdit(id, 118)
    expect(marksOf(id)).toEqual([118])
    togglePin(id, 7)
    expect(marksOf(id)).toEqual([7])            // a real one takes over
    // Clearing them does not leave nothing: the last line edited is still
    // kept, which is the whole reason it is kept.
    clearPins(id)
    expect(pinned(id)).toEqual([])
    expect(lastEdit(id)).toBe(118)
    expect(marksOf(id)).toEqual([118])
  })

  it('is one note at a time', () => {
    const a = note(); const b = note()
    togglePin(a, 5); sawEdit(a, 5)
    togglePin(b, 9)
    expect(pinned(a)).toEqual([5])
    expect(pinned(b)).toEqual([9])
    expect(lastEdit(b)).toBe(0)
  })

  it('a note nobody has opened has nothing to show', () => {
    expect(marksOf(note())).toEqual([])
    expect(pinned(note())).toEqual([])
  })
})
