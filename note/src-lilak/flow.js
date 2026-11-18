import { flowOf, flowFor, flowSteps, sameFlow } from 'racklist'

/** Notes follow on in a flow (흐름) the way activities do (racklist chain.js):
 *  the flow is a tag in the text, `#>AToM-X-meeting` (or, from before, the
 *  front matter's `chain`), the order the notes' dates. A note made for an
 *  activity carries that activity's flow, so the two step alike; a flow of
 *  notes alone is named after the note it started from. */
export const FLOW = { item: { id: 'id', label: 'title', fields: [{ k: 'chain', type: 'chain' }] }, calendar: { start: 'date' } }
/** The `#>name` words in a text, as tags (`>name`). */
const flowTagsIn = (body) => [...String(body || '').matchAll(/(?:^|[\s(])#(>[^\s#.,;:!?()[\]{}'"]+)/g)].map((m) => m[1])

/** The list's notes as a flow reads them — `here` (the note being edited) as
 *  the editor has it now, not as it was last saved. */
export const flowItems = (notes, here) => (notes || []).map((n) => {
  const x = here && n.id === here.id ? here : n
  return { id: x.id, date: x.date, title: x.title, chain: x.fields?.chain || '',
    tags: x === here ? flowTagsIn(here.body) : (x.tags || []).map((t) => String(t)) }
})
const find = (items, id) => items.find((x) => x.id === id)
export const noteSteps = (items, id) => (find(items, id) ? flowSteps(FLOW, items, find(items, id)) : null)
/** The notes of `id`'s flow, in order (itself among them), or []. */
export function noteFlow(items, id) {
  const by = (x) => find(items, x)
  const flow = flowOf(FLOW, find(items, id), by)
  return !flow ? [] : items.filter((x) => sameFlow(flowOf(FLOW, x, by), flow))
    .sort((a, b) => `${a.date} ${a.id}`.localeCompare(`${b.date} ${b.id}`))
}
/** The flow a note joining `t`'s goes in, and whether `t` is to be given it. */
export const joinFlow = (items, t) => flowFor(FLOW, items, t)
