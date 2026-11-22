import { describe, it, expect } from 'vitest'
import { defineRack, classRows } from '../racklist/schema.js'

describe('a class worn by name', () => {
  it('lists the names in use that have no record yet, counted, beside the records', () => {
    // inventory: 9 places had records and 68 more were only typed on assets.
    const def = defineRack({ key: 't', item: { key: 'assets', fields: [{ k: 'location', type: 'class', of: 'locations' }] },
      classes: [{ k: 'locations', keyBy: 'name', fields: [{ k: 'name', type: 'text', col: 200 }] }] })
    const doc = { assets: [{ location: 'C313' }, { location: 'C315' }, { location: 'C315' }, { location: '' }],
      locations: [{ id: 'a', name: 'C313', photo: 'x' }, { id: 'b', name: 'IRIS2' }] }
    const rows = classRows(def, doc, def.classes.find((c) => c.k === 'locations'))
    expect(rows.map((r) => [r.name, r.count, !!r.id])).toEqual([['C313', 1, true], ['IRIS2', 0, true], ['C315', 2, false]])
  })
  it('lists only its records when worn by id', () => {
    const def = defineRack({ key: 't', item: { key: 'items', fields: [{ k: 'ev', type: 'class', of: 'events' }] },
      classes: [{ k: 'events', fields: [{ k: 'name', type: 'text', col: 200 }] }] })
    const rows = classRows(def, { items: [{ ev: 'typed' }], events: [{ id: 'e1', name: 'E' }] }, def.classes.find((c) => c.k === 'events'))
    expect(rows.map((r) => r.name)).toEqual(['E'])
  })
})
