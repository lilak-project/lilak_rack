import { describe, it, expect } from 'vitest'
import { calAsk } from '../racklist/portal.js'

describe('calAsk', () => {
  it('reads a calendar open request', () => {
    expect(calAsk('cal:2026-11-20:15ddf42a-1')).toEqual(['2026-11-20', '15ddf42a-1'])
  })
  it('leaves a plain open request alone', () => {
    expect(calAsk('15ddf42a-1')).toBe(null)
    expect(calAsk('')).toBe(null)
  })
})
