import { describe, it, expect } from 'vitest'
import { flowOf, flowSteps } from '../racklist/chain.js'

const def = {
  item: { id: 'id', fields: [{ k: 'name' }, { k: 'chain', type: 'chain' }] },
  calendar: { start: 'start', repeat: 'repeat', series: 'series', seriesDate: 'seriesDate', time: (r) => r.time },
}
const byId = (items) => (id) => items.find((r) => r.id === id)

describe('a flow', () => {
  it('is the field, or the series a record repeats or was taken out of', () => {
    const rep = { id: 'r', start: '2026-11-03', repeat: { rule: 'FREQ=WEEKLY;COUNT=3' } }
    const one = { id: 'o', start: '2026-11-11', series: { id: 'r' }, seriesDate: '2026-11-10' }
    const items = [rep, one, { id: 'a', chain: 'a' }, { id: 'b' }]
    expect(flowOf(def, items[2], byId(items))).toBe('a')
    expect(flowOf(def, items[3], byId(items))).toBe('')
    expect(flowOf(def, rep, byId(items))).toBe('r')
    expect(flowOf(def, one, byId(items))).toBe('r')
  })
  it('steps by day, then time, through the sittings of a record that repeats', () => {
    const items = [
      { id: 'a', chain: 'a', start: '2026-11-01' },
      { id: 'r', chain: 'a', start: '2026-11-03', repeat: { rule: 'FREQ=WEEKLY;COUNT=3', ex: ['2026-11-17'] } },
      { id: 'o', chain: 'a', start: '2026-11-11', series: { id: 'r' }, seriesDate: '2026-11-10' },
      { id: 'c', chain: 'a', start: '2026-11-03', time: '09:00' },
      { id: 'x', chain: 'x', start: '2026-11-02' },
    ]
    // a 11/1 · r 11/3 (no time: before) · c 11/3 09:00 · o 11/11 (11/10 taken out, 11/17 left out)
    const at = (id, occ) => { const s = flowSteps(def, items, items.find((r) => r.id === id), occ, '2026-11-01'); return [s.prev?.id, s.prev?.occ, s.next?.id, s.next?.occ, s.at, s.total] }
    expect(at('a')).toEqual([undefined, undefined, 'r', '2026-11-03', 1, 4])
    expect(at('r', '2026-11-03')).toEqual(['a', '', 'c', '', 2, 4])
    expect(at('c')).toEqual(['r', '2026-11-03', 'o', '', 3, 4])
    expect(at('o')).toEqual(['c', '', undefined, undefined, 4, 4])
  })
  it('has no count when a rule has no end, and none for a record in no flow', () => {
    const items = [{ id: 'r', start: '2026-01-07', repeat: { rule: 'FREQ=WEEKLY' } }, { id: 'b', start: '2026-01-01' }]
    const s = flowSteps(def, items, items[0], '', '2026-11-06')
    expect([s.prev?.occ, s.next?.occ, s.total]).toEqual(['2026-11-04', '2026-11-18', 0])
    expect(flowSteps(def, items, items[1])).toBe(null)
  })
})
