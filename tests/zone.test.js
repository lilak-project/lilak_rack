import { describe, it, expect } from 'vitest'
import { moveWall, shiftRule, moveRec, zoneView } from '../racklist/zone.js'

const z = { home: 'Asia/Seoul', pairs: [['start', 'startTime'], ['end', 'endTime', 'start']], repeat: 'repeat', series: 'series', seriesDate: 'seriesDate' }
const def = { zone: z, item: { key: 'activities', id: 'id' } }

describe('a time read in another zone', () => {
  it('moves the clock, and the day when it crosses midnight', () => {
    expect(moveWall('2026-11-21', '09:00', 'Asia/Seoul', 'America/Chicago')).toEqual({ d: '2026-11-20', t: '18:00' })
    expect(moveWall('2026-07-01', '09:00', 'Asia/Seoul', 'America/Chicago')).toEqual({ d: '2026-06-30', t: '19:00' })   // CDT
    expect(moveWall('2026-11-20', '18:00', 'America/Chicago', 'Asia/Seoul')).toEqual({ d: '2026-11-21', t: '09:00' })
  })
  it('moves a rule\'s days with its first sitting', () => {
    expect(shiftRule('FREQ=WEEKLY;BYDAY=WE,2SU;UNTIL=20261231', -1)).toBe('FREQ=WEEKLY;BYDAY=TU,2SA;UNTIL=20261230')
    expect(shiftRule('FREQ=WEEKLY;BYDAY=SA', 1)).toBe('FREQ=WEEKLY;BYDAY=SU')
  })
  it('leaves a day with no time, and an end that only borrowed the start\'s day', () => {
    const a = { id: 'a', start: '2026-11-21', startTime: '09:00', endTime: '10:00', end: '' }
    const v = moveRec(z, a, 'Asia/Seoul', 'America/Chicago')
    expect([v.start, v.startTime, v.end, v.endTime]).toEqual(['2026-11-20', '18:00', '', '19:00'])
    expect(moveRec(z, { id: 'b', start: '2026-11-21' }, 'Asia/Seoul', 'UTC')).toEqual({ id: 'b', start: '2026-11-21' })
    const r = { id: 'r', start: '2026-11-04', startTime: '09:00', repeat: { rule: 'FREQ=WEEKLY;BYDAY=WE', ex: ['2026-11-11'] } }
    expect(moveRec(z, r, 'Asia/Seoul', 'America/Chicago').repeat).toEqual({ rule: 'FREQ=WEEKLY;BYDAY=TU', ex: ['2026-11-10'] })
  })
  it('puts back only what an edit touched, exactly', () => {
    const raw = [{ id: 'a', start: '2026-11-21', startTime: '09:00' }, { id: 'b', start: '2026-11-22', startTime: '00:30', end: '2026-11-22', endTime: '23:59' }]
    const { doc, back } = zoneView(def, { activities: raw }, 'America/Chicago')
    const edited = { ...doc.activities[0], startTime: '19:00' }
    const p = back({ activities: [edited, doc.activities[1]] })
    expect(p.activities[1]).toBe(raw[1])
    expect(p.activities[0]).toEqual({ id: 'a', start: '2026-11-21', startTime: '10:00' })
    expect(back({ activities: [{ id: 'n', start: '2026-11-20', startTime: '18:00' }] }).activities[0]).toEqual({ id: 'n', start: '2026-11-21', startTime: '09:00' })
    expect(zoneView(def, { activities: raw }, 'Asia/Seoul').doc.activities).toBe(raw)
  })
})
