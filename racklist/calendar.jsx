import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { typeOf } from './types.jsx'
import { ctxFor, labelOf, valueOf, favField } from './schema.js'
import { tagKey, tagWithin, nameKey, useProjects, projectWears, useAuthors } from './tags.js'
import { load, save, projectKey } from './portal.js'
import { occurrences, DAYS, dow } from './rrule.js'

/**
 * [달력] — records with dates, the way Apple's Calendar shows a month: a row
 * per week, a bar per record. The weeks are one stack you scroll, a week at a
 * time; the title says the month on screen. Declared on the service:
 *
 *   calendar: {
 *     start: 'start', end: 'end',            // the record's own days
 *     mark: 'talkDate',                       // its one day that matters most
 *     outline: { start: 'tripStart', end: 'tripEnd' },   // the days around it
 *     groups: [{ label, color, match: (rec) => bool }],  // colours, and the legend
 *     label: (rec, text) => string,           // text(k) is field k as the table says it
 *     time: 'startTime',                      // or (rec) => 'HH:MM': a day's order in a group
 *   }
 *
 * One bar: the days around (the trip) light gray, the record's own days light
 * in its colour, the marked day banded below. A week has room for two lanes at
 * least and is as tall as its records need — nothing folds into "…"; a bar
 * with nothing under it grows down into the free lanes, its name wrapping onto
 * as many lines as it then has; a todo whose name is longer than its bar moves
 * the todos under it down, while free lanes are left; a bar stacked from the
 * bottom grows up, moving those over it up. A name may run on over the days to
 * its right instead: each week takes what cuts the fewest names (see arrange). A record without a start is not on it.
 *
 * The week mode folds each week, Monday to Sunday, into two rows of four cells:
 * the week's own (which week of which month, and how many of each kind), Mon
 * Tue Wed / Thu Fri Sat Sun. The days are wider, so a bar there takes only the
 * lanes its name needs.
 *
 * The MWD mode is the month's stack with Monday to Friday only. A record wholly
 * on a weekend is not drawn there; one running over a weekend is cut as at a
 * week's end.
 *
 *   left-click a bar        picks it (as in the table)
 *   right-click a bar       opens it in the editor
 *   hover half a second     what the editor shows, in a small box
 *   drag a bar's end        moves the start or the end
 *   click or drag days      lights them, and they stay lit
 *   right-click lit days    a new record over them (right-click any other
 *                           day: a new record starting that day)
 */
const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '')
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d) }
const diff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000)
const min = (...xs) => xs.filter(Boolean).sort()[0]
const max = (...xs) => xs.filter(Boolean).sort().at(-1)
const sunday = (s) => addDays(s, -parse(s).getDay())
const monday = (s) => addDays(s, -((parse(s).getDay() + 6) % 7))
const monthOf = (s) => s.slice(0, 7)
/** The Thursday of the week a row is in; a week belongs to its Thursday's month. */
const thursdayOf = (s, week) => (week ? addDays(monday(s), 3) : addDays(sunday(s), 4))
/** Which week of which month a week is, by its Thursday: [month, nth]. */
export const weekOfMonth = (s) => { const t = addDays(monday(s), 3); return [Number(t.slice(5, 7)), Math.ceil(Number(t.slice(8)) / 7)] }
/** The day that names its month: the 1st — or, with no weekends drawn, the Monday after a 1st on one. */
export const opensMonth = (s, noWeekend) => s.slice(8) === '01' || (noWeekend && parse(s).getDay() === 1 && Number(s.slice(8)) <= 3)
/** What moves down a lane to give a bar one more, in a week of `total` lanes: what is
 *  under it, and what is under that — null if that runs out of lanes or meets anything but a todo. */
export const toShove = (placed, s, total) => {
  const moved = new Set()
  const under = (x) => placed.every((y) => {
    if (y.lane !== x.lane + x.rows || y.b < x.a || y.a > x.b || moved.has(y)) return true
    if (typeof y.ev.ext?.done !== 'boolean' || y.lane + y.rows >= total) return false
    moved.add(y)
    return under(y)
  })
  return under(s) ? [...moved] : null
}
/** What moves up a lane to give a bar stacked from the bottom one more: what is over
 *  it, and what is over that — null if that runs out of lanes or meets anything not so stacked. */
export const toLift = (placed, s) => {
  const moved = new Set()
  const over = (x) => placed.every((y) => {
    if (y.lane + y.rows !== x.lane || y.b < x.a || y.a > x.b || moved.has(y)) return true
    if (!y.ev.low || y.lane === 0) return false
    moved.add(y)
    return over(y)
  })
  return over(s) ? [...moved] : null
}
/** A bar takes the lanes above it until its name fits. */
export const growUp = (placed, s, ownFits) => {
  while (s.lane > 0 && !ownFits(s)) {
    const moved = toLift(placed, s)
    if (!moved) return
    for (const x of moved) x.lane -= 1
    s.lane -= 1
    s.rows += 1
  }
}
const clearBelow = (taken, s) => taken[s.lane + s.rows].every(([x, y]) => s.b < x || s.a > y)
/** The widest week's bars whose name is too long for them that are tried both ways: 2^this layouts. */
const TRIED = 8
/** The lanes of a week's bars. A bar whose name is too long for it can take more lanes
 *  (to the point its name fits) or leave it to run on over the free days to its right, and
 *  either may cut another's name: of all those choices, the one that cuts the fewest names,
 *  then runs on the fewest, then takes the fewest lanes. What `fills` says then takes the
 *  free lanes below as well, while that cuts no name. Sets each bar's lane, rows and free.
 *  fits(s, days): does its name fit in its lanes and so many days to its right.
 *  s.ends: it ends in this week, so its name may run on. */
export const arrange = (placed, total, count, fits, fills, measured = true) => {
  const base = placed.map((s) => s.lane)
  const taken = Array.from({ length: total }, () => [])
  const clear = (used, d) => used.every(([x, y]) => d < x || d > y)
  const retake = () => {
    taken.forEach((used) => { used.length = 0 })
    for (const x of placed) for (let r = x.lane; r < x.lane + x.rows; r++) taken[r].push([x.a, x.b])
  }
  const freeOf = (s) => {
    let free = 0
    if (!s.ends) return 0
    while (s.b + free < count - 1 && taken.slice(s.lane, s.lane + s.rows).every((used) => clear(used, s.b + free + 1))) free += 1
    return free
  }
  const ownFits = (s) => fits(s, 0)
  const whole = (s) => fits(s, freeOf(s))
  const byLane = (list) => [...list].sort((x, y) => x.lane - y.lane)
  const start = () => {
    placed.forEach((s, i) => { s.lane = base[i]; s.rows = 1 })
    retake()
  }
  // Each takes the lanes below, moving the todos in them down if it is a todo itself;
  // what stacks from the bottom takes those above, moving what stacks over it up.
  const lay = (chosen) => {
    start()
    for (const s of byLane(chosen)) {
      while (s.lane + s.rows < total && !ownFits(s)) {
        const open = clearBelow(taken, s)
        const moved = open ? [] : typeof s.ev.ext?.done === 'boolean' ? toShove(placed, s, total) : null
        if (!(open || moved?.length)) break
        s.rows += 1
        for (const x of moved) x.lane += 1
        retake()
      }
    }
    for (const s of byLane(chosen.filter((x) => x.ev.low))) growUp(placed, s, ownFits)
    retake()
  }
  const cost = () => placed.reduce((n, s) => n + (ownFits(s) ? 0 : whole(s) ? 1e3 : 1e6) + s.rows, 0)
  start()
  const long = byLane(placed.filter((s) => !ownFits(s)))
  // ponytail: a week with more of them than this has the rest always take lanes.
  const tried = long.slice(0, TRIED), rest = long.slice(TRIED)
  let best = long, least = Infinity
  for (let m = (1 << tried.length) - 1; m >= 0; m--) {
    const chosen = [...tried.filter((_, i) => m >> i & 1), ...rest]
    lay(chosen)
    const c = cost()
    if (c < least) { least = c; best = chosen }
  }
  lay(best)
  for (const s of byLane(placed.filter(fills))) {
    while (s.lane + s.rows < total && clearBelow(taken, s)) {
      const kept = placed.filter((x) => x !== s && whole(x))
      s.rows += 1
      retake()
      if (kept.every(whole)) continue
      s.rows -= 1
      retake()
      break
    }
  }
  // A name its lanes hold stays in them; only one they do not runs on.
  for (const s of placed) s.free = measured && ownFits(s) ? 0 : freeOf(s)
}
const shortDay = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`
/** 'YYYY-MM' as the month's short name: Sep, 9월. */
const monthName = (ym) => tr('rk_month_short', Number(ym.slice(5, 7)))
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const GRAY = '#8a94a6'
// Further than this many weeks, going to a day is a jump, not a scroll through them all.
const FAR = 80
// The space between a week's lanes — wider in a week a handed-in line runs from.
const GAP = { base: 2, wide: 6 }
// How many weeks are drawn around what is on screen, and how many more are
// added when the scroll nears an end.
const BEFORE = 10
const AFTER = 30
const MORE = 16
const LANES = 2        // a week's room, at least, in lanes of 22px
const OPEN = 280       // ms: weeks opening up, bars sliding to their places
const UNROLL = 400     // ms: then a new bar unrolling from the left
const FOLD = 260       // ms: before all that, a bar going rolling up to its left end
const NONE = []

// A name's width as a bar draws it (--fs-small), with its padding and room for
// a mark before it (☐, ↻, the handed-in file).
let pen
const widths = new Map()
const widthOf = (t) => {
  const key = document.fonts.status + t
  if (!widths.has(key)) {
    pen ||= document.createElement('canvas').getContext('2d')
    pen.font = `12px ${getComputedStyle(document.body).fontFamily}`
    widths.set(key, pen.measureText(t).width)
  }
  return widths.get(key)
}
const textW = (t) => widthOf(t || '') + 14 + 16
// The room the marks before a name take: its box, ↻ or the handed-in file, then the camera.
const markW = (s) => (typeof s.ev.ext?.done === 'boolean' || s.ev.occ || s.p.key === 'submit' ? 16 : 0) + (s.ev.online && s.p.key !== 'submit' ? 16 : 0)
const arranged = new Map()
// The lines a name wraps to in that width, broken at its spaces, after its mark.
const linesOf = (t, w, mark) => {
  let lines = 1, x = mark
  for (const word of (t || '').split(/(?<= )/)) {
    const m = widthOf(word)
    if (x + m > w) { lines += 1; x = 0 }
    lines += Math.floor(m / w)
    x += m % w
  }
  return lines
}

// Where each calendar was scrolled to, for as long as the page around it
// lives. The portal frames one service at a time and loads it afresh on the
// way back, so this rides on the portal's own window (the same origin): back
// from another service, the calendar is where it was; opened anew, or after a
// reload — of the portal or of this frame alone — it starts at today. A page
// of its own keeps it on its own window.
const kept = () => { try { return (window.top.__rackCal ||= {}) } catch { return (window.__rackCal ||= {}) } }
const reloaded = () => performance.getEntriesByType?.('navigation')[0]?.type === 'reload'

export function RackCalendar({ def, doc, items, query, ctx, picked, onPick, onOpen, onNew, onResize, onCopy, onOccurrence, at }) {
  const cal = def.calendar
  const idk = def.item.id || 'id'
  const today = fmt(new Date())
  // A month's worth of weeks on screen, the same without weekends, or a week folded into two rows.
  const [mode, setMode] = useState(() => load(projectKey(def.key, 'calmode'), 'month'))
  const week = mode === 'week', mwd = mode === 'mwd'
  const mondays = week || mwd
  const startOf = mondays ? monday : sunday
  const viewKey = projectKey(def.key, week ? 'calatw' : mwd ? 'calatd' : 'calat')
  // { week, off }: the row at the top of the view and how far into it — or, the first time, today.
  const [was] = useState(() => (reloaded() ? null : kept()[viewKey] || null))
  const [month, setMonth] = useState(() => monthOf(was ? thursdayOf(was.week, mondays) : today))     // the month on screen
  const [hidden, setHidden] = useState(() => new Set(load(projectKey(def.key, 'calhide'), [])))
  useEffect(() => { save(projectKey(def.key, 'calhide'), [...hidden]) }, [def.key, hidden])
  // The lines from a handed-in day to its talk: drawn, or not.
  const [showLinks, setShowLinks] = useState(() => load(projectKey(def.key, 'callinks'), true))
  useEffect(() => { save(projectKey(def.key, 'callinks'), showLinks) }, [def.key, showLinks])
  // Tags and projects (+name, project_manager's: a set of tags, any or all) to
  // show only: a record wearing any tag chosen, or in any project chosen
  // (another calendar's item: by the #tags in its title). None chosen: everything.
  const [tagSel, setTagSel] = useState(() => new Set(load(projectKey(def.key, 'caltags'), [])))
  useEffect(() => { save(projectKey(def.key, 'caltags'), [...tagSel]) }, [def.key, tagSel])
  const tagF = favField(def)
  const tagsOf = (r) => (Array.isArray(r?.[tagF]) ? r[tagF] : String(r?.[tagF] || '').split(/[\s,]+/)).filter(Boolean)
  const projects = useProjects()
  const projOf = (k) => projects.find((p) => `+${tagKey(p.name)}` === k)
  // The people a record links to (`calendar.people`: the field that does —
  // 책임자). A person is one chip whichever of their names it was written from,
  // because a name is a person's key here (tags.js nameKey).
  const people = useAuthors()
  const whoOf = useCallback((r) => (!cal.people ? [] : [].concat(r?.[cal.people] || [])
    .map((l) => (l?.id ? people.find((x) => x.id === l.id) : null)).filter(Boolean)),
    [cal.people, people])
  const whoIs = (k) => people.find((x) => x.keys.includes(k.slice(1)))
  const tagged = (ts, r) => !tagSel.size || [...tagSel].some((k) => (k.startsWith('+')
    ? !!projOf(k) && projectWears(projOf(k), ts)
    : k.startsWith('@') ? whoOf(r).some((x) => x.keys.includes(k.slice(1)))
      : ts.some((t) => tagWithin(t, k))))
  // Every tag the records wear, most worn first, spelt as most often written.
  const allTags = useMemo(() => {
    const n = new Map()
    for (const r of items) for (const t of tagsOf(r)) { const k = tagKey(t); const x = n.get(k) || { t, n: 0 }; x.n++; n.set(k, x) }
    return [...n.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, x]) => ({ k, t: x.t, n: x.n }))
  }, [items])   // eslint-disable-line react-hooks/exhaustive-deps
  // Only the people these records actually name: a hundred who lead nothing is
  // not a list to pick from.
  const allPeople = useMemo(() => {
    const n = new Map()
    for (const r of items) for (const x of whoOf(r)) { const e = n.get(x.id) || { x, n: 0 }; e.n++; n.set(x.id, e) }
    return [...n.values()].sort((a, b) => b.n - a.n)
  }, [items, whoOf])
  const [tagIn, setTagIn] = useState('')
  const addTag = (v) => {
    const raw = String(v).trim()
    // #tag, +project, @person: the sign says which.
    const k = raw.startsWith('+') ? `+${tagKey(raw.slice(1))}`
      : raw.startsWith('@') ? `@${nameKey(raw.slice(1))}`
        : raw.startsWith('#') ? tagKey(raw.slice(1)) : ''
    if (!k || k === '@' || !(k.startsWith('+') ? projOf(k)
      : k.startsWith('@') ? whoIs(k) : allTags.some((x) => x.k === k))) return false
    setTagSel((s) => new Set([...s, k])); setTagIn(''); return true
  }

  // The weeks drawn: [first, count]. Grows at either end as you scroll there.
  const [span, setSpan] = useState(() => [addDays(startOf(was ? was.week : today), -7 * BEFORE), BEFORE + AFTER])
  const weeks = useMemo(() => Array.from({ length: span[1] }, (_, i) => addDays(span[0], 7 * i)), [span])
  // What is drawn, one under another: a week, or its two rows (the first with
  // the week's own cell before its days).
  const rows = useMemo(() => (week
    ? weeks.flatMap((ws) => [{ ws, n: 3, lead: 1 }, { ws: addDays(ws, 3), n: 4, lead: 0 }])
    : weeks.map((ws) => ({ ws, n: mwd ? 5 : 7, lead: 0 }))), [weeks, week, mwd])

  const textOf = (r, k) => {
    const f = def.item.fields.find((x) => x.k === k)
    if (!f) return String(r?.[k] ?? '')
    const c = ctxFor(def, doc, f, ctx)
    return typeOf(f).text(valueOf(f, r, c), c)
  }
  const groupOf = (r) => cal.groups?.findIndex((g) => g.match(r)) ?? -1
  const [over, setOver] = useState(null)        // a bar's end being dragged: { id, start, end }
  const [sweep, setSweep] = useState(null)      // days lit by a click or a drag: { from, to }
  const [shown, setShown] = useState('')        // the day last asked for: its number painted, as today's is
  const [copying, setCopying] = useState(null)  // a copy being carried: { id, days } later

  // One record as drawn — or, `shift` days later, the copy of it being carried
  // or (with `occ`) one occurrence of a record that repeats.
  const build = (r, shift = 0, occ = '') => {
    const id = r[idk]
    const o = over?.id === id ? over : null
    const at = (d) => (d && shift ? addDays(d, shift) : d)
    // The day it was handed in (calendar.submit) — drawn on its own when it is
    // apart from the rest, and the start when there is nothing else.
    const sb = at(cal.submit ? day(r[cal.submit]) : '')
    const s = o ? at(o.start) : at(day(r[cal.start])) || sb
    if (!s) return null
    let e = o ? at(o.end) : at(day(r[cal.end])) || s     // no end: the (already moved) start — not moved twice
    if (e < s) e = s
    // Taken part in from afar (calendar.online): there was no trip to draw.
    const online = !!cal.online?.(r)
    const ts = at(cal.outline && !online ? day(r[cal.outline.start]) : '')
    let te = ts ? at(day(r[cal.outline.end])) || ts : ''
    if (te < ts) te = ts
    const mk = at(cal.mark ? day(r[cal.mark]) : '')
    const g = groupOf(r)
    if (hidden.has(g) || !tagged(tagsOf(r), r)) return null
    const ev = { r, id: occ ? `${id}@${occ}` : shift ? `${id}:copy` : id, copy: !!shift && !occ, occ, base: id, s, e, ts, te, mk, sb, to: mk || s, color: g >= 0 ? cal.groups[g].color : GRAY, paper: g >= 0 && !!cal.groups[g].paper, framed: g >= 0 && !!cal.groups[g].framed, g, low: (g >= 0 && Number(cal.groups[g].bottom)) || 0, hatch: !!cal.hatch?.(r), online,
      // Its time of day ('HH:MM', calendar.time: a field or (rec) => …): the
      // order records of one group take on one day.
      time: String((typeof cal.time === 'function' ? cal.time(r) : r[cal.time]) || ''),
      label: cal.label ? cal.label(r, (k) => textOf(r, k)) : labelOf(def, r) }
    // What is drawn: the record's days, joined to the trip when the two touch;
    // a trip or a marked day that does not touch them is a piece of its own on
    // its own days — never a bar bridging the weeks between.
    const touches = (a, b) => a && b && a <= addDays(e, 1) && b >= addDays(s, -1)
    ev.joined = !!touches(ts, te)
    const main = ev.joined ? { from: min(s, ts), to: max(e, te) } : { from: s, to: e }
    ev.pieces = [{ key: 'main', ...main }]
    if (ts && !touches(ts, te)) ev.pieces.push({ key: 'trip', from: ts, to: te })
    if (mk && (mk < main.from || mk > main.to)) ev.pieces.push({ key: 'mark', from: mk, to: mk })
    if (sb && (sb < main.from || sb > main.to) && sb !== mk) ev.pieces.push({ key: 'submit', from: sb, to: sb })
    return ev
  }
  // Other calendars, shown read only (calendar.overlay: () => Promise<[{ id,
  // feed, color, title, start, end, time, location }]>, or a list of such
  // promises): drawn, never edited.
  // An item may also carry done (a box to tick), toggle(done) → ok and
  // open(ctx) — a todo kept elsewhere, ticked or opened from here — and urgent.
  const [ext, setExt] = useState([])
  const [carried, setCarried] = useState(null)  // a feed's item on its way to another day: { id, day }
  useEffect(() => {
    if (!cal.overlay) return undefined
    let on = true
    // Several feeds draw as each arrives: one slow (Google) holds none of the others up.
    const feeds = [].concat(cal.overlay())
    const got = feeds.map(() => [])
    feeds.forEach((p, i) => Promise.resolve(p).then((x) => {
      if (!on) return
      got[i] = Array.isArray(x) ? x : []
      setExt(got.flat())
    }).catch(() => {}))
    return () => { on = false }
  }, [cal])
  const feeds = useMemo(() => [...new Map(ext.map((x) => [x.feed, x.color])).entries()], [ext])
  const events = useMemo(() => {
    // A record that repeats (calendar.repeat: { rule, ex }) is drawn on each of
    // its days in the weeks drawn — but not on a day that has a record of its
    // own (one occurrence changed: calendar.series → it, calendar.seriesDate).
    const lo = addDays(weeks[0], -62), hi = addDays(weeks[weeks.length - 1], 6)
    const own = new Map()
    if (cal.series) {
      for (const r of items) {
        const s = r[cal.series]?.id ?? r[cal.series]
        if (s && r[cal.seriesDate]) own.set(String(s), [...(own.get(String(s)) || []), String(r[cal.seriesDate]).slice(0, 10)])
      }
    }
    const out = []
    for (const r of items) {
      const rp = cal.repeat ? r[cal.repeat] : null
      const first = day(r[cal.start])
      if (rp?.rule && first && !(cal.series && (r[cal.series]?.id ?? r[cal.series]))) {
        for (const d of occurrences(first, rp.rule, lo, hi, [...(rp.ex || []), ...(own.get(String(r[idk])) || [])])) {
          const ev = build(r, diff(first, d), d)
          if (ev) out.push(ev)
        }
      } else {
        const ev = build(r)
        if (ev) out.push(ev)
      }
    }
    if (!query) {
      for (const x of ext) {
        if (!x.start || hidden.has(`feed:${x.feed}`) || !tagged((x.title || '').match(/#[^\s#]+/g)?.map((t) => t.slice(1)) || [])) continue
        const s = carried?.id === x.id ? carried.day : x.start
        const e = x.end && x.end >= s ? x.end : s
        out.push({ r: { name: x.title }, id: `ext:${x.id}`, ext: x, s, e, ts: '', te: '', mk: '', sb: '', to: s,
          color: x.color || GRAY, g: -1, low: 0, label: x.time ? `${x.title} (${x.time})` : x.title,
          pieces: [{ key: 'main', from: s, to: e }] })
      }
    }
    const r = copying && items.find((x) => x[idk] === copying.id)
    const c = r && build(r, copying.days)
    if (c) out.push(c)
    return out
  }, [items, over, hidden, tagSel, projects, people, doc, copying, ext, carried, query, weeks])   // eslint-disable-line react-hooks/exhaustive-deps
  // The days a carried copy would land on, lit.
  const drop = events.find((ev) => ev.copy)?.pieces[0]
  const inDrop = (d) => drop && d >= drop.from && d <= drop.to

  // While searching: the months that have something found, to step between.
  const found = useMemo(() => (query ? [...new Set(events.map((ev) => monthOf(ev.s)))].sort() : []), [events, query])
  const prevFound = found.filter((m) => m < month).at(-1)
  const nextFound = found.find((m) => m > month)
  // To a month with something found: its first find, in the middle.
  const toFound = (m) => goTo(m, events.filter((ev) => monthOf(ev.s) === m).map((ev) => ev.s).sort()[0], true)

  // ── scrolling ───────────────────────────────────────────────────────────
  const body = useRef(null)
  // A day's width, and a name's in the bars' type: how far a name runs on.
  const [bodyW, setBodyW] = useState(0)
  const dayW = bodyW / (week ? 4 : mwd ? 5 : 7)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return undefined
    const fit = () => setBodyW(el.clientWidth)
    fit()                                       // now, before the first paint
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The week to bring into view after the next draw: at the top or in the
  // middle, scrolled to or (the first time, or from far away) simply shown.
  const goal = useRef(was ? { w: was.week, off: was.off, smooth: false } : { w: startOf(today), center: true, smooth: false })
  const keep = useRef(null)                     // weeks added above: keep what is on screen still
  // Where it opened (today's week in the middle, or where it was left), held
  // there while the records come in — however many times, and however late
  // (todos, Google's) — until the person moves it themselves.
  const opened = useRef(goal.current)
  useEffect(() => {
    const el = body.current
    if (!el) return undefined
    const off = () => { opened.current = null; heading.current = null }
    const evs = ['wheel', 'pointerdown', 'touchstart', 'keydown']
    evs.forEach((t) => el.addEventListener(t, off, { passive: true }))
    const arrived = () => { heading.current = null }
    el.addEventListener('scrollend', arrived)
    return () => { evs.forEach((t) => el.removeEventListener(t, off)); el.removeEventListener('scrollend', arrived) }
  }, [])
  // The month a goTo is scrolling to: the title says it all the way there,
  // not the months the scroll passes through on the way.
  const heading = useRef(null)
  // A week's height: in the week mode, its two rows.
  const tallOf = (w) => w.offsetHeight + (week ? w.nextElementSibling?.offsetHeight || 0 : 0)
  const place = (el, g) => {
    const w = el.querySelector(`[data-week="${g.w}"]`)
    if (!w) return
    const top = g.center ? w.offsetTop + tallOf(w) / 2 - el.clientHeight / 2 : w.offsetTop + (g.off || 0)
    if (g.smooth) el.scrollTo({ top, behavior: 'smooth' })
    else el.scrollTop = top
  }
  // To a month (its first week at the top) — or to a day, in the middle. The
  // weeks between are drawn first, so the way there is scrolled through;
  // further than FAR weeks it is a jump instead.
  const goTo = useCallback((ym, at = `${ym}-01`, center = false) => {
    const w = startOf(at)
    opened.current = null
    goal.current = { w, center, smooth: true }
    heading.current = ym
    setSpan(([a, n]) => {
      const last = addDays(a, 7 * (n - 1))
      if (w >= a && w <= last) return [a, n]
      if ((w < a ? diff(w, a) : diff(last, w)) / 7 > FAR) {
        goal.current = { w, center, smooth: false }
        return [addDays(w, -7 * BEFORE), BEFORE + AFTER]
      }
      if (w < a) {
        keep.current = body.current?.scrollHeight ?? null
        const from = addDays(w, -7 * BEFORE)
        return [from, n + diff(from, a) / 7]
      }
      return [a, diff(a, w) / 7 + 1 + BEFORE]
    })
    setMonth(ym)
  }, [startOf])
  // The other mode: at the week in the middle of the screen, in the middle.
  const switchMode = (m) => {
    if (m === mode) return
    const el = body.current
    const y = el ? el.scrollTop + el.clientHeight / 2 : 0
    const row = el && [...el.querySelectorAll('[data-week]')].find((w) => w.offsetTop + w.offsetHeight > y)
    const thu = row ? thursdayOf(row.dataset.week, mondays) : today
    const w = (m === 'month' ? sunday : monday)(thu)
    save(projectKey(def.key, 'calmode'), m)
    setMode(m)
    heading.current = monthOf(thu)
    setMonth(monthOf(thu))
    goal.current = opened.current = { w, center: true, smooth: false }
    setSpan([addDays(w, -7 * BEFORE), BEFORE + AFTER])
  }
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    if (keep.current != null) {
      el.scrollTop += el.scrollHeight - keep.current
      keep.current = null
    }
    const g = goal.current
    if (!g) return
    goal.current = null
    place(el, g)
  }, [span])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── moving, not jumping ─────────────────────────────────────────────────
  // The calendar opens empty and the records come in after; and whenever they
  // change (a group shown, a todo arriving) the weeks are not redrawn at
  // once: the bars going roll up to their left ends, a week that needs more
  // lanes (or fewer) opens up (or closes), the bars staying slide to their
  // new places, and then the new ones unroll from the left with their names.
  // All the while the week line nearest the middle of the screen stays where
  // it is — what grows above it grows upwards.
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 60); return () => clearTimeout(t) }, [])
  const shownEvents = drawn ? events : NONE
  const flip = useRef(null)                     // the last layout: weeks, bars, big numbers
  const moving = useRef([])                     // the animations under way
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    // Changed again while still moving: go on from the weeks as they are on
    // screen now, not from where the last change was going to leave them.
    const live = moving.current.some((a) => a.playState === 'running' || a.playState === 'pending')
      && new Map([...el.querySelectorAll('.rl-cal-week')].map((w) => [w.dataset.week, { top: w.offsetTop, h: w.offsetHeight }]))
    const st = el.scrollTop
    moving.current.forEach((a) => a.cancel())
    moving.current = []
    const now = {
      span, dayW, drawn,
      weeks: new Map([...el.querySelectorAll('.rl-cal-week')].map((w) => [w.dataset.week, { el: w, top: w.offsetTop, h: w.offsetHeight }])),
      bars: new Map([...el.querySelectorAll('.rl-cal-bar[data-ev]')].map((b) => [`${b.closest('.rl-cal-week').dataset.week}|${b.dataset.ev}|${b.dataset.piece}`, { el: b, x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight }])),
      bigs: new Map([...el.querySelectorAll('[data-big]')].map((n) => [n.dataset.big, n])),
    }
    const before = flip.current
    flip.current = now
    // The week it opened to, while it is still held: in the middle once it
    // has opened, or where it was left. Otherwise (below) the week line
    // nearest the middle.
    let anchor = null, at = 0
    if (opened.current && now.weeks.has(opened.current.w)) {
      anchor = { w: opened.current.w }
      at = opened.current.center ? Math.max(0, (el.clientHeight - tallOf(now.weeks.get(anchor.w).el)) / 2) : -opened.current.off
    }
    // Scrolling for more weeks, a new width, a drag under way, or asked for
    // no motion: simply drawn (the week opened to still where it belongs).
    if (!before || before.span !== span || before.dayW !== dayW || drag.current || copying
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (anchor) el.scrollTop = now.weeks.get(anchor.w).el.offsetTop - at
      return
    }
    if (!anchor) {
      const mid = st + el.clientHeight / 2
      for (const [w, r] of live || before.weeks) if (!anchor || Math.abs(r.top - mid) < Math.abs(anchor.top - mid)) anchor = { w, top: r.top }
      at = anchor && anchor.top - st
    }
    const go = (node, frames, opts) => { const a = node.animate(frames, { easing: 'cubic-bezier(.2,.7,.3,1)', ...opts }); moving.current.push(a); return a }
    // The bars going: a copy of each where it was, rolled up, then gone.
    let first = 0
    for (const [k, o] of before.bars) {
      const into = !now.bars.has(k) && now.weeks.get(k.split('|')[0])?.el.querySelector('.rl-cal-events')
      if (!into) continue
      const g = o.el.cloneNode(true)
      // (Out of the grid: a grid's absolute child placed in a cell is placed from that cell.)
      Object.assign(g.style, { position: 'absolute', gridRow: 'auto', gridColumn: 'auto', left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, margin: 0, pointerEvents: 'none' })
      into.appendChild(g)
      const a = go(g, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 100% 0 0)' }], { duration: FOLD, fill: 'forwards' })
      a.onfinish = a.oncancel = () => g.remove()
      first = FOLD
    }
    const opening = []
    for (const [w, r] of now.weeks) {
      const o = (live || before.weeks).get(w)
      if (!o || o.h === r.h) continue
      r.el.style.overflow = 'clip'
      const a = go(r.el, [{ height: `${o.h}px` }, { height: `${r.h}px` }], { duration: OPEN, delay: first, fill: 'backwards' })
      a.onfinish = a.oncancel = () => { r.el.style.overflow = '' }
      opening.push(a)
    }
    const later = first + (opening.length ? OPEN : 0)
    for (const [k, b] of now.bars) {
      const o = before.bars.get(k)
      if (!o) go(b.el, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: UNROLL, delay: later, fill: 'backwards' })
      else if (o.x !== b.x || o.y !== b.y) go(b.el, [{ transform: `translate(${o.x - b.x}px, ${o.y - b.y}px)` }, { transform: 'none' }], { duration: OPEN, delay: first, fill: 'backwards' })
    }
    for (const [d, n] of now.bigs) if (!before.bigs.has(d)) go(n, [{ opacity: 0 }, { opacity: 1 }], { duration: UNROLL, delay: later, fill: 'backwards' })
    // Settled: the weeks before and after it are looked at again (see onScroll),
    // and the lines drawn again — they were placed from where everything was
    // when it set off, and appear only now.
    const all = moving.current.slice()
    if (all.length) Promise.all(all.map((x) => x.finished)).then(() => { onScroll(); relayout((n) => n + 1) }, () => {})
    if (links.current && all.length) go(links.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: later + UNROLL, fill: 'backwards' })
    // Hold the line while the weeks open — every frame until they have, and
    // once more at the end (a slow first frame starts them late).
    const line = anchor && now.weeks.get(anchor.w)?.el
    if (!opening.length || !line) return
    const hold = () => { el.scrollTop = line.offsetTop - at }
    const open = () => opening.some((a) => a.playState === 'running' || a.playState === 'pending')
    const tick = () => { hold(); if (open()) requestAnimationFrame(tick) }
    tick()
    Promise.all(opening.map((a) => a.finished)).then(hold, () => {})
  }, [shownEvents, span, dayW])   // eslint-disable-line react-hooks/exhaustive-deps
  // Today's week, in the middle.
  const toToday = () => { setShown(''); goTo(monthOf(today), today, true) }
  // Asked to show a day (a date's label pressed in an editor): its week in
  // the middle, the day lit, and its number painted until the next ask. An
  // ask may bring the filter too (`tags`: a project's "show in calendar").
  useEffect(() => {
    if (!at?.d) return
    if (at.tags) setTagSel(new Set(at.tags))
    goTo(monthOf(at.d), at.d, true)
    setSweep({ from: at.d, to: at.d })
    setShown(at.d)
  }, [at])   // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = body.current
    if (!el) return
    // The month on screen: the one a week a third of the way down is in.
    const y = el.scrollTop + el.clientHeight / 3
    const ws = [...el.querySelectorAll('[data-week]')].find((w) => w.offsetTop + w.offsetHeight > y)
    // A week belongs to the month its Thursday is in.
    if (ws && !heading.current) { const m = monthOf(thursdayOf(ws.dataset.week, mondays)); if (m !== month) setMonth(m) }
    // Where it is, to come back to (kept).
    const top = [...el.querySelectorAll('[data-week]')].find((w) => w.offsetTop + w.offsetHeight > el.scrollTop)
    if (top) kept()[viewKey] = { week: top.dataset.week, off: el.scrollTop - top.offsetTop }
    // More weeks before or after, before the edge is reached — not while the
    // weeks are moving (the place held would be lost); once they stop.
    if (moving.current.some((a) => a.playState === 'running' || a.playState === 'pending')) return
    if (el.scrollTop < el.clientHeight) {
      keep.current = el.scrollHeight
      setSpan(([a, n]) => [addDays(a, -7 * MORE), n + MORE])
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight) {
      setSpan(([a, n]) => [a, n + MORE])
    }
  }

  // The day under the pointer, from the row it is over and how far across.
  const dayAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-week]')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const n = Number(el.dataset.n), lead = Number(el.dataset.lead)
    const col = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * (n + lead)) - lead))
    return addDays(el.dataset.week, col)
  }

  // ── handed in, then presented: a line from the day it went in (A) to the
  // talk (B) — or, with no talk, to the record's first day. Each end runs down the whole left side of its box and leaves it
  // at the top — or at the bottom, for a box in the bottom lane of its week —
  // then runs in the gap between the lanes (widened in those weeks, see GAP)
  // out to the margin left of the days, down (or up), and in along the other
  // end's gap to its box. The margin holds two lines side by side; a third
  // over the same weeks runs from A into a dot at the edge, and on from a dot
  // beside B's gap. Drawn after layout, from where the days landed in the bars.
  const links = useRef(null)
  const [laid, relayout] = useState(0)
  useEffect(() => {
    const f = () => relayout((n) => n + 1)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  useLayoutEffect(() => {
    const el = body.current, svg = links.current
    if (!el || !svg) return
    if (!showLinks) { svg.innerHTML = ''; return }
    const box = el.getBoundingClientRect()
    // A box's left side: the corner a line leaves by (y), the other end of the
    // side (far), and the middle of the gap beside that corner.
    const place = (n) => {
      const r = n.getBoundingClientRect(), down = n.closest('.rl-cal-bar').dataset.bottom === '1'
      const top = r.top - box.top + el.scrollTop, bot = r.bottom - box.top + el.scrollTop
      const y = down ? bot : top
      return { x: r.left - box.left + 0.75, y, far: down ? top : bot, gap: y + (down ? GAP.wide / 2 : -GAP.wide / 2) }
    }
    const ends = []
    for (const ev of events) {
      if (!ev.sb || ev.sb === ev.to) continue
      const q = (d) => el.querySelector(`[data-ev="${CSS.escape(String(ev.id))}"] i[data-day="${d}"]`)
      const a = q(ev.sb), b = q(ev.to)
      if (a && b) ends.push({ c: ev.color, A: place(a), B: place(b) })
    }
    // The 12px margin: two lanes for the lines (X), and the dots at its edge.
    const X = [6, 9.5], DOT = 2.2
    const free = X.map(() => -Infinity)          // where each lane is clear from, going down
    const top = (e) => Math.min(e.A.gap, e.B.gap)
    let out = ''
    for (const { c, A, B } of ends.sort((p, q) => top(p) - top(q))) {
      const side = (E) => `M${E.x} ${E.far}V${E.gap}`
      if (Math.abs(A.gap - B.gap) < 1) { out += `<path d="${side(A)}H${B.x}V${B.far}" stroke="${c}"/>`; continue }   // one gap: straight along it
      const lo = Math.min(A.gap, B.gap), hi = Math.max(A.gap, B.gap)
      const i = free.findIndex((y) => y < lo - 3)
      if (i >= 0) {
        free[i] = hi
        out += `<path d="${side(A)}H${X[i]}V${B.gap}H${B.x}V${B.far}" stroke="${c}"/>`
      } else {
        out += `<path d="${side(A)}H${DOT}${side(B)}H${DOT}" stroke="${c}"/>`
          + `<circle cx="${DOT}" cy="${A.gap}" r="2" fill="${c}"/><circle cx="${DOT}" cy="${B.gap}" r="2" fill="${c}"/>`
      }
    }
    svg.setAttribute('height', String(el.scrollHeight))
    svg.innerHTML = out
    // When a bar can have moved: the events, the weeks shown, a column's width,
    // a settled animation (laid), an end being dragged (over). Not on every
    // render — a hover or a lit day moves nothing, and this measures every bar.
  }, [events, showLinks, span, dayW, laid, over])

  // A name that really goes on past its bar leaves the frame open on that side
  // (measured: the widths the lanes are worked out by err on the wide side).
  useLayoutEffect(() => {
    const r = document.createRange()
    for (const b of body.current?.querySelectorAll('.rl-cal-bar.spill') || []) {
      r.selectNodeContents(b.querySelector('.rl-cal-label'))
      b.classList.toggle('runs', r.getBoundingClientRect().right > b.getBoundingClientRect().right)
    }
  })

  // ── one occurrence of a repeating record, right-clicked: for which of them ──
  const [ask, setAsk] = useState(null)          // { x, y, ev }
  useEffect(() => {
    if (!ask) return undefined
    const off = (e) => { if (!e.target.closest?.('.rl-cal-ask')) setAsk(null) }
    const esc = (e) => { if (e.key === 'Escape') setAsk(null) }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc) }
  }, [ask])
  const answer = (how) => { const a = ask; setAsk(null); onOccurrence(how, a.ev.r, a.ev.occ) }

  // ── dragging: an end of a bar, days being lit, or a copy ───────────────
  const drag = useRef(null)
  // The copy being carried: a label by the pointer, moved by hand rather than
  // by a redraw of every week.
  const ghost = useRef(null)
  const carry = (e, d) => {
    const g = ghost.current
    if (!g) return
    g.hidden = false
    g.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 10}px)`
    const to = d.to && d.to !== d.from ? addDays(d.start, diff(d.from, d.to)) : ''
    const sign = d.kind === 'ext' ? '→' : '+'
    g.textContent = to ? `${sign}  ${Number(to.slice(5, 7))}/${Number(to.slice(8))}` : sign
  }
  useEffect(() => {
    const move = (e) => {
      const d = drag.current
      if (!d) return
      if (d.kind === 'copy') {
        const to = dayAt(e) || d.to
        if (to !== d.to) { d.to = to; setCopying(to !== d.from ? { id: d.id, days: diff(d.from, to) } : null) }
        carry(e, d)
        return
      }
      if (d.kind === 'ext') {
        const to = dayAt(e) || d.to
        if (to !== d.to) { d.to = to; setCarried({ id: d.ext.id, day: addDays(d.start, diff(d.from, to)) }) }
        carry(e, d)
        return
      }
      const at = dayAt(e)
      if (!at) return
      if (d.kind === 'sweep') { d.to = at; setSweep({ from: d.from, to: at }); return }
      let { start, end } = d
      if (d.edge === 'start') start = at > end ? end : at
      else end = at < start ? start : at
      d.now = { start, end }
      setOver({ id: d.id, start, end })
    }
    const up = () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.kind === 'sweep') return       // the days stay lit, for a right-click
      if (d.kind === 'copy') {
        if (ghost.current) ghost.current.hidden = true
        document.body.classList.remove('rl-copying')
        if (d.to && d.to !== d.from) Promise.resolve(onCopy?.(d.rec, diff(d.from, d.to))).finally(() => setCopying(null))
        else setCopying(null)
        return
      }
      if (d.kind === 'ext') {
        if (ghost.current) ghost.current.hidden = true
        document.body.classList.remove('rl-moving')
        setCarried(null)
        if (d.to && d.to !== d.from) extMove(d.ext, addDays(d.start, diff(d.from, d.to)))
        return
      }
      const now = d.now
      if (now && (now.start !== d.start || now.end !== d.end)) {
        Promise.resolve(onResize(d.rec, { [cal.start]: now.start, [cal.end]: now.end === now.start && !d.hadEnd ? '' : now.end }))
          .finally(() => setOver(null))
      } else setOver(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [onNew, onResize, onCopy, cal])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── hovering: drawn by a box of its own, so a moving pointer redraws only it
  const peek = useRef(null)
  const timer = useRef(null)
  const hoverOn = (r, e) => {
    clearTimeout(timer.current)
    const at = { x: e.clientX, y: e.clientY }
    timer.current = setTimeout(() => peek.current?.show(r, at), 500)
  }
  const hoverMove = (e) => peek.current?.move({ x: e.clientX, y: e.clientY })
  const hoverOff = () => { clearTimeout(timer.current); peek.current?.hide() }
  useEffect(() => () => clearTimeout(timer.current), [])

  const inSweep = (d) => sweep && d >= min(sweep.from, sweep.to) && d <= max(sweep.from, sweep.to)
  const [ty, tm] = month.split('-').map(Number)
  // A feed's own item. One with `done` (true/false) has a box: pressed, it
  // ticks — here at once, put back if `toggle(done)` says no. The right
  // button opens it, as it opens a record: `open(ctx)`, if the feed gave one.
  const extTick = (x) => {
    if (!x.toggle) return
    const flip = (v) => setExt((xs) => xs.map((y) => (y.id === x.id ? { ...y, done: v } : y)))
    flip(!x.done)
    Promise.resolve(x.toggle(!x.done)).then((ok) => { if (ok === false) flip(x.done) }).catch(() => flip(x.done))
  }
  // One with `move(day)` goes to another day with ⌘ and a drag: there at once,
  // put back if `move` says no.
  const extMove = (x, day) => {
    const put = (v) => setExt((xs) => xs.map((y) => (y.id === x.id ? { ...y, start: v } : y)))
    put(day)
    Promise.resolve(x.move(day)).then((ok) => { if (ok === false) put(x.start) }).catch(() => put(x.start))
  }
  const barProps = (ev) => (ev.ext ? {
    // Another calendar's: its name and where, on hover; nothing to pick or open
    // — unless its feed says what its box and the right button do.
    title: [ev.label, ev.ext.feed, ev.ext.location].filter(Boolean).join('\n'),
    onMouseDown: (e) => {
      if (e.button === 1) return                  // the wheel pressed: the body's, back to today
      e.stopPropagation()
      if (e.button !== 0 || !(e.metaKey || e.ctrlKey) || !ev.ext.move || ev.ext.done) return
      e.preventDefault()
      const from = dayAt(e)
      drag.current = { kind: 'ext', ext: ev.ext, start: ev.s, from, to: from }
      document.body.classList.add('rl-moving')
      carry(e, drag.current)
    },
    onClick: (e) => { e.stopPropagation(); if (e.target.closest('.rl-cal-box')) extTick(ev.ext) },
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); if (drag.current?.kind !== 'ext') ev.ext.open?.(ctx) },
  } : {
    onMouseDown: (e) => {
      if (e.button === 1) return                  // the wheel pressed: the body's, back to today
      e.stopPropagation()
      // ⌘ (Ctrl) and drag: carry a copy to another day; its dates move by as many days.
      if (e.button !== 0 || !(e.metaKey || e.ctrlKey) || !onCopy || ev.occ) return
      e.preventDefault(); hoverOff()
      const from = dayAt(e)
      drag.current = { kind: 'copy', id: ev.id, rec: ev.r, start: ev.s, from, to: from }
      document.body.classList.add('rl-copying')
      carry(e, drag.current)
    },
    onClick: (e) => { if (!e.metaKey && !e.ctrlKey) onPick(ev.base || ev.id) },
    // Ctrl-click is the Mac's right click: while copying it is not one.
    onContextMenu: (e) => {
      e.preventDefault(); e.stopPropagation()
      if (drag.current?.kind === 'copy') return
      hoverOff()
      // One occurrence of many: which of them the change is for.
      if (ev.occ && onOccurrence) setAsk({ x: e.clientX, y: e.clientY, ev })
      else onOpen(ev.base || ev.id)
    },
    onMouseEnter: (e) => hoverOn(ev.r, e), onMouseMove: hoverMove, onMouseLeave: hoverOff,
  })

  return (
    <div className={`rl-cal${week ? ' week' : ''}`}>
      <div className="rl-cal-head">
        <h2 className="rl-cal-title">{tr('rk_month_long', tm)}<span>{tr('rk_year', ty)}</span></h2>
        <div className="rl-cal-legend">
          {(() => {
            // Every group and feed at once: all shown → all hidden, else all shown.
            const keys = [...(cal.groups || []).map((_, i) => i), ...feeds.map(([f]) => `feed:${f}`)]
            const anyOff = keys.some((k) => hidden.has(k))
            const colors = [...(cal.groups || []).map((g) => g.color), ...feeds.map(([, c]) => c)]
            return (
              <button type="button" className={`rl-cal-key${anyOff ? ' off' : ''}`}
                title={`${tr("rk_cal_all")} · ${anyOff ? tr("rk_cal_show_all") : tr("rk_cal_hide_all")}`}
                onClick={() => setHidden(anyOff ? new Set() : new Set(keys))}>
                <i style={{ background: `conic-gradient(${colors.map((c, i) => `${c} ${(i / colors.length) * 360}deg ${((i + 1) / colors.length) * 360}deg`).join(', ')})` }} />
                <span className="rl-cal-key-t">{tr("rk_cal_all")}</span>
              </button>
            )
          })()}
          {(cal.groups || []).map((g, i) => (
            <button key={g.label} type="button" className={`rl-cal-key${hidden.has(i) ? ' off' : ''}`}
              title={`${g.label} · ${hidden.has(i) ? tr("rk_show") : tr("rk_hide")}`}
              onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}>
              <i style={{ background: g.color }} /><span className="rl-cal-key-t">{g.label}</span>
            </button>
          ))}
          {feeds.map(([f, c]) => (
            <button key={`feed:${f}`} type="button" className={`rl-cal-key rl-cal-feed${hidden.has(`feed:${f}`) ? ' off' : ''}`}
              title={tr("rk_gcal_readonly", f, hidden.has(`feed:${f}`) ? tr("rk_show") : tr("rk_hide"))}
              onClick={() => setHidden((s) => { const n = new Set(s); const k = `feed:${f}`; if (n.has(k)) n.delete(k); else n.add(k); return n })}>
              <i style={{ borderColor: c }} /><span className="rl-cal-key-t">{f}</span>
            </button>
          ))}
          {cal.submit && cal.mark && (
            <button type="button" className={`rl-cal-key${showLinks ? '' : ' off'}`}
              title={`${tr("rk_links_lines")} · ${showLinks ? tr("rk_hide_links") : tr("rk_show_links")}`}
              onClick={() => setShowLinks((v) => !v)}>
              <i className="rl-cal-key-line" /><span className="rl-cal-key-t">{tr("rk_links_lines")}</span></button>
          )}
        </div>
        {(allTags.length > 0 || allPeople.length > 0) && (
          <div className="rl-cal-tags">
            <span className="rl-hint">{tr("rk_cal_tags")}</span>
            {[...tagSel].map((k) => (
              <button key={k} type="button" className="rl-cal-key on" title={tr("rk_cal_tag_off")}
                onClick={() => setTagSel((s) => { const n = new Set(s); n.delete(k); return n })}>
                {k.startsWith('+') ? <span className="rl-proj">{projOf(k)?.name || k.slice(1)}</span>
                  : k.startsWith('@') ? <span className="rl-auth">{whoIs(k)?.kor || whoIs(k)?.eng || k.slice(1)}</span>
                    : <span className="rl-cal-key-t">#{allTags.find((x) => x.k === k)?.t || k}</span>}<b>×</b>
              </button>
            ))}
            <input className="rl-cal-tag-in" list={`rl-cal-tags-${def.key}`} value={tagIn} placeholder={tr("rk_cal_tag_add")}
              onChange={(e) => { if (!addTag(e.target.value)) setTagIn(e.target.value) }}
              onKeyDown={(e) => { if (e.key === 'Enter') addTag(tagIn) }} />
            <datalist id={`rl-cal-tags-${def.key}`}>
              {projects.filter((p) => !tagSel.has(`+${tagKey(p.name)}`)).map((p) => (
                <option key={`+${p.id}`} value={`+${p.name}`}>{(p.tags || []).map((t) => `#${t}`).join(p.match === 'and' ? ' & ' : ' ')}</option>))}
              {allTags.filter((x) => !tagSel.has(x.k)).map((x) => <option key={x.k} value={`#${x.t}`}>{`${x.n}`}</option>)}
              {/* A person by either name, shown with the other one and their
                  address — the same three things `@` offers in a note. */}
              {allPeople.filter(({ x }) => !x.keys.some((k) => tagSel.has(`@${k}`)))
                .map(({ x, n }) => (
                  <option key={`@${x.id}`} value={`@${x.kor || x.eng}`}>
                    {/* the value is their Korean name when they have one, so
                        the other name to show is the English one */}
                    {[x.kor ? x.eng : '', x.email, `${n}`].filter(Boolean).join(' · ')}
                  </option>))}
            </datalist>
          </div>
        )}
        <span className="rl-sp" />
        {query && (
          <span className="rl-cal-found">
            <span className="rl-hint">{tr("rk_found_events", events.length)}</span>
            <button type="button" className="rl-btn" disabled={!prevFound} title={tr("rk_prev_found_month")}
              onClick={() => toFound(prevFound)}>‹</button>
            <button type="button" className="rl-btn" disabled={!nextFound} title={tr("rk_next_found_month")}
              onClick={() => toFound(nextFound)}>›</button>
          </span>
        )}
        <span className="rl-cal-nav">
          <button type="button" className="rl-btn" title={tr("rk_prev_month")} onClick={() => goTo(shiftMonth(month, -1))}>‹ {monthName(shiftMonth(month, -1))}</button>
          <button type="button" className="rl-btn" title={tr("rk_next_month")} onClick={() => goTo(shiftMonth(month, 1))}>{monthName(shiftMonth(month, 1))} ›</button>
        </span>
        <button type="button" className="rl-btn rl-cal-today" onClick={toToday}>{tr("rk_today")}</button>
        <select className="rl-btn rl-pick rl-cal-mode" value={mode} onChange={(e) => switchMode(e.target.value)}>
          <option value="month">{tr("rk_cal_mode_month")}</option>
          <option value="week">{tr("rk_cal_mode_week")}</option>
          <option value="mwd">{tr("rk_cal_mode_mwd")}</option>
        </select>
      </div>
      {!week && (
        <div className="rl-cal-days" style={{ '--cols': mwd ? 5 : 7 }}>
          {DAYS.map((_, d) => !(mwd && [0, 6].includes(d)) && <span key={d}>{dow(d)}</span>)}
        </div>
      )}
      <div className="rl-cal-body" ref={body} onScroll={onScroll}
        // The wheel pressed down: back to today (and no autoscroll).
        onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); toToday() } }}>
        <svg ref={links} className="rl-cal-links" />
        {rows.map(({ ws, n: count, lead }) => {
          // Where a name starts: at the record's first day, if two days or more
          // are left from it to the bar's end here (the trip's end); else at the bar's beginning.
          const skipOf = (ev, a, b) => (ev.s > addDays(ws, a) && ev.s <= addDays(ws, b) && b - diff(ws, ev.s) >= 1 ? diff(ws, ev.s) - a : 0)
          const first = (d) => opensMonth(d, mwd)
          const dayNum = (d) => tr('rk_day_num', Number(d.slice(8)))
          const numClass = (d) => `rl-cal-num${d === today ? ' today' : d === shown ? ' shown' : ''}${first(d) ? ' first' : ''}`
          const numText = (d) => (first(d) ? `${tr('rk_month_short', Number(d.slice(5, 7)))} ${dayNum(d)}` : dayNum(d))
          const we = addDays(ws, count - 1)
          const days = Array.from({ length: count }, (_, i) => addDays(ws, i))
          const col = (d) => diff(ws, d)
          // This week's records, group by group in the order the groups are
          // declared, longest first in each, each in the first lane it fits —
          // and then the groups that fill from the bottom (calendar.groups[].bottom:
          // 1 lowest, then 2, …), each in the lowest lane it fits.
          const segs = shownEvents.flatMap((ev) => ev.pieces.filter((p) => p.from <= we && p.to >= ws).map((p) => ({ ev, p })))
            .sort((x, y) => diff(y.p.from, y.p.to) - diff(x.p.from, x.p.to) || x.p.from.localeCompare(y.p.from) || x.ev.label.localeCompare(y.ev.label))
          const fits = (used, a, b) => used.every(([x, y]) => b < x || a > y)
          const lanes = []
          const placed = segs.map(({ ev, p }) => ({ ev, p, a: col(max(p.from, ws)), b: col(min(p.to, we)) }))
          const rank = (s) => (s.ev.g < 0 ? 1e3 : s.ev.g)        // a record in no group: after them all
          // In a group, the earlier time higher; a record with no time first.
          const byTime = (x, y) => (x.ev.time || '').localeCompare(y.ev.time || '')
          for (const s of placed.filter((x) => !x.ev.low).sort((x, y) => rank(x) - rank(y) || byTime(x, y))) {
            s.lane = lanes.findIndex((used) => fits(used, s.a, s.b))
            if (s.lane < 0) { s.lane = lanes.length; lanes.push([]) }
            lanes[s.lane].push([s.a, s.b])
          }
          // The bottom groups stack up from the bottom on their own (k = 0 the
          // lowest lane), then sit as close under the top groups as they fit.
          // In a group a bar over several days goes in first, so that a one-day one
          // does not push it up between the next group's bars.
          // (They stack upwards, so the later time goes in first: the earlier sits above it.)
          const lows = placed.filter((x) => x.ev.low).sort((x, y) => x.ev.low - y.ev.low || (y.b > y.a) - (x.b > x.a) || byTime(y, x))
          const stack = []
          for (const s of lows) {
            s.k = stack.findIndex((used) => fits(used, s.a, s.b))
            if (s.k < 0) { s.k = stack.length; stack.push([]) }
            stack[s.k].push([s.a, s.b])
          }
          let T = Math.max(LANES, lanes.length, stack.length)
          const clash = (t) => stack.some((used, k) => t - 1 - k < lanes.length && used.some(([x, y]) => !fits(lanes[t - 1 - k], x, y)))
          while (clash(T)) T += 1
          while (lanes.length < T) lanes.push([])
          stack.forEach((used, k) => lanes[T - 1 - k].push(...used))
          for (const s of lows) s.lane = T - 1 - s.k
          const total = Math.max(lanes.length, LANES)
          // A week a line leaves from has room between its lanes for it.
          const gap = shownEvents.some((ev) => ev.sb && ev.sb !== ev.to
            && ((ev.sb >= ws && ev.sb <= we) || (ev.to >= ws && ev.to <= we))) ? GAP.wide : GAP.base
          // The lines of a name that so many lanes hold.
          const linesIn = (rows) => Math.floor((rows * 22 + (rows - 1) * gap - 4) / 15)
          const fitsOver = (s, free) => {
            if (!dayW) return true
            const w = (s.b - s.a + 1 + free) * dayW - 18      // less the bar's margin and the name's padding
            const mark = markW(s)
            return s.rows === 1 ? textW(s.ev.label) - 30 + mark <= w : linesOf(s.ev.label, w, mark) <= linesIn(s.rows)
          }
          for (const s of placed) s.ends = s.p.to <= we
          // Worked out once for as long as nothing it hangs on changes: a render is
          // often a hover, and the weeks are many.
          const key = JSON.stringify([dayW, gap, total, count, week, document.fonts.status, placed.map((s) => [s.ev.label, s.p.key, s.a, s.b, s.lane, s.ev.low, markW(s), typeof s.ev.ext?.done])])
          if (!arranged.has(key)) {
            if (arranged.size > 2000) arranged.clear()
            arrange(placed, total, count, fitsOver, (s) => !week && typeof s.ev.ext?.done !== 'boolean', !!dayW)
            arranged.set(key, placed.map((s) => [s.lane, s.rows, s.free]))
          }
          arranged.get(key).forEach(([lane, rows, free], i) => Object.assign(placed[i], { lane, rows, free }))
          // A day whose top two lanes are free (no bar, no name running over
          // them): its number large, in the middle of those two.
          // How far a name really runs on is measured; until the days have a
          // width, it is taken to run as far as it may.
          const used = Array.from({ length: count }, () => new Array(total).fill(false))
          for (const s of placed) {
            const at = s.a + skipOf(s.ev, s.a, s.b)
            const over = dayW ? Math.min(s.free, Math.max(0, at + Math.ceil(textW(s.ev.label) / s.rows / dayW) - 1 - s.b)) : s.free
            for (let c = s.a; c <= s.b + over; c++) for (let r = s.lane; r < s.lane + s.rows; r++) used[c][r] = true
          }
          const open = used.map((lanes) => !lanes[0] && !lanes[1])
          return (
            <div key={ws} className={`rl-cal-week${week ? (lead ? ' wk-top' : ' wk-bot') : ''}`} data-week={ws} data-n={count} data-lead={lead} style={{ '--cols': count + lead }}>
              {lead > 0 && <WeekInfo ws={ws} events={shownEvents} groups={cal.groups} />}
              <div className="rl-cal-cells">
                {lead > 0 && <span />}
                {days.map((d) => (
                  <div key={d} className={`rl-cal-cell${[0, 6].includes(parse(d).getDay()) ? ' rest' : ''}${inSweep(d) ? ' sweep' : ''}${inDrop(d) ? ' drop' : ''}${!week && monthOf(addDays(d, -7)) !== monthOf(d) ? ' m-top' : ''}${open[col(d)] && !first(d) ? ' big' : ''}`}
                    onMouseDown={(e) => {
                      // The left button lights days: one, or as many as it drags across.
                      if (e.button !== 0) return
                      e.preventDefault()
                      drag.current = { kind: 'sweep', from: d, to: d }
                      setSweep({ from: d, to: d })
                    }}
                    onContextMenu={(e) => {
                      // The right button makes a record over the lit days — or,
                      // on a day that is not lit, starting that day.
                      e.preventDefault()
                      if (inSweep(d)) {
                        const [a, b] = [sweep.from, sweep.to].sort()
                        onNew(a === b ? { [cal.start]: a } : { [cal.start]: a, [cal.end]: b })
                      } else onNew({ [cal.start]: d })
                      setSweep(null)
                    }}>
                    {week && <span className="rl-cal-dow">{dow(parse(d).getDay())}</span>}
                    <span className={numClass(d)}>{open[col(d)] && first(d) ? dayNum(d) : numText(d)}</span>
                  </div>
                ))}
              </div>
              <div className="rl-cal-events" style={{ gridTemplateRows: `repeat(${total}, 22px)`, rowGap: gap }}>
                {days.map((d) => open[col(d)] && (
                  // On the 1st the month is large and the day stays small in its corner.
                  <span key={d} data-big={d} className={`${first(d) ? 'rl-cal-num first' : numClass(d)} big${inSweep(d) ? ' sweep' : ''}`}
                    style={{ gridColumn: col(d) + 1 + lead, gridRow: '1 / span 2' }}>{first(d) ? tr('rk_month_short', Number(d.slice(5, 7))) : numText(d)}</span>
                ))}
                {placed.map(({ ev, p, a, b, lane, rows, free }) => {
                  const bottom = lane > 0 && lane + rows >= total     // in the bottom lane (and not the top): a line leaves from below
                  const n = b - a + 1
                  // How each day of the bar is painted: the trip around (light
                  // gray), the record's own days (light), the marked day (a band below).
                  const level = (d) => (d === ev.mk ? 3 : (d >= ev.s && d <= ev.e) || d === ev.sb ? 2 : ev.ts && d >= ev.ts && d <= ev.te ? 1 : 0)
                  // A day of the record its trip does not cover: not there for it. Only
                  // a trip that meets the record's days — one apart from them (a
                  // deadline, then an interview) is another thing, drawn on its own.
                  const miss = (d) => ev.joined && (d === ev.mk || (d >= ev.s && d <= ev.e)) && (d < ev.ts || d > ev.te)
                  // The ends that stretch are the record's own, and only on its main piece.
                  const own = p.key === 'main' && !ev.copy && !ev.ext && !ev.occ
                  const sIn = own && ev.s >= ws && ev.s <= we, eIn = own && ev.e >= ws && ev.e <= we
                  const skip = skipOf(ev, a, b)
                  return (
                    <div key={`${ev.id}:${p.key}`} data-ev={ev.id} data-piece={p.key} data-bottom={bottom ? '1' : undefined} className={`rl-cal-bar${ev.paper ? ' paper' : ''}${ev.framed ? ' framed' : ''}${ev.hatch ? ' hatch' : ''}${ev.online ? ' online' : ''}${ev.ext ? ' ext' : ''}${typeof ev.ext?.done === 'boolean' ? ' todo' : ''}${ev.ext?.done ? ' done' : ''}${ev.ext?.urgent && !ev.ext.done ? ' urgent' : ''}${ev.copy ? ' copy' : ''}${free ? ' spill' : ''}${ev.occ ? ' occ' : ''}${picked?.has(ev.base || ev.id) ? ' on' : ''}${p.from < ws ? ' cont-l' : ''}${p.to > we ? ' cont-r' : ''}${rows > 1 ? ' tall' : ''}`}
                      style={{ '--c': ev.color, gridRow: `${lane + 1} / span ${rows}`, gridColumn: `${a + 1 + lead} / ${b + 2 + lead}`, '--lines': linesIn(rows) }} {...barProps(ev)}>
                      <span className="rl-cal-fill">
                        {Array.from({ length: n }, (_, i) => { const d = addDays(ws, a + i); return <i key={i} data-day={d} className={`lv${level(d)}${miss(d) ? ' miss' : ''}`} /> })}
                      </span>
                      <span className="rl-cal-label" data-submit={p.key === 'submit' ? '' : undefined} style={{ marginLeft: skip ? `${(skip / n) * 100}%` : undefined,
                        width: free ? `${((n - skip + free) / n) * 100}%` : undefined }}>
                        {typeof ev.ext?.done === 'boolean' && <i className={`rl-cal-box${ev.ext.done ? '' : ' open'}`} title={tr("rk_todo_tick")}>{ev.ext.done ? '☑' : ''}</i>}
                        {ev.online && p.key !== 'submit' && <i className="rl-cal-online" />}
                        {ev.label}</span>
                      {sIn && (
                        <b className="rl-cal-grip" style={{ left: `${((col(ev.s) - a) / n) * 100}%` }} title={tr("rk_move_start")}
                          onMouseDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); hoverOff(); drag.current = { kind: 'end', edge: 'start', id: ev.id, rec: ev.r, start: ev.s, end: ev.e, hadEnd: !!day(ev.r[cal.end]) } }} />
                      )}
                      {eIn && (
                        <b className="rl-cal-grip" style={{ left: `calc(${((col(ev.e) - a + 1) / n) * 100}% - 6px)` }} title={tr("rk_move_end")}
                          onMouseDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); hoverOff(); drag.current = { kind: 'end', edge: 'end', id: ev.id, rec: ev.r, start: ev.s, end: ev.e, hadEnd: true } }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <PeekHost ref={peek} def={def} doc={doc} ctx={ctx} />
      <div ref={ghost} className="rl-cal-ghost" hidden />
      {ask && (
        <div className="rl-cal-ask" style={{ left: ask.x, top: ask.y }}>
          <div className="rl-hint">{ask.ev.label} · {ask.ev.occ}</div>
          <button type="button" onClick={() => answer('one')}>{tr("rk_edit_this_only")}</button>
          <button type="button" onClick={() => answer('following')}>{tr("rk_edit_following")}</button>
          <button type="button" onClick={() => answer('all')}>{tr("rk_edit_all")}</button>
          <button type="button" className="rl-danger-t" onClick={() => answer('delete')}>{tr("rk_delete_this_only")}</button>
        </div>
      )}
    </div>
  )
}

/** The week mode's first cell: which week it is, and how many of each kind are
 *  on it — of what is shown, each once however many weeks it runs over. */
function WeekInfo({ ws, events, groups }) {
  const we = addDays(ws, 6)
  const on = events.filter((ev) => !ev.copy && ev.pieces.some((p) => p.from <= we && p.to >= ws))
  const feeds = [...new Set(on.filter((ev) => ev.ext).map((ev) => ev.ext.feed))]
  const counts = [
    ...(groups || []).map((g, i) => ({ k: g.label, c: g.color, n: on.filter((ev) => ev.g === i).length })),
    ...feeds.map((f) => {
      const of = on.filter((ev) => ev.ext?.feed === f)
      // A feed with boxes (a note's todos): how many are left, of how many.
      const boxed = of.some((ev) => typeof ev.ext.done === 'boolean')
      return { k: f, c: of[0].color, feed: true, n: of.length, left: boxed ? of.filter((ev) => !ev.ext.done).length : null }
    }),
  ].filter((x) => x.n)
  const [m, nth] = weekOfMonth(ws)
  return (
    <div className="rl-cal-info">
      <b>{tr('rk_cal_week_of', m, nth)}</b>
      <small>{shortDay(ws)} – {shortDay(we)}</small>
      <span className="rl-cal-counts">
        {counts.map((x) => (
          <span key={x.k}><i className={x.feed ? 'feed' : ''} style={x.feed ? { borderColor: x.c } : { background: x.c }} />{x.k} {x.left != null ? `${x.left}/${x.n}` : x.n}</span>
        ))}
      </span>
    </div>
  )
}

/** The hover box, with state of its own: following the pointer redraws it,
 *  not the hundreds of days behind it. */
function PeekHost({ ref, def, doc, ctx }) {
  const [p, setP] = useState(null)       // { r, x, y }
  useEffect(() => {
    if (!ref) return undefined
    ref.current = {
      show: (r, at) => setP({ r, ...at }),
      move: (at) => setP((s) => (s ? { ...s, ...at } : s)),
      hide: () => setP(null),
    }
    return () => { ref.current = null }
  }, [ref])
  if (!p) return null
  return <Peek def={def} doc={doc} ctx={ctx} r={p.r} x={p.x} y={p.y} />
}

/** What the editor shows of a record, small, by the pointer. */
function Peek({ def, doc, ctx, r, x, y }) {
  const rows = def.item.fields
    .filter((f) => f.edit !== false && f.store !== false && f.type !== 'image' && (!f.get || typeOf(f).Show))
    .filter((f) => !f.when || f.when(r, { draft: false, doc }))
    .map((f) => {
      const c = ctxFor(def, doc, f, { ...ctx, rec: r })
      return [f.label, typeOf(f).text(valueOf(f, r, c), c)]
    })
    .filter(([, t]) => String(t || '').trim())
  // Kept on screen: it opens to the left or above when the pointer is near an edge.
  const left = x + 340 > window.innerWidth ? x - 330 : x + 14
  const top = y + 24 + rows.length * 19 > window.innerHeight ? Math.max(8, y - 16 - rows.length * 19) : y + 16
  return (
    <div className="rl-cal-peek" style={{ left, top }}>
      <b>{labelOf(def, r)}</b>
      {rows.map(([l, t]) => (
        <div key={l}><span>{l}</span><em>{String(t).length > 120 ? `${String(t).slice(0, 120)}…` : t}</em></div>
      ))}
    </div>
  )
}
