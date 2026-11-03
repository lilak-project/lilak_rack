import { describe, it, expect } from 'vitest'
import { nameText, nameKey, authorKeys, authorFor, authorsNamed } from '../racklist/tags.js'
import { AUTH_RE, setAuthorChoices, authorsFor, authorOf, authorShow, isAuthor, outsideCode, untagged } from '../note/src-lilak/marks.js'
import { defineRack, itemSorters } from '../racklist/schema.js'
import { facetOf, passesFilter } from '../racklist/sort.js'

const LEE = { id: 'a', kor: '이정우', eng: 'Jung Woo Lee', nick: 'jungwoo', email: 'jw@example.org' }
const KIM = { id: 'b', kor: '김민주', eng: 'Min Ju Kim', nick: '', email: 'mj@cens.example' }
const KIM2 = { id: 'c', kor: '김민주', eng: 'Min Joo Kim', nick: '', email: '' }
const withKeys = (p) => ({ ...p, keys: authorKeys(p) })

describe('a name is the key', () => {
  it('runs a name together and ignores case', () => {
    expect(nameText('Jung Woo Lee')).toBe('JungWooLee')
    expect(nameText("F.-K. Thielemann")).toBe('FKThielemann')
    expect(nameKey('Jung Woo Lee')).toBe('jungwoolee')
    expect(nameKey('JUNGWOOLEE')).toBe('jungwoolee')
    expect(nameText('이정우')).toBe('이정우')
  })
  it('one person is reached by either script and by their nick', () => {
    const list = [withKeys(LEE)]
    for (const w of ['이정우', 'JungWooLee', 'jungwoolee', 'Jung.Woo.Lee', 'jungwoo']) {
      expect(authorFor(list, w)?.id).toBe('a')
    }
    expect(authorFor(list, 'nobody')).toBe(null)
  })
  it('running a name together merges its spellings — one person, two ways', () => {
    // What this buys: `F.-K. Thielemann` and `F. K. Thielemann` are one key,
    // so a paper library full of both spellings reads as one person. What it
    // costs: two DIFFERENT people written `Min Ju Kim` and `Minju Kim` would
    // be one key too. Neither list has such a pair today.
    expect(nameKey('Min Ju Kim')).toBe(nameKey('Minju Kim'))
    expect(nameKey('F.-K. Thielemann')).toBe(nameKey('F. K. Thielemann'))
  })
  it('a name two people share names neither', () => {
    const list = [withKeys(KIM), withKeys(KIM2)]
    expect(authorFor(list, '김민주')).toBe(null)
    expect(authorsNamed(list, '김민주').length).toBe(2)
    // their own spellings still tell them apart
    expect(authorFor(list, 'MinJuKim')?.id).toBe('b')
    expect(authorFor(list, 'Min Joo Kim')?.id).toBe('c')
  })
})

describe('@ in a note', () => {
  const names = (t) => [...outsideCode(t).matchAll(AUTH_RE)].map((m) => m[2])
  it('a mention needs the line or a space in front, so an address is not one', () => {
    expect(names('고마워요 @이정우 그리고 @JungWooLee')).toEqual(['이정우', 'JungWooLee'])
    expect(names('@이정우 가 처음')).toEqual(['이정우'])
    expect(names('(@이정우)')).toEqual(['이정우'])
    expect(names('kim@jinr.ru 로 보냈다')).toEqual([])
    expect(names('a@b.com @이정우')).toEqual(['이정우'])
    expect(names('```\n@이정우\n```')).toEqual([])
  })
  it('the menu shows the other name and the address, and writes one word', () => {
    setAuthorChoices([withKeys(LEE), withKeys(KIM)])
    const [hit] = authorsFor('jung')
    expect(hit).toMatchObject({ text: 'JungWooLee', show: 'Jung Woo Lee', other: '이정우', email: 'jw@example.org' })
    // typed in Korean, the Korean spelling is what goes in
    expect(authorsFor('이정')[0]).toMatchObject({ text: '이정우', show: '이정우', other: 'Jung Woo Lee' })
    // one row per person, not one per spelling
    expect(authorsFor('이정').length).toBe(1)
    // nothing typed: everyone, once
    expect(authorsFor('').map((x) => x.show)).toEqual(['김민주', '이정우'])
  })
  it('a mention is drawn by the name it was written from', () => {
    setAuthorChoices([withKeys(LEE)])
    expect(authorShow('JungWooLee')).toBe('Jung Woo Lee')
    expect(authorShow('이정우')).toBe('이정우')
    expect(isAuthor('이정우')).toBe(true)
    expect(authorOf('아무개')).toBe(null)
    setAuthorChoices([withKeys(KIM), withKeys(KIM2)])
    expect(isAuthor('김민주')).toBe(false)   // shared: stays text
  })
})

describe('filtering by a person', () => {
  // A field that says its own values (note's people column) offers one row per
  // person in the facet filter, not the list of them as one string.
  const def = defineRack({
    name: 'n',
    item: { key: 'items', columns: ['people'], fields: [
      { k: 'people', label: 'people', get: (r) => (r.people || []).join(', '), many: (r) => r.people || [] },
    ] },
  })
  const doc = { items: [
    { people: ['Jung Woo Lee', '김민주'] },
    { people: ['Jung Woo Lee'] },
    { people: [] },
  ] }
  const sorters = itemSorters(def, doc)
  it('offers each person with how many rows they are on', () => {
    expect(facetOf(doc.items, sorters.people)).toEqual([
      { v: 'Jung Woo Lee', count: 2 }, { v: '김민주', count: 1 }])
  })
  it('keeps the rows that name them, whatever the case', () => {
    const kept = doc.items.filter((r) => passesFilter(r, { people: ['jung woo lee'] }, sorters))
    expect(kept.length).toBe(2)
    expect(doc.items.filter((r) => passesFilter(r, { 'people!': ['Jung Woo Lee'] }, sorters)).length).toBe(1)
  })
})

describe('a todo reads as a sentence', () => {
  it('takes out what has a column of its own, and leaves what has none', () => {
    
    setAuthorChoices([withKeys(LEE)])
    expect(untagged('초안 쓰기 #rack @JungWooLee')).toBe('초안 쓰기')
    expect(untagged('@이정우 한테 넘기기')).toBe('한테 넘기기')
    // nobody of that name: no column to go to, so it stays in the sentence
    expect(untagged('@아무개 한테 넘기기')).toBe('@아무개 한테 넘기기')
    // an address is not a mention and is never taken out
    expect(untagged('kim@jinr.ru 로 보내기 #rack')).toBe('kim@jinr.ru 로 보내기')
    // and code is not prose
    expect(untagged('`@이정우` 는 글자 #rack')).toBe('`@이정우` 는 글자')
  })
})
