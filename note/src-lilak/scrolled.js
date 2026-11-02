/** Where a note was being read, kept while the page lives.
 *
 *  Moving a pane to the other side of the list — or to the whole width
 *  (racklist panes.jsx) — draws the editor in another slot of the body, and
 *  React builds it again rather than carrying it across. Everything the note
 *  IS survives that (it is re-read from the server, and anything unsaved is
 *  written on the way out); where you were READING does not, and a manuscript
 *  is long enough that landing back on line 1 is the whole annoyance.
 *
 *  So the place is remembered against the NOTE, not the element: whichever box
 *  comes back for that note goes to where the last one stood. What a place is
 *  belongs to the box — the editor keeps a position in the text, because the
 *  pane it reappears in is a different width and the same pixel is a different
 *  line; the reading sheet keeps its pixels. Nothing is stored: reopening the
 *  service starts at the top, as it always did.
 */
const AT = new Map()

export const placeSave = (key, at) => { if (key && at != null) AT.set(key, at) }
export const placeBack = (key) => AT.get(key)
