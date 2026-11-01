import { describe, it, expect } from 'vitest'
import { defineRack, itemScope, isFav, withFav } from '../racklist/schema.js'

const def = defineRack({ name: 't', item: { key: 'items', fields: [{ k: 'name', type: 'text', col: 100 }] } })
// A service that keeps no tags of its own (item.tags: false): the star's tag rides in a hidden `tags`.
const bare = defineRack({ name: 't', item: { key: 'items', tags: false, fields: [{ k: 'name', type: 'text', col: 100 }] } })
const tab = { kind: 'items' }

describe('favorites', () => {
  it('tags on and off, leaving no empty field behind', () => {
    const r = withFav(bare, { id: 'a', name: 'A' }, true)
    expect(r.tags).toEqual(['favorite'])
    expect(isFav(bare, r)).toBe(true)
    expect('tags' in withFav(bare, r, false)).toBe(false)
    // With the kit's own tags field, it is an ordinary tag list.
    expect(withFav(def, withFav(def, { id: 'a' }, true), false).tags).toEqual([])
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
