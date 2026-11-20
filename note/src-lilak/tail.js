import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, WidgetType, lineNumberWidgetMarker } from '@codemirror/view'
import { tr } from 'lilak-ui/i18n.jsx'

/** Room under the last line, asked for by a button under the last number.
 *
 *  A note ends where its text ends, so its last lines can only be read at the
 *  foot of the window. The button puts half a window of nothing under them —
 *  the last line comes up to the middle — and takes it away again. Nothing is
 *  written into the note: the room is this editor's, and gone when it is.
 */
const setRoom = StateEffect.define()
const half = (view) => Math.max(120, Math.round(view.scrollDOM.clientHeight / 2))

class Tail extends WidgetType {
  constructor(on, h) { super(); this.on = on; this.h = h }
  eq(o) { return o.on === this.on && o.h === this.h }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'nt-tail'
    if (this.on) el.style.height = `${this.h}px`
    return el
  }
  get estimatedHeight() { return this.on ? this.h : -1 }
}

class TailKey extends GutterMarker {
  constructor(on) { super(); this.on = on }
  eq(o) { return o.on === this.on }
  toDOM() {
    const b = document.createElement('span')
    b.className = `nt-tail-key${this.on ? ' on' : ''}`
    b.textContent = this.on ? '▴' : '▾'
    b.title = tr(this.on ? 'nt_tail_off' : 'nt_tail_on')
    return b
  }
}

const draw = (state, room) => Decoration.set([Decoration.widget({
  widget: new Tail(room > 0, room), block: true, side: 1 }).range(state.doc.length)])

const field = StateField.define({
  create: (state) => ({ room: 0, deco: draw(state, 0) }),
  update(v, tr_) {
    let { room } = v
    for (const e of tr_.effects) if (e.is(setRoom)) room = e.value
    return room === v.room && !tr_.docChanged ? v : { room, deco: draw(tr_.state, room) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

/** The room on, or off: what the button under the last number does. A press
 *  that makes room also goes down into it — that is what it was pressed for. */
export function toggleTail(view) {
  const on = view.state.field(field).room > 0
  view.dispatch({ effects: setRoom.of(on ? 0 : half(view)) })
  if (!on) requestAnimationFrame(() => view.scrollDOM.scrollTo?.({ top: view.scrollDOM.scrollHeight, behavior: 'smooth' }))
}
export const tailRoom = (state) => state.field(field, false)?.room || 0
/** Was this click the button's? (SourceArea's gutter handler asks first.) */
export const isTailKey = (e) => !!e.target.closest?.('.nt-tail-key')

export const tail = [
  field,
  lineNumberWidgetMarker.of((view, widget) => (widget instanceof Tail ? new TailKey(widget.on) : null)),
]
