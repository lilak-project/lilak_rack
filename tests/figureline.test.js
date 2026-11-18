import { describe, expect, it } from 'vitest'
import { figureLine } from '../note/src-lilak/marks.js'

/** A line of pictures folds to nothing on a slide (its bar floats above): one
 *  picture or several side by side, but never a line with words on it. */
describe('figureLine', () => {
  it('is a line of one picture or several', () => {
    expect(figureLine('![[a.png|440]]')).toBe(true)
    expect(figureLine('![[a.png|440]]  ![[b.png|440]]')).toBe(true)
    expect(figureLine('![설명|300](a.png) ![[b.png]]')).toBe(true)
  })
  it('is not a line with words', () => {
    expect(figureLine('보기 ![[a.png]]')).toBe(false)
    expect(figureLine('![[a.png]] 끝')).toBe(false)
    expect(figureLine('- ![[a.png]]')).toBe(false)
  })
})
