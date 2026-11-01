import { describe, it, expect } from 'vitest'
import { mergeTags, spellTag, uniqueTags, sharedTagRows } from '../racklist/tags.js'
import { defineRack, classRows, wears } from '../racklist/schema.js'

describe('shared tags', () => {
  it('one tag whatever its case, named by the spelling used most', () => {
    expect(mergeTags([{ spirit: 5, CENS: 2 }, { SpiRIT: 26 }])).toEqual([
      { name: 'SpiRIT', count: 31 }, { name: 'CENS', count: 2 }])
  })
  it('a tag typed takes the spelling in use', () => {
    expect(spellTag(' spirit ', ['SpiRIT', 'CENS'])).toBe('SpiRIT')
    expect(spellTag('new', ['SpiRIT'])).toBe('new')
    expect(uniqueTags(['SpiRIT', 'spirit', 'CENS'])).toEqual(['SpiRIT', 'CENS'])
  })
  it('every service gets a tags field and tab; its rows ignore case', () => {
    const def = defineRack({ name: 't', item: { key: 'items', columns: ['name'], fields: [{ k: 'name', type: 'text' }] } })
    const f = def.item.fields.find((x) => x.k === 'tags')
    expect(f.type).toBe('tags')
    expect(def.item.columns).toContain('tags')
    const doc = { items: [{ tags: ['SpiRIT'] }, { tags: ['spirit'] }, { tags: ['SpiRIT'] }] }
    const rows = classRows(def, doc, def.classes.find((c) => c.k === 'tags'))
    expect(rows).toEqual([{ key: 'spirit', name: 'SpiRIT', count: 3 }])
    expect(wears(doc.items[1], f, 'SPIRIT')).toBe(true)
  })
  it('one list across services, with where else each is worn', () => {
    const src = [{ svc: 'note', label: '노트', tags: { spirit: 3, daily: 30 } }, { svc: 'ref', label: '논문', tags: { SpiRIT: 26 } }]
    const rows = sharedTagRows(src, { svc: 'ref', tags: { SpiRIT: 27 } })
    const sp = rows.find((r) => r.key === 'spirit')
    expect(sp.name).toBe('SpiRIT')
    expect(sp.by.find((b) => b.svc === 'note').n).toBe(3)
    expect(rows.map((r) => r.key).sort()).toEqual(['daily', 'spirit'])
  })
})
