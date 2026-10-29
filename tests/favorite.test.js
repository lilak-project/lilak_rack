import { describe, it, expect } from 'vitest'
import { defineRack, itemScope, isFav, withFav } from '../racklist/schema.js'

const def = defineRack({ name: 't', item: { key: 'items', fields: [{ k: 'name', type: 'text', col: 100 }] } })
const tab = { kind: 'items' }

describe('favorites', () => {
  it('tags on and off, leaving no empty field behind', () => {
    const r = withFav(def, { id: 'a', name: 'A' }, true)
    expect(r.tags).toEqual(['favorite'])
    expect(isFav(def, r)).toBe(true)
    expect('tags' in withFav(def, r, false)).toBe(false)
  })
  it('keeps a declared tag field and its first tag first', () => {
    const d = defineRack({ name: 't', item: { key: 'items', fields: [{ k: 'tags', type: 'tags' }] } })
    expect(withFav(d, { tags: ['main'] }, true).tags).toEqual(['main', 'favorite'])
    expect(withFav(d, { tags: ['main', 'favorite'] }, false).tags).toEqual(['main'])
  })
  it('comes first whatever the sort', () => {
    const doc = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b', tags: ['favorite'] }, { id: 3, name: 'c' }] }
    const by = { name: (r) => r.name }
    expect(itemScope(def, doc, tab, { k: 'name', dir: 1 }, by).map((r) => r.id)).toEqual([2, 1, 3])
    expect(itemScope(def, doc, tab, { k: 'name', dir: -1 }, by).map((r) => r.id)).toEqual([2, 3, 1])
  })
})
