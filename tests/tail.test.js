import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tail, tailRoom, toggleTail } from '../note/src-lilak/tail.js'

describe('room under the last line', () => {
  it('is put there by one press and taken away by the next, and is not text', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const v = new EditorView({ state: EditorState.create({ doc: 'a\nb', extensions: [tail] }), parent: el })
    expect(tailRoom(v.state)).toBe(0)
    toggleTail(v)
    expect(tailRoom(v.state)).toBeGreaterThan(0)
    v.dispatch({ changes: { from: 3, insert: '\nc' } })      // typing keeps it
    expect(tailRoom(v.state)).toBeGreaterThan(0)
    toggleTail(v)
    expect(tailRoom(v.state)).toBe(0)
    expect(v.state.doc.toString()).toBe('a\nb\nc')
    v.destroy()
  })
})
