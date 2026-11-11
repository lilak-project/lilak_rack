import { describe, it, expect } from 'vitest'
import { mergeTags, spellTag, uniqueTags, sharedTagRows, tagWithin, tagTree, tagMoves, tagRenames, projectWears } from '../racklist/tags.js'
import { choicesFor, setTagChoices } from '../note/src-lilak/marks.js'
import { facetOf, passesFilter, NOT } from '../racklist/sort.js'
import { defineRack, classRows, wears, itemSorters } from '../racklist/schema.js'

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

describe('tags inside tags', () => {
  const row = (name, count, per = {}) => ({ key: name.toLowerCase(), name, count, per })
  it('a tag is inside its parent, not inside one that merely starts the same', () => {
    expect(tagWithin('Agent/rack', 'agent')).toBe(true)
    expect(tagWithin('agent', 'agent')).toBe(true)
    expect(tagWithin('agents', 'agent')).toBe(false)
    expect(tagWithin('agent', 'agent/rack')).toBe(false)
    expect(projectWears({ tags: ['agent'] }, ['agent/rack'])).toBe(true)
    expect(projectWears({ tags: ['agent', 'x'], match: 'and' }, ['agent/rack'])).toBe(false)
  })
  it('the outline makes the missing parent, adds up, and keeps whole names', () => {
    const rows = [row('agent/a', 2, { 'svc:n': 1 }), row('agent/b', 3, { 'svc:n': 2 }), row('solo', 1)]
    const shut = tagTree(rows, () => false)
    expect(shut.map((r) => [r.name, r.count, r.kids, r.depth])).toEqual([['agent', 5, 2, 0], ['solo', 1, 0, 0]])
    expect(shut[0].group).toBe(true)
    expect(shut[0].per['svc:n']).toBe(3)
    expect(tagTree(rows, () => true).map((r) => [r.name, r.depth])).toEqual([['agent', 0], ['agent/a', 1], ['agent/b', 1], ['solo', 0]])
  })
  it('a worn parent keeps its own count on top of its children', () => {
    expect(tagTree([row('agent', 4), row('agent/a', 2)], () => false)[0]).toMatchObject({ count: 6, group: false })
  })
  it('moving takes what is inside along; a pick inside a pick follows the outer', () => {
    const all = ['agent', 'agent/a', 'agent/a/x', 'solo']
    expect(tagMoves(all, ['solo'], 'agent')).toEqual([{ from: 'solo', to: 'agent/solo' }])
    expect(tagMoves(all, ['agent/a'], 'solo')).toEqual([{ from: 'agent/a', to: 'solo/a' }, { from: 'agent/a/x', to: 'solo/a/x' }])
    expect(tagMoves(all, ['agent/a'], '')).toEqual([{ from: 'agent/a', to: 'a' }, { from: 'agent/a/x', to: 'a/x' }])
    expect(tagMoves(all, ['agent/a', 'agent/a/x'], 'solo').map((m) => m.to)).toEqual(['solo/a', 'solo/a/x'])
    expect(tagMoves(all, ['agent/a'], 'agent')).toEqual([])
  })
  it('renaming a parent renames what is inside', () => {
    expect(tagRenames(['agent/a', 'agents'], ['agent'], 'bot')).toEqual([{ from: 'agent', to: 'bot' }, { from: 'agent/a', to: 'bot/a' }])
  })
  it('# offers one level at a time, and a word inside still finds a tag', () => {
    setTagChoices(['agent/rack', 'agent/note', 'agent/note/ui', 'daily'])
    expect(choicesFor('')).toEqual(['agent/', 'daily'])
    expect(choicesFor('ag')).toEqual(['agent/'])
    expect(choicesFor('agent/')).toEqual(['agent/rack', 'agent/note', 'agent/note/'])
    expect(choicesFor('rack')).toEqual(['agent/rack'])
    setTagChoices([])
  })
})

describe('filtering by tags', () => {
  const get = Object.assign((r) => r.tags.join(' '), { many: (r) => r.tags })
  const recs = [{ id: 1, tags: ['agent/a', 'agent/b'] }, { id: 2, tags: ['Agent/c', 'x'] }, { id: 3, tags: ['agents'] }, { id: 4, tags: [] }]
  const kept = (sel) => recs.filter((r) => passesFilter(r, sel, { tags: get })).map((r) => r.id)
  it('offers each tag and each parent, a record counting once', () => {
    const f = Object.fromEntries(facetOf(recs, get).map((x) => [x.v.toLowerCase(), x.count]))
    expect(f).toEqual({ agent: 2, 'agent/a': 1, 'agent/b': 1, 'agent/c': 1, x: 1, agents: 1 })
  })
  it('a parent keeps what is inside it, and not a tag that merely starts the same', () => {
    expect(kept({ tags: ['agent'] })).toEqual([1, 2])
    expect(kept({ tags: ['agent/a', 'x'] })).toEqual([1, 2])
  })
  it('an excluded value takes what is inside it, and works with a chosen one', () => {
    expect(kept({ [NOT('tags')]: ['agent'] })).toEqual([3, 4])
    expect(kept({ tags: ['agent'], [NOT('tags')]: ['x'] })).toEqual([1])
  })
  it('a plain column still compares the whole value', () => {
    const plain = (r) => r.k
    expect(facetOf([{ k: 'a/b' }], plain)).toEqual([{ v: 'a/b', count: 1 }])
    expect(passesFilter({ k: 'a/b' }, { k: ['a'] }, { k: plain })).toBe(false)
    expect(passesFilter({ k: 'a' }, { [NOT('k')]: ['a'] }, { k: plain })).toBe(false)
  })
})

describe('a column that shows less than it sorts by', () => {
  const day = (r) => r.at.slice(0, 10)
  const def = { item: { key: 'items', id: 'id', fields: [
    { k: 'updated', get: day, sort: (_v, _c, r) => Date.parse(r.at), many: day },
  ] } }
  const early = { id: 'a', at: '2026-11-09T01:00:00Z' }, late = { id: 'b', at: '2026-11-09T23:00:00Z' }
  const get = itemSorters(def, { items: [early, late] }).updated
  it('sorts by the moment, though the cell says the day', () => {
    expect(get(late)).toBeGreaterThan(get(early))
  })
  it('is filtered by the day', () => {
    expect(facetOf([early, late], get)).toEqual([{ v: '2026-11-09', count: 2 }])
  })
})
