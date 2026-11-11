import { describe, it, expect } from 'vitest'
import { leadFor, paragraphEnds, placeAt, stamp } from '../note/src-lilak/recorder.js'

describe('dictation: where the next words go', () => {
  it('starts a paragraph only after a sentence has ended', () => {
    expect(paragraphEnds('끝났다.', 10, 0)).toBe(true)
    expect(paragraphEnds('끝나지 않았고,', 10, 900)).toBe(false)
    expect(paragraphEnds('Done?', 2.5, 300)).toBe(true)
    expect(paragraphEnds('Done.', 2.4, 300)).toBe(false)
    expect(paragraphEnds('Done.', 0, 500)).toBe(true)
    expect(paragraphEnds('Done.', 3, 299)).toBe(false)
    expect(paragraphEnds('끝없이 이어지고', 1, 1000)).toBe(true)
    expect(paragraphEnds('끝없이 이어지고', 0.5, 1500)).toBe(false)
  })
  it('goes after the last words it wrote, the caret having moved', () => {
    expect(placeAt('a ![[r.webm]]\nhello b hello', 'hello')).toBe(27)
    expect(placeAt('edited away', 'hello')).toBe(11)
    expect(placeAt('anything', '')).toBe(-1)
  })
  it('stamps a paragraph with when it was said', () => {
    expect(stamp(new Date(2026, 10, 10, 9, 5, 7, 900).getTime())).toBe('[09:05:07]')
  })
  it('starts a new recording on a paragraph of its own', () => {
    expect(leadFor('', '')).toBe('')
    expect(leadFor('', '앞 문장.')).toBe('\n')
    expect(leadFor('쓰던 줄', '')).toBe('\n\n')
  })
})
