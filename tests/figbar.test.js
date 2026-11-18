import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { deleteCharBackward } from '@codemirror/commands'
import { livePreview } from '../note/src-lilak/livemd.js'
import { figureList } from '../note/src-lilak/marks.js'

/** A picture in the live view: the bar drawn in place of `![[…]]`, the block
 *  under it, and what the bar's buttons write. They find their own markup
 *  from the DOM, which is the part no build or type can check. */
const view = (doc) => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return new EditorView({
    state: EditorState.create({ doc, extensions: [livePreview((n) => `/f/${n}`, () => {})] }),
    parent: el,
  })
}
const press = (el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
/** The bar's buttons, by what they do. */
const button = (v, cls) => v.dom.querySelector(`.nt-fig-bar .${cls}`)
const bars = (v) => v.dom.querySelectorAll('.nt-fig-bar').length
const DOC = '글\n![[a.png]]\n끝\n'

describe('the figure bar', () => {
  it('stands in place of the markup, with the picture under the line', () => {
    const v = view(DOC)
    expect(bars(v)).toBe(1)
    expect(v.dom.querySelector('.nt-fig-n')?.textContent).toMatch(/1$/)
    expect(v.dom.querySelector('.nt-embed-box img')?.getAttribute('src')).toBe('/f/a.png')
    v.destroy()
  })
  it('stays when the caret only rests on the line', () => {
    const v = view(DOC)
    v.dispatch({ selection: { anchor: DOC.indexOf('![[') } })
    expect(bars(v)).toBe(1)
    v.destroy()
  })
  it('writes a width with +, and takes it off with 자동 — the bar staying both times', () => {
    const v = view(DOC)
    press(button(v, 'nt-fig-more'))
    expect(v.state.doc.toString()).toMatch(/!\[\[a\.png\|\d+\]\]/)
    expect(bars(v)).toBe(1)
    press(button(v, 'nt-fig-fit'))
    expect(v.state.doc.toString()).toBe(DOC)
    expect(bars(v)).toBe(1)
    v.destroy()
  })
  it('gives the text back through its figure number alone, and folds it again when the caret leaves', () => {
    const v = view(DOC)
    press(button(v, 'nt-fig-n'))
    expect(bars(v)).toBe(0)
    expect(v.state.selection.main.head).toBe(DOC.indexOf(']]') + 2)
    // the picture is still under the line while the text is being edited
    expect(v.dom.querySelector('.nt-embed-box img')).toBeTruthy()
    v.dispatch({ selection: { anchor: 0 } })
    expect(bars(v)).toBe(1)
    v.destroy()
  })
  it('is one thing to Backspace: the whole picture goes', () => {
    const v = view(DOC)
    v.dispatch({ selection: { anchor: DOC.indexOf(']]') + 2 } })
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe('글\n\n끝\n')
    v.destroy()
  })
  it('puts the caret to its right when pressed', () => {
    const v = view(DOC)
    press(v.dom.querySelector('.nt-fig-name'))
    expect(v.state.selection.main.head).toBe(DOC.indexOf(']]') + 2)
    v.destroy()
  })
})

describe('an embed left open', () => {
  it('is text, not one picture reaching down to the next `]]`', () => {
    // `![[` typed above another embed or a [[link]]: read across the lines it
    // made a bar that replaced line breaks, which CodeMirror refuses — every
    // keystroke threw until the brackets were closed.
    const v = view('글 \n\n사이\n![[a.png]] [[노트]]\n끝\n')
    expect(() => v.dispatch({ changes: { from: 2, insert: '![[' } })).not.toThrow()
    expect(bars(v)).toBe(1)
    expect(figureList('글 ![[\n\n사이\n![[a.png]]\n').map((f) => f.line)).toEqual([4])
    v.destroy()
  })
})

describe('figureList: the pictures of a note, numbered', () => {
  it('numbers only the pictures, with their lines', () => {
    expect(figureList('![[a.png]]\n![[x.pdf]]\n\n![[b.jpg|300]]').map(({ n, line, name }) => [n, line, name]))
      .toEqual([[1, 1, 'a.png'], [2, 4, 'b.jpg']])
  })
  it('has nothing for a note without pictures', () => expect(figureList('글\n')).toEqual([]))
})
