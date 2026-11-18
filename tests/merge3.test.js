import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { merge3, rebase, retext } from '../note/src-lilak/merge3.js'

/** A save refused because the note changed elsewhere: both changes are kept. */
const BASE = '# 회의\n- [ ] 보내기\n- [ ] 확인\n\n메모\n'

describe('merge3', () => {
  it('takes theirs where I changed nothing, mine where they did not', () => {
    const mine = BASE + '새 문단\n'
    const theirs = BASE.replace('- [ ] 보내기', '- [x] 보내기')
    expect(merge3(BASE, mine, theirs)).toEqual({ text: '# 회의\n- [x] 보내기\n- [ ] 확인\n\n메모\n새 문단\n', clash: false })
    expect(merge3(BASE, BASE, theirs).text).toBe(theirs)
    expect(merge3(BASE, mine, BASE).text).toBe(mine)
  })
  it('keeps both where the same line changed, and says so', () => {
    const mine = BASE.replace('메모', '내 메모')
    const theirs = BASE.replace('메모', '받아쓴 말')
    const r = merge3(BASE, mine, theirs)
    expect(r.clash).toBe(true)
    expect(r.text).toBe('# 회의\n- [ ] 보내기\n- [ ] 확인\n\n내 메모\n받아쓴 말\n')
  })
  it('does not write the same change twice', () => {
    const both = BASE.replace('확인', '확인함')
    expect(merge3(BASE, both, both)).toEqual({ text: both, clash: false })
    // the same line added by both at the same place
    expect(merge3('a\nb', 'a\nx\nb', 'a\nx\nb').text).toBe('a\nx\nb')
  })
  it('puts lines added in two different places both in', () => {
    expect(merge3('a\nb\nc', 'a\n1\nb\nc', 'a\nb\n2\nc').text).toBe('a\n1\nb\n2\nc')
    expect(merge3('a\nb\nc', 'b\nc', 'a\nb\nc\nd').text).toBe('b\nc\nd')
  })
})

describe('rebase', () => {
  it('keeps my title and their date, and merges the body', () => {
    const base = { title: '회의', date: '2026-11-17', fields: {}, body: BASE, version: '1' }
    const mine = { ...base, title: '회의 (수정)', body: BASE + '끝\n' }
    const theirs = { ...base, date: '2026-11-18', body: BASE.replace('[ ] 확인', '[x] 확인'), version: '2' }
    const { note, clash } = rebase(base, mine, theirs)
    expect(clash).toBe(false)
    expect(note).toMatchObject({ title: '회의 (수정)', date: '2026-11-18', version: '2' })
    expect(note.body).toBe(BASE.replace('[ ] 확인', '[x] 확인') + '끝\n')
  })
})

describe('retext', () => {
  it('changes only what differs, so the caret stays', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const v = new EditorView({ state: EditorState.create({ doc: BASE + '쓰는 중' }), parent: el })
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    retext(v, BASE.replace('[ ] 보내기', '[x] 보내기') + '쓰는 중')
    expect(v.state.doc.toString()).toBe(BASE.replace('[ ] 보내기', '[x] 보내기') + '쓰는 중')
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
    v.destroy()
  })
})
