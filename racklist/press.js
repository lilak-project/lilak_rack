/** A button that acts when it is PRESSED.
 *
 *  The toolbox is drawn over the pane beside it, and in another service it is
 *  inside a frame inside a frame. Safari gives the first click in an unfocused
 *  frame to the frame rather than to the button, so every tool button needed
 *  pressing twice. `pointerdown` arrives either way; `preventDefault` keeps
 *  the focus (and the editor's selection) where it was, which is what a
 *  formatting button wanted anyway.
 *
 *  The click is then dead weight — except from the KEYBOARD, where there is no
 *  pointer and `detail` is 0. So both are bound, and exactly one fires.
 *
 *      <button type="button" {...press(() => edit.put('x'))}>
 */
export const press = (fn) => ({
  onPointerDown: (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    fn()
  },
  onClick: (e) => { if (e.detail === 0) fn() },
})
