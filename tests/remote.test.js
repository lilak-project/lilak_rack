import { describe, it, expect, beforeEach, vi } from 'vitest'
import { remoteDocOf } from '../racklist/portal.js'

// Another service's document: fetched once, then only its version is asked
// while it stands; fetched again when the version moved.
const mem = new Map()
globalThis.sessionStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }
let version = 3
const calls = []
globalThis.fetch = vi.fn(async (url) => {
  calls.push(String(url))
  if (String(url).endsWith('/version')) return { ok: true, json: async () => ({ version }) }
  return { ok: true, json: async () => ({ version, references: [{ id: 'a', citeKey: 'K' }] }) }
})

describe('remoteDocOf', () => {
  beforeEach(() => { calls.length = 0 })
  it('fetches the document the first time and keeps it', async () => {
    mem.clear()
    const d = await remoteDocOf('reference_manager', 'papers')
    expect(d.references[0].citeKey).toBe('K')
    expect(calls).toEqual(['/pp/reference_manager/papers/api/data'])
  })
  it('asks only the version while it stands', async () => {
    const d = await remoteDocOf('reference_manager', 'papers')
    expect(d.version).toBe(3)
    expect(calls).toEqual(['/pp/reference_manager/papers/api/data/version'])
  })
  it('fetches again once the version moved', async () => {
    version = 4
    const d = await remoteDocOf('reference_manager', 'papers')
    expect(d.version).toBe(4)
    expect(calls).toEqual(['/pp/reference_manager/papers/api/data/version', '/pp/reference_manager/papers/api/data'])
  })
})
