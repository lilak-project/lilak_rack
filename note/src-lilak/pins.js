import { projectKey, load, save } from 'racklist'

/**
 * Lines worth coming back to.
 *
 * Where a note was last READ is kept while the page lives (scrolled.js);
 * these are the lines you MEANT — the table you keep fixing, the section
 * being rewritten — and they are kept for good, in this browser. Not in the
 * note: they are one person's way through one document, not a fact about the
 * file, and a co-author who pulls the manuscript should not inherit them.
 *
 * A line NUMBER, because that is what the gutter shows and what was clicked.
 * So a paragraph added above a bookmark moves the text under it rather than
 * carrying the bookmark along.
 * ponytail: line numbers, not mapped positions — keep a position and map it
 * through the changes if the drift turns out to matter.
 *
 * The line last EDITED is always kept, bookmarks or none. A note with no
 * bookmarks shows that one instead, so the list is never empty and a note
 * reopened offers where the typing stopped; clearing the bookmarks falls back
 * to it rather than to nothing.
 */
const KEY = projectKey('nt', 'pins')
// Read once: `sawEdit` is called on the way through every keystroke that
// changes line, and parsing the whole store to find out nothing changed is
// work for no one.
let book = null
const all = () => (book ||= load(KEY, {}) || {})
const one = (id) => all()[id] || {}
const put = (id, v) => { book = { ...all(), [id]: v }; save(KEY, book) }

/** The bookmarks, in the order they were made — so the last one is the last. */
export const pinned = (id) => (one(id).lines || []).filter(Boolean)
export const lastEdit = (id) => one(id).last || 0

/** Bookmarked if it was not, un-bookmarked if it was. Answers the new list. */
export function togglePin(id, line) {
  const was = pinned(id)
  const now = was.includes(line) ? was.filter((x) => x !== line) : [...was, line]
  put(id, { ...one(id), lines: now })
  return now
}

export function clearPins(id) {
  put(id, { ...one(id), lines: [] })
  return []
}

export function sawEdit(id, line) {
  if (!line || one(id).last === line) return
  put(id, { ...one(id), last: line })
}

/** What to show: the bookmarks, or — until there are any — the line last
 *  edited, which is the bookmark the note keeps for you. */
export const marksOf = (id) => {
  const p = pinned(id)
  return p.length ? p : [lastEdit(id)].filter(Boolean)
}
