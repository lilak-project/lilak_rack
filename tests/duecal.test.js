import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { dueKeys } from '../note/src-lilak/liveedit.js'

/** The little calendar `>> ` opens: it goes when the day is not chosen and the
 *  writing goes on somewhere else. */
const view = (doc) => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return new EditorView({ state: EditorState.create({ doc, extensions: [dueKeys] }), parent: el })
}
/** A space typed at `at`, through the input handlers as the keyboard would. */
const space = (v, at) => v.state.facet(EditorView.inputHandler).some((h) => h(v, at, at, ' '))
const open = (v) => !!v.dom.querySelector('.nt-cal')
const DOC = 'first line\n- [ ] 할 일 >>'

describe('the due calendar', () => {
  it('opens on `>> ` and shuts when the caret goes elsewhere', () => {
    const v = view(DOC)
    expect(space(v, DOC.length)).toBe(true)
    expect(open(v)).toBe(true)
    v.dispatch({ selection: { anchor: 3 } })
    expect(open(v)).toBe(false)
  })

  it('stays while the caret stays where it was opened', () => {
    const v = view(DOC)
    space(v, DOC.length)
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    expect(open(v)).toBe(true)
  })

  it('shuts on an edit elsewhere', () => {
    const v = view(DOC)
    space(v, DOC.length)
    v.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(open(v)).toBe(false)
  })
})
