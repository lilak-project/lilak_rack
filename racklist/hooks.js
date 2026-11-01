import './strings.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { load, save } from './portal.js'
import { tr } from '../i18n.jsx'

/** Column widths, dragged by the edge and remembered per project. `prefix`
 *  separates two tables in one service (the records and their classes). */
export function useColumnWidths(key, allCols) {
  const [widths, setWidths] = useState(() => load(key, {}))
  useEffect(() => { save(key, widths) }, [key, widths])
  const drag = useCallback((prefix) => (k, startX, startW) => {
    const move = (e) => {
      const col = allCols.find((c) => c.k === k)
      const w = Math.max(col?.min ?? 34, Math.round(startW + (e.clientX - startX)))
      setWidths((s) => ({ ...s, [prefix + k]: w }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('rl-resizing')
    }
    document.body.classList.add('rl-resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [allCols])
  /** Columns at their current width, minus the ones this window is too narrow
   *  for (a column leaves rather than the table scrolling sideways). */
  const sized = useCallback((cols, vw, prefix = '') => cols
    .filter((c) => !(c.drop && vw < c.drop))
    .map((c) => ({ ...c, w: widths[prefix + c.k] ?? c.w })), [widths])
  return { widths, drag, sized }
}

/** The window's width, for the columns that leave and the pane that splits. */
export function useViewportWidth() {
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1400 : window.innerWidth))
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vw
}

/** Click picks one; shift-click picks everything between it and the last one.
 *  `rows` is what is on screen, so a range never crosses a hidden row. */
export function useSelection(rows) {
  const [picked, setPicked] = useState(() => new Set())
  const lastHit = useRef(null)
  const hit = useCallback((i, shift) => {
    const from = shift && lastHit.current != null ? lastHit.current : i
    const [lo, hi] = from <= i ? [from, i] : [i, from]
    const span = rows.slice(lo, hi + 1).map((r) => r.id)
    // The row you started from decides: shift-click extends a selection, and a
    // plain click on a picked row unpicks it.
    const turningOn = shift ? true : !picked.has(rows[i].id)
    setPicked((s) => {
      const n = new Set(s)
      span.forEach((id) => (turningOn ? n.add(id) : n.delete(id)))
      return n
    })
    if (!shift) lastHit.current = i
  }, [rows, picked])
  const all = rows.length > 0 && rows.every((r) => picked.has(r.id))
  const some = rows.some((r) => picked.has(r.id))
  const toggleAll = useCallback(() => setPicked((s) => {
    const n = new Set(s)
    rows.forEach((r) => (all ? n.delete(r.id) : n.add(r.id)))
    return n
  }), [rows, all])
  const clear = useCallback(() => { setPicked(new Set()); lastHit.current = null }, [])
  return { picked, setPicked, hit, all, some, toggleAll, clear }
}

/** ⌘F / Ctrl+F belongs to the table's own search, not the browser's — the
 *  browser would only find the rows already painted anyway. */
export function useFindKey(ref) {
  useEffect(() => {
    const on = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [ref])
}

/** ⌘Enter / Ctrl+Enter toggles every row now on screen. It is the one thing a
 *  keyboard is wanted for here — search, then take all of it — and the modifier
 *  is what keeps a stray Enter from selecting a hundred rows. It fires wherever
 *  the focus is, including inside the search field you just typed in. */
export function useToggleKey(toggleAll) {
  const fn = useRef(toggleAll)
  fn.current = toggleAll
  useEffect(() => {
    const on = (e) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      fn.current?.()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}

/** One line of status, and it clears itself. */
export function useNote(ms = 4000) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), ms)
    return () => clearTimeout(t)
  }, [note, ms])
  return [note, setNote]
}

/** How this project was left: the tabs you opened, which one you were on, the
 *  sort and the applied filter. Read once — a starting point, not a live store.
 *  Picking mode and the drawers are not states you come back to. */
export function useViewState(key) {
  const first = useMemo(() => (typeof localStorage === 'undefined' ? {} : load(key, {})), [key])
  return [first, useCallback((v) => save(key, v), [key])]
}

/** The line between the list and the editor, dragged.
 *
 *  A pane that is always half the width is right for nobody: a wide record
 *  wants more, a long list wants less. The ratio is remembered per project,
 *  because it is a working habit rather than a preference about the app.
 *
 *  `edge: 'right'` measures the pane on the RIGHT of its handle instead (an
 *  editor docked right of the list, with another on the left): its share is
 *  `edgeStyle`. `min`/`max` bound the share, in percent.
 */
export function usePaneSplit(key, initial = 50, { edge = 'left', min = 20, max = 80 } = {}) {
  const [pct, setPct] = useState(() => {
    const v = Number(load(key, initial))
    return Number.isFinite(v) && v >= min && v <= max ? v : initial
  })
  const [dragging, setDragging] = useState(false)
  const box = useRef(null)
  const span = useRef(null)
  useEffect(() => { save(key, pct) }, [key, pct])
  // A drag that is still on when the handle goes leaves the page unclickable.
  useEffect(() => () => document.body.classList.remove('rl-resizing'), [])

  // Pointer capture, not window listeners: the pane next door may hold an
  // iframe (a PDF), and an iframe eats every mouse event over it — the drag
  // stopped following, and the mouseup that would have ended it never
  // arrived, so afterwards the line moved with the bare pointer.
  const onPointerDown = useCallback((e) => {
    e.preventDefault()
    const parent = box.current?.parentElement
    if (!parent) return
    span.current = parent.getBoundingClientRect()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no capture */ }
    setDragging(true)
    document.body.classList.add('rl-resizing')
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!dragging || !span.current) return
    const { left, width } = span.current
    const at = edge === 'right' ? left + width - e.clientX : e.clientX - left
    setPct(Math.min(max, Math.max(min, (at / width) * 100)))
  }, [dragging, edge, min, max])

  const stop = useCallback(() => {
    setDragging(false)
    document.body.classList.remove('rl-resizing')
  }, [])

  return {
    pct,
    reset: () => setPct(initial),
    /** on the pane that comes first */
    leftStyle: { flex: `0 0 ${pct}%`, maxWidth: `${pct}%` },
    /** on the one after the handle */
    rightStyle: { flex: '1 1 auto', minWidth: 0 },
    /** with `edge: 'right'`: on the pane after the handle, which this measures */
    edgeStyle: { flex: `0 0 ${pct}%`, maxWidth: `${pct}%` },
    /** spread onto a <div className="rl-split"> between them */
    handleProps: {
      ref: box,
      onPointerDown,
      onPointerMove,
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
      style: { touchAction: 'none' },
      onDoubleClick: () => setPct(initial),
      role: 'separator',
      title: tr("rk_drag_resize"),
      className: `rl-split${dragging ? ' on' : ''}`,
    },
  }
}

/** The three keys a rack-list service answers, wherever you are in it.
 *
 *   ⌘S / Ctrl+S   save the record you are in
 *   ⌘X / Ctrl+X   close its tab — unless there is a selection to cut, because
 *                 inside a field that is what ⌘X has always meant
 *   ⌘N / Ctrl+N   a new one of whatever this tab is about — and plain `n`
 *                 outside a field, because the browser keeps ⌘N for its own
 *                 new window and never hands it to a page
 *
 * Pass only the ones that make sense where you call it: the app knows how to
 * open and close, the editor knows how to save.
 */
export function useRackKeys({ onNew, onSave, onClose } = {}) {
  const fns = useRef({})
  fns.current = { onNew, onSave, onClose }
  useEffect(() => {
    const on = (e) => {
      const { onNew: n, onSave: s, onClose: c } = fns.current
      const el = document.activeElement
      const field = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        || el.isContentEditable)
      // Plain `n` where there is nothing to type into: ⌘N belongs to the
      // browser, which opens a window with it and tells the page nothing.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
        && (e.key === 'n' || e.key === 'N') && !field && n) {
        e.preventDefault()
        n()
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      switch (e.key.toLowerCase()) {
        case 's':
          if (!s) return
          break
        case 'x': {
          if (!c) return
          // A selection inside a field is something to cut; leave it alone.
          // An empty caret is not a selection — in a rich text editor, where
          // the caret lives in the text all the time, taking ⌘X away from the
          // whole document would mean never closing a note from the keyboard.
          const sel = el.isContentEditable ? document.getSelection() : null
          const cutting = field && (sel
            ? !sel.isCollapsed
            : el.selectionStart !== el.selectionEnd)
          if (cutting) return
          break
        }
        case 'n':
          if (!n) return
          break
        default:
          return
      }
      e.preventDefault()
      e.stopPropagation()
      const run = { s, x: c, n }[e.key.toLowerCase()]
      run?.()
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [])
}
