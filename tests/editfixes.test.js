import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { dueKeys, tableInput, tableKeys, wrapSel } from '../note/src-lilak/liveedit.js'
import { overdue, tickLine, today } from '../note/src-lilak/marks.js'

/** What the editor review of 2026-11-17 found, each held by one check. */
const view = (doc, extensions) => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return new EditorView({ state: EditorState.create({ doc, extensions }), parent: el })
}
/** A space typed at `at`, through the input handlers as the keyboard would. */
const space = (v, at) => v.state.facet(EditorView.inputHandler).some((h) => h(v, at, at, ' '))
const enter = (v) => runScopeHandlers(v, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')

describe('a to-do ticked in the editor', () => {
  it('is dated as the to-do list dates it, and undated when cleared', () => {
    expect(tickLine('- [ ] 보내기 » 2026-11-20', true, '2026-11-18')).toBe('- [x] 보내기 » 2026-11-20 ✓ 2026-11-18')
    expect(tickLine('- [x] 보내기 » 2026-11-20 ✓ 2026-11-18', false)).toBe('- [ ] 보내기 » 2026-11-20')
    expect(tickLine('  * [x] 다시 ✓ 2026-11-01', true, '2026-11-18')).toBe('  * [x] 다시 ✓ 2026-11-18')
    expect(tickLine('그냥 줄', true)).toBe('그냥 줄')
  })
})

describe('overdue', () => {
  it('goes by the day here, not by UTC', () => {
    const d = new Date()
    const local = (by) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + by); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}` }
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(overdue(local(-1))).toBe(true)
    expect(overdue(local(0))).toBe(false)
  })
})

describe('⌘B', () => {
  it('pressed twice takes the stars off again', () => {
    const v = view('굵게 할 말', [])
    v.dispatch({ selection: { anchor: 0, head: 2 } })
    wrapSel(v, '**')
    expect(v.state.doc.toString()).toBe('**굵게** 할 말')
    wrapSel(v, '**')
    expect(v.state.doc.toString()).toBe('굵게 할 말')
    // an italic asked of bold text goes round it, not through its stars
    wrapSel(v, '**'); wrapSel(v, '*')
    expect(v.state.doc.toString()).toBe('***굵게*** 할 말')
    wrapSel(v, '*')
    expect(v.state.doc.toString()).toBe('**굵게** 할 말')
    v.destroy()
  })
})

describe('the typing rules, in code', () => {
  it('leave `>> ` and `|| ` alone inside a fence', () => {
    const doc = '```sh\necho hi >>\n||\n```\n'
    const v = view(doc, [markdown(), dueKeys, tableInput])
    expect(space(v, doc.indexOf('>>') + 2)).toBe(false)
    expect(space(v, doc.indexOf('||') + 2)).toBe(false)
    // and still work outside it
    const w = view('할 일 >>', [markdown(), dueKeys])
    expect(space(w, w.state.doc.length)).toBe(true)
    v.destroy(); w.destroy()
  })
})

describe('Enter in a table', () => {
  const TABLE = '| a | b |\n| --- | --- |\n|   |   |'
  it('leaves by an empty last row', () => {
    const v = view(TABLE, [tableKeys])
    v.dispatch({ selection: { anchor: v.state.doc.length - 2 } })
    expect(enter(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('| a | b |\n| --- | --- |\n\n')
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
    v.destroy()
  })
  it('is not taken by a line of prose that begins with a pipe', () => {
    const v = view('|x| = 3', [tableKeys])
    v.dispatch({ selection: { anchor: 7 } })
    expect(enter(v)).toBe(false)
    v.destroy()
  })
})

describe('the caret and a list item\'s marker', async () => {
  const { EditorState } = await import('@codemirror/state')
  const { markdown } = await import('@codemirror/lang-markdown')
  const { listCaret } = await import('../note/src-lilak/liveedit.js')
  const make = (doc, head) => EditorState.create({ doc, selection: { anchor: head }, extensions: [markdown(), listCaret] })
  it('lands in front of the words, not inside `- [ ] `', () => {
    const s = make('a\n- [ ] 일\n', 0)
    expect(s.update({ selection: { anchor: 3 } }).state.selection.main.head).toBe(8)   // in `- [`
    expect(s.update({ selection: { anchor: 2 } }).state.selection.main.head).toBe(8)   // Home on the item
  })
  it('a step left from the words goes to the line above', () => {
    const s = make('a\n- b\n', 4)
    expect(s.update({ selection: { anchor: 3 } }).state.selection.main.head).toBe(1)
  })
  it('a `- x` in code is text', () => {
    const s = make('```\n- x\n```\n', 0)
    expect(s.update({ selection: { anchor: 4 } }).state.selection.main.head).toBe(4)
  })
})

describe('Backspace in front of a list item\'s words', async () => {
  const { keymap } = await import('@codemirror/view')
  const { markdownKeymap } = await import('@codemirror/lang-markdown')
  const { listKeys } = await import('../note/src-lilak/liveedit.js')
  const press = (doc, head) => {
    const v = new EditorView({ state: EditorState.create({ doc, selection: { anchor: head },
      extensions: [markdown(), keymap.of(markdownKeymap), listKeys] }) })
    runScopeHandlers(v, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor')
    const out = v.state.doc.toString()
    v.destroy()
    return out
  }
  it('takes the marker, its space and the indent — no second press', () => {
    expect(press('- a\n  - b\n', 8)).toBe('- a\nb\n')
    expect(press('- a\n\t- [ ] b\n', 11)).toBe('- a\nb\n')
    expect(press('- b\n', 2)).toBe('b\n')
  })
})
