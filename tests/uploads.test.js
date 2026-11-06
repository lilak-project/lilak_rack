import { describe, expect, it } from 'vitest'
import { filesOf, uploadUrl } from '../racklist/uploads.jsx'

const def = { item: { key: 'logs' } }

describe('uploads', () => {
  it('gathers every item\'s files, newest first, and skips what is not a stored file', () => {
    const doc = { logs: [
      { id: 'a', files: [{ id: '1', name: 'old.png', at: '2026-01-01' }, { name: 'inline, no id' }] },
      { id: 'b', files: [{ id: '2', name: 'new.pdf', at: '2026-02-01' }] },
      { id: 'c' },
    ] }
    expect(filesOf(def, doc, 'files').map(({ f, rec }) => [f.name, rec.id])).toEqual([['new.pdf', 'b'], ['old.png', 'a']])
  })
  it('addresses a file by id and its name, encoded', () => {
    expect(uploadUrl({ id: 'abc', name: '그림 1.png' })).toMatch(/\/api\/uploads\/abc\/%EA%B7%B8%EB%A6%BC%201\.png$/)
    expect(uploadUrl({ id: 'abc', name: 'a' }, true)).toMatch(/\?download=1$/)
  })
})
