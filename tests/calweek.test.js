import { describe, it, expect } from 'vitest'
import { weekOfMonth, opensMonth, toShove, toLift, growUp, arrange, wrapPieces } from '../racklist/calendar.jsx'

describe('a week belongs to the month of its Thursday', () => {
  it('counts the weeks of that month', () => {
    expect(weekOfMonth('2026-11-02')).toEqual([11, 1])     // Thu 11/5
    expect(weekOfMonth('2026-10-26')).toEqual([10, 5])     // Thu 10/29, though it ends 11/1
    expect(weekOfMonth('2026-11-08')).toEqual([11, 1])     // Sunday: still that week
    expect(weekOfMonth('2026-11-09')).toEqual([11, 2])
    expect(weekOfMonth('2026-12-28')).toEqual([12, 5])     // Thu 12/31, ends in January
    expect(weekOfMonth('2026-12-29')).toEqual([12, 5])
  })
})

describe('what moves down to give a todo one more lane', () => {
  const todo = (lane, a = 0, b = a) => ({ ev: { ext: { done: false } }, lane, rows: 1, a, b })
  const other = (lane, a = 0, b = a) => ({ ev: {}, lane, rows: 1, a, b })
  it('is all that is under it, in turn', () => {
    const [s, x, y, off] = [todo(0), todo(1), todo(2), todo(1, 2)]
    expect(toShove([s, x, y, off], s, 4)).toEqual([x, y])
  })
  it('goes on along a todo over several days', () => {
    const [s, wide, side] = [todo(0), todo(1, 0, 2), todo(2, 2)]
    expect(toShove([s, wide, side], s, 4)).toEqual([wide, side])
  })
  it('stops at the last lane, and at anything but a todo', () => {
    const [s, x] = [todo(0), todo(1)]
    expect(toShove([s, x], s, 2)).toBe(null)
    expect(toShove([s, x, other(2)], s, 4)).toBe(null)
    expect(toShove([s, other(1)], s, 4)).toBe(null)
  })
  it('leaves what is below a gap', () => {
    const [s, x, y] = [todo(0), todo(1), todo(3)]
    expect(toShove([s, x, y], s, 4)).toEqual([x])
  })
})

describe('a bar stacked from the bottom grows up', () => {
  const low = (lane, a = 0, b = a, rows = 1) => ({ ev: { low: 1 }, lane, rows, a, b })
  const top = (lane, a = 0, b = a, rows = 1) => ({ ev: {}, lane, rows, a, b })
  it('moves what is stacked over it up', () => {
    const [s, x, y, off] = [low(3), low(2), low(1), low(2, 1)]
    expect(toLift([s, x, y, off], s)).toEqual([x, y])
  })
  it('does not move what is on top, or past the first lane', () => {
    const s = low(3)
    expect(toLift([s, top(2)], s)).toBe(null)
    const t = low(1)
    expect(toLift([t, low(0)], t)).toBe(null)
  })
  it('only as far as its name needs', () => {
    const [s, over] = [low(3), low(2)]
    growUp([s, over], s, (x) => x.rows >= 2)
    expect([s.lane, s.rows, over.lane]).toEqual([2, 2, 1])
  })
  it('stops at the top, and under a bar it may not move', () => {
    const s = low(1)
    growUp([s], s, () => false)
    expect([s.lane, s.rows]).toEqual([0, 2])
    const [t, above, side] = [low(3), top(0), top(2, 1)]
    growUp([t, above, side], t, () => true)
    expect(t.lane).toBe(3)                                 // its name fits: stays
    growUp([t, above, side], t, () => false)
    expect([t.lane, t.rows]).toEqual([1, 3])               // past the bar beside it, up to the one on its day
    const [u, tall] = [low(3), top(0, 0, 0, 2)]
    growUp([u, tall], u, () => false)
    expect([u.lane, u.rows]).toEqual([2, 2])               // a tall bar holds every lane it spans
  })
})

describe('a week gives its bars their lanes, then lets names run on', () => {
  // need: the lanes its name wants; wide: the days it wants on one lane.
  const bar = (lane, a, need, wide, low = 0) => ({ ev: { low, ext: low ? undefined : { done: false } }, ends: true, lane, rows: 1, a, b: a, need, wide })
  const fits = (s, days) => s.rows >= s.need || 1 + days >= s.wide
  const lay = (placed, total, count) => arrange(placed, total, count, fits, () => false)
  it('takes lanes when that cuts nothing', () => {
    const s = bar(0, 0, 2, 3)
    lay([s], 3, 3)
    expect([s.rows, s.free]).toEqual([2, 0])
  })
  it('gives a lane to the day\'s own bar before a name running on to it', () => {
    const left = bar(1, 0, 9, 2)                           // would run on over day 1 in lane 1
    const s = bar(0, 1, 2, 2)                              // day 2 is free, but the lane comes first
    lay([left, s], 2, 3)
    expect([s.rows, s.free]).toEqual([2, 0])
    expect(left.free).toBe(0)
  })
  it('lets a name run on over what the lanes leave free', () => {
    const left = bar(1, 0, 9, 2)
    const s = bar(0, 1, 1, 1)                              // its name fits: lane 1 stays free
    lay([left, s], 2, 3)
    expect(left.free).toBe(2)
    const t = bar(0, 0, 2, 2)                              // no lane to take
    lay([t], 1, 3)
    expect([t.rows, t.free]).toEqual([1, 2])
  })
  it('moves a todo down, or what is stacked over a bar up', () => {
    const [s, under] = [bar(0, 0, 2, 9), bar(1, 0, 1, 1)]
    lay([s, under], 3, 1)
    expect([s.rows, under.lane]).toEqual([2, 2])
    const [over, t] = [bar(1, 0, 1, 1, 1), bar(2, 0, 2, 9, 1)]
    lay([over, t], 3, 1)
    expect([over.lane, t.lane, t.rows]).toEqual([0, 1, 2])
  })
  it('fills free lanes last, and only if that cuts no name', () => {
    const [left, s] = [bar(1, 0, 9, 2), bar(0, 1, 1, 1)]
    arrange([left, s], 2, 3, fits, (x) => x === s)
    expect(s.rows).toBe(1)                                 // lane 1 is the name's that runs on
    const u = bar(0, 0, 1, 1)
    arrange([u], 3, 1, fits, () => true)
    expect(u.rows).toBe(3)
  })
})

describe('where a name may wrap', () => {
  it('is at spaces, and between Hangul syllables', () => {
    expect(wrapPieces('atomx 에 파일')).toEqual(['atomx ', '에', ' ', '파', '일'])
    expect(wrapPieces('CENS meeting (10:00)')).toEqual(['CENS ', 'meeting ', '(10:00)'])
    expect(wrapPieces('')).toEqual([])
  })
})

describe('the day that names its month', () => {
  it('is the 1st, or with no weekends the Monday after a 1st on one', () => {
    expect(opensMonth('2026-12-01', false)).toBe(true)     // Tuesday
    expect(opensMonth('2026-12-01', true)).toBe(true)
    expect(opensMonth('2026-11-02', false)).toBe(false)    // 11/1 is a Sunday
    expect(opensMonth('2026-11-02', true)).toBe(true)
    expect(opensMonth('2026-08-03', true)).toBe(true)      // 8/1 is a Saturday
    expect(opensMonth('2026-11-09', true)).toBe(false)     // a later Monday
    expect(opensMonth('2026-09-07', true)).toBe(false)
  })
})
