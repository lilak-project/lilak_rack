/**
 * A flow (흐름): records that follow one another — a meeting's sittings, the
 * steps of one piece of work. Each wears the flow as a tag that begins with `>`
 * (`#>AToM-X-meeting`), so the tags tab lists the flows and a note carries its
 * flow in its text like any tag; the order is their days', so nothing names a
 * next or a previous record, and putting one in or taking it out changes that
 * one alone (a sync merges it as any other edit). The mark keeps a flow apart
 * from an ordinary tag of the same word: a note tagged #meeting is not in one.
 *
 * Before 2026-11 a record held the flow as the id of its first record in its
 * `type: 'chain'` field. That is still read, so nothing falls out of its flow
 * while the data is moved; a service has flows when it declares that field.
 *
 * A record that repeats (calendar.repeat) is a flow of its own sittings, field
 * or no field; a sitting taken out of it (calendar.series) stays in its flow.
 */
import { occurrences, parseRule } from './rrule.js'

/** The field a service keeps flows in, or undefined: it has none. */
export const chainKey = (def) => def.item.fields.find((f) => f.type === 'chain')?.k
/** A flow's tag: `>` and a name. */
export const isFlowTag = (t) => /^>\S/.test(String(t ?? '').trim())
const flowTagOf = (r) => (Array.isArray(r?.tags) ? r.tags.find(isFlowTag) : '') || ''
/** Two names of one flow: a tag is the same tag whatever its case. */
export const sameFlow = (a, b) => !!a && String(a).toLowerCase() === String(b || '').toLowerCase()
/** A flow's name for a record: its label as one word (a tag holds no space). */
export const flowName = (label) => `>${String(label || '').trim().replace(/\s+/g, '-').replace(/[#.,;:!?()[\]{}'"]/g, '').replace(/^>+/, '') || 'flow'}`
/** The fields that put `r` in `flow` ('' = in none): the flow's tag among its
 *  tags, and the old field emptied — or, for a flow not yet moved to a tag
 *  (an id), that field as before. */
export function withFlow(def, r, flow) {
  const k = chainKey(def)
  const tags = (Array.isArray(r?.tags) ? r.tags : []).filter((t) => !isFlowTag(t))
  if (isFlowTag(flow)) return { tags: [...tags, String(flow).trim()], ...(k ? { [k]: '' } : {}) }
  return { tags, ...(k ? { [k]: flow || '' } : {}) }
}
/** A note's text with its flow tag set (or taken out): the `#>…` words go, and
 *  the flow's goes on the first line of nothing but tags — a new one on top when
 *  there is none. Used by note and by the records that make notes. */
export function withFlowTag(body, flow) {
  const strip = (l) => l.replace(/(^|[ \t])#>[^\s#]+/g, '$1').replace(/[ \t]{2,}/g, ' ').trimEnd()
  // A line that held only the flow goes with it.
  const lines = String(body || '').split('\n').flatMap((l) => (/#>/.test(l) ? (strip(l).trim() ? [strip(l)] : []) : [l]))
  while (lines.length && !lines[0].trim()) lines.shift()
  if (!isFlowTag(flow)) return lines.join('\n')
  const tag = `#${String(flow).trim()}`
  const tagsOnly = (l) => !!l.trim() && l.trim().split(/\s+/).every((w) => /^#[^\s#]/.test(w))
  const at = lines.findIndex(tagsOnly)
  if (at >= 0) lines[at] = `${lines[at].trimEnd()} ${tag}`
  else lines.unshift(tag, ...(lines.length ? [''] : []))
  return lines.join('\n')
}
const idOf = (def, r) => String(r?.[def.item.id || 'id'] ?? '')
const day = (v) => String(v || '').slice(0, 10)
const seriesOf = (def, r) => { const S = def.calendar?.series; return S ? String(r?.[S]?.id ?? r?.[S] ?? '') : '' }
const repeats = (def, r) => !!(def.calendar?.repeat && r?.[def.calendar.repeat]?.rule)

/** The flow a record is in, or '' (byId: id → record, for a sitting's series). */
export function flowOf(def, r, byId) {
  const k = chainKey(def)
  if (!r) return ''
  const tag = flowTagOf(r)
  if (tag) return String(tag).trim()
  if (k && r[k]) return String(r[k])
  const s = seriesOf(def, r)
  if (s) { const p = byId(s); return (p && p !== r && flowOf(def, p, byId)) || s }
  return repeats(def, r) ? idOf(def, r) : ''
}

// ponytail: a rule with no end is walked this far either side of the sitting
// you are on; widen it if someone steps further than three years in one go.
const REACH = 3 * 366
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

/** Every stop of a flow, in order: { id, occ, day } — occ is the sitting of a
 *  record that repeats ('' for one that does not). `endless`: a rule with no end
 *  is in it, so the stops are only those within reach of `near`. */
export function flowStops(def, items, flow, near) {
  const cal = def.calendar || {}
  const byId = new Map(items.map((r) => [idOf(def, r), r]))
  const taken = new Map()           // a series → the days taken out of it as records of their own
  for (const r of items) {
    const s = seriesOf(def, r)
    if (s && cal.seriesDate && r[cal.seriesDate]) taken.set(s, [...(taken.get(s) || []), day(r[cal.seriesDate])])
  }
  const out = []
  let endless = false
  for (const r of items) {
    if (!sameFlow(flowOf(def, r, (x) => byId.get(x)), flow)) continue
    const id = idOf(def, r), first = day(r[cal.start || 'start'] || r.date)
    if (!first) continue
    const key = (d) => `${d} ${cal.time?.(r) || ''} ${r.createdAt || ''} ${id}`
    if (repeats(def, r) && !seriesOf(def, r)) {
      const rp = r[cal.repeat], p = parseRule(rp.rule)
      const ends = !!(p?.until || p?.count)
      if (!ends) endless = true
      const lo = ends ? first : addDays(near || first, -REACH), hi = ends ? '9999-12-31' : addDays(near || first, REACH)
      for (const d of occurrences(first, rp.rule, lo, hi, [...(rp.ex || []), ...(taken.get(id) || [])])) {
        out.push({ id, occ: d, day: d, key: key(d) })
      }
    } else out.push({ id, occ: '', day: first, key: key(first) })
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { stops: out.map(({ key, ...s }) => s), endless }
}

/** Where a record stands in its flow: { prev, next, at, total } — total 0 when
 *  the flow has no end. A record that repeats stands on `occ`, else on its
 *  first sitting from `today` on. Null when it is in no flow. */
export function flowSteps(def, items, rec, occ = '', today = new Date().toISOString().slice(0, 10)) {
  const byId = new Map(items.map((r) => [idOf(def, r), r]))
  const flow = flowOf(def, rec, (x) => byId.get(x))
  if (!flow) return null
  const id = idOf(def, rec)
  const { stops, endless } = flowStops(def, items, flow, occ || today)
  const mine = stops.map((s, i) => [s, i]).filter(([s]) => s.id === id)
  if (!mine.length) return null
  const [, i] = mine.find(([s]) => occ && s.occ === occ) || mine.find(([s]) => !s.occ || s.day >= today) || mine[mine.length - 1]
  return { here: stops[i], prev: stops[i - 1] || null, next: stops[i + 1] || null, at: i + 1, total: endless ? 0 : stops.length }
}

/** The flow a copy of `r` (a clone, a drag-copy, a sitting taken out) goes in,
 *  and whether `r` is to be given it too: it was in one only by repeating, or
 *  in none — then the flow is a new tag named after it (`>name`, `>name-2` when
 *  that is taken). A flow not yet moved to a tag stays as it is.
 *  ponytail: a sitting taken out of a record that repeats, in no flow but its
 *  series, starts a tag of its own and leaves the series; tag the series first. */
export function flowFor(def, items, r) {
  const byId = new Map(items.map((x) => [idOf(def, x), x]))
  if (!chainKey(def)) return { flow: '', mark: false }
  const now = flowOf(def, r, (x) => byId.get(x))
  if (isFlowTag(now) || (now && r[chainKey(def)])) return { flow: now, mark: false }
  const l = def.item.label
  const base = flowName(typeof l === 'function' ? l(r) : r?.[l || 'name'] || r?.title)
  const taken = new Set(items.map(flowTagOf).filter(Boolean).map((x) => String(x).toLowerCase()))
  let flow = base
  for (let i = 2; taken.has(flow.toLowerCase()); i += 1) flow = `${base}-${i}`
  return { flow, mark: true }
}
