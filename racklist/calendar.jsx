import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './strings.js'
import { tr } from '../i18n.jsx'
import { typeOf } from './types.jsx'
import { ctxFor, labelOf, valueOf } from './schema.js'
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
 * as many lines as it then has. A record without a start is not on it.
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
const monthOf = (s) => s.slice(0, 7)
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
const OPEN = 220       // ms: weeks opening up, bars sliding to their places
const UNROLL = 320     // ms: then a new bar unrolling from the left
const FOLD = 200       // ms: before all that, a bar going rolling up to its left end
const NONE = []

// Where each calendar was scrolled to, for as long as the page around it
// lives. The portal frames one service at a time and loads it afresh on the
// way back, so this rides on the portal's own window (the same origin): back
// from another service, the calendar is where it was; opened anew, or after a
// reload, it starts at today. A page of its own keeps it on its own window.
// A name's width as a bar draws it (--fs-small), with its padding and room for
// a mark before it (☐, ↻, the handed-in file).
let pen
const textW = (t) => {
  pen ||= document.createElement('canvas').getContext('2d')
  pen.font = `12px ${getComputedStyle(document.body).fontFamily}`
  return pen.measureText(t || '').width + 14 + 16
}
const kept = () => { try { return (window.top.__rackCal ||= {}) } catch { return (window.__rackCal ||= {}) } }

export function RackCalendar({ def, doc, items, query, ctx, picked, onPick, onOpen, onNew, onResize, onCopy, onOccurrence, at }) {
  const cal = def.calendar
  const idk = def.item.id || 'id'
  const today = fmt(new Date())
  const viewKey = projectKey(def.key, 'calat')
  // { week, off }: the week at the top of the view and how far into it — or, the first time, today.
  const [was] = useState(() => kept()[viewKey] || null)
  const [month, setMonth] = useState(() => monthOf(was ? addDays(was.week, 4) : today))     // the month on screen
  const [hidden, setHidden] = useState(() => new Set(load(projectKey(def.key, 'calhide'), [])))
  useEffect(() => { save(projectKey(def.key, 'calhide'), [...hidden]) }, [def.key, hidden])
  // The lines from a handed-in day to its talk: drawn, or not.
  const [showLinks, setShowLinks] = useState(() => load(projectKey(def.key, 'callinks'), true))
  useEffect(() => { save(projectKey(def.key, 'callinks'), showLinks) }, [def.key, showLinks])

  // The weeks drawn: [first, count]. Grows at either end as you scroll there.
  const [span, setSpan] = useState(() => [addDays(was ? was.week : sunday(today), -7 * BEFORE), BEFORE + AFTER])
  const weeks = useMemo(() => Array.from({ length: span[1] }, (_, i) => addDays(span[0], 7 * i)), [span])

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
    if (hidden.has(g)) return null
    const ev = { r, id: occ ? `${id}@${occ}` : shift ? `${id}:copy` : id, copy: !!shift && !occ, occ, base: id, s, e, ts, te, mk, sb, to: mk || s, color: g >= 0 ? cal.groups[g].color : GRAY, paper: g >= 0 && !!cal.groups[g].paper, g, low: (g >= 0 && Number(cal.groups[g].bottom)) || 0, hatch: !!cal.hatch?.(r), online,
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
  // feed, color, title, start, end, time, location }]>): drawn, never edited.
  // An item may also carry done (a box to tick), toggle(done) → ok and
  // open(ctx) — a todo kept elsewhere, ticked or opened from here.
  const [ext, setExt] = useState([])
  useEffect(() => {
    if (!cal.overlay) return undefined
    let on = true
    Promise.resolve(cal.overlay()).then((x) => { if (on) setExt(Array.isArray(x) ? x : []) }).catch(() => {})
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
        if (!x.start || hidden.has(`feed:${x.feed}`)) continue
        const e = x.end && x.end >= x.start ? x.end : x.start
        out.push({ r: { name: x.title }, id: `ext:${x.id}`, ext: x, s: x.start, e, ts: '', te: '', mk: '', sb: '', to: x.start,
          color: x.color || GRAY, g: -1, low: 0, label: x.time ? `${x.title} (${x.time})` : x.title,
          pieces: [{ key: 'main', from: x.start, to: e }] })
      }
    }
    const r = copying && items.find((x) => x[idk] === copying.id)
    const c = r && build(r, copying.days)
    if (c) out.push(c)
    return out
  }, [items, over, hidden, doc, copying, ext, query, weeks])   // eslint-disable-line react-hooks/exhaustive-deps
  // The days a carried copy would land on, lit.
  const drop = events.find((ev) => ev.copy)?.pieces[0]
  const inDrop = (d) => drop && d >= drop.from && d <= drop.to

  // While searching: the months that have something found, to step between.
  const found = useMemo(() => (query ? [...new Set(events.map((ev) => monthOf(ev.s)))].sort() : []), [events, query])
  const prevFound = found.filter((m) => m < month).at(-1)
  const nextFound = found.find((m) => m > month)
  // To a month with something found: its first find, in the middle.
  const toFound = (m) => goTo(m, events.filter((ev) => monthOf(ev.s) === m).map((ev) => ev.s).sort()[0], true)

  // The head is one line. When the legend's words and the month buttons do
  // not fit on it, the legend keeps its colours and drops the words (each
  // says its name on hover); they come back once the line is wide enough
  // for them again — `need` is how wide that was.
  const headRef = useRef(null)
  const [tight, setTight] = useState(false)
  const need = useRef(0)
  useLayoutEffect(() => {
    const el = headRef.current
    if (!el) return undefined
    const fit = () => {
      if (!el.classList.contains('tight')) {
        need.current = el.scrollWidth
        if (el.scrollWidth > el.clientWidth + 1) setTight(true)
      } else if (el.clientWidth >= need.current) setTight(false)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [feeds.length, query, tight])

  // ── scrolling ───────────────────────────────────────────────────────────
  const body = useRef(null)
  // A day's width, and a name's in the bars' type: how far a name runs on.
  const [dayW, setDayW] = useState(0)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return undefined
    const fit = () => setDayW(el.clientWidth / 7)
    fit()                                       // now, before the first paint
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The week to bring into view after the next draw: at the top or in the
  // middle, scrolled to or (the first time, or from far away) simply shown.
  const goal = useRef(was ? { w: was.week, off: was.off, smooth: false } : { w: sunday(today), center: true, smooth: false })
  const keep = useRef(null)                     // weeks added above: keep what is on screen still
  const opened = useRef(goal.current)           // where it opened, held as the records come in
  const place = (el, g) => {
    const w = el.querySelector(`[data-week="${g.w}"]`)
    if (!w) return
    const top = g.center ? w.offsetTop + w.offsetHeight / 2 - el.clientHeight / 2 : w.offsetTop + (g.off || 0)
    if (g.smooth) el.scrollTo({ top, behavior: 'smooth' })
    else el.scrollTop = top
  }
  // To a month (its first week at the top) — or to a day, in the middle. The
  // weeks between are drawn first, so the way there is scrolled through;
  // further than FAR weeks it is a jump instead.
  const goTo = useCallback((ym, at = `${ym}-01`, center = false) => {
    const w = sunday(at)
    opened.current = null
    goal.current = { w, center, smooth: true }
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
  }, [])
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
    // Scrolling for more weeks, a new width, a drag under way, or asked for
    // no motion: simply drawn.
    if (!before || before.span !== span || before.dayW !== dayW || drag.current || copying
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // The week line nearest the middle, and where it is on the screen — or,
    // as the records first come in, the week opened to: in the middle once
    // it has opened (today's), or where it was left.
    let anchor = null, at = 0
    if (!before.drawn && opened.current && now.weeks.has(opened.current.w)) {
      anchor = { w: opened.current.w }
      at = opened.current.center ? Math.max(0, (el.clientHeight - now.weeks.get(anchor.w).h) / 2) : -opened.current.off
    } else {
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
    if (links.current && moving.current.length) go(links.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: later + UNROLL, fill: 'backwards' })
    // Settled: the weeks before and after it are looked at again (see onScroll).
    const all = moving.current.slice()
    if (all.length) Promise.all(all.map((x) => x.finished)).then(() => onScroll(), () => {})
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
  // the middle, the day lit, and its number painted until the next ask.
  useEffect(() => {
    if (!at?.d) return
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
    if (ws) { const m = monthOf(addDays(ws.dataset.week, 4)); if (m !== month) setMonth(m) }
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

  // The day under the pointer, from the week it is over and how far across.
  const dayAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-week]')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const col = Math.max(0, Math.min(6, Math.floor(((e.clientX - rect.left) / rect.width) * 7)))
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
  const [, relayout] = useState(0)
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
    g.textContent = to ? `+  ${Number(to.slice(5, 7))}/${Number(to.slice(8))}` : '+'
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
  const barProps = (ev) => (ev.ext ? {
    // Another calendar's: its name and where, on hover; nothing to pick or open
    // — unless its feed says what its box and the right button do.
    title: [ev.label, ev.ext.feed, ev.ext.location].filter(Boolean).join('\n'),
    onMouseDown: (e) => e.stopPropagation(),
    onClick: (e) => { e.stopPropagation(); if (e.target.closest('.rl-cal-box')) extTick(ev.ext) },
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); ev.ext.open?.(ctx) },
  } : {
    onMouseDown: (e) => {
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
    <div className="rl-cal">
      <div ref={headRef} className={`rl-cal-head${tight ? ' tight' : ''}`}>
        <h2 className="rl-cal-title">{tr('rk_year_month', ty, tm)}</h2>
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
          <button type="button" className="rl-btn" title={tr("rk_prev_month")} onClick={() => goTo(shiftMonth(month, -1))}>‹</button>
          <button type="button" className="rl-btn" onClick={toToday}>{tr("rk_today")}</button>
          <button type="button" className="rl-btn" title={tr("rk_next_month")} onClick={() => goTo(shiftMonth(month, 1))}>›</button>
        </span>
      </div>
      <div className="rl-cal-days">
        {DAYS.map((_, d) => <span key={d}>{dow(d)}</span>)}
      </div>
      <div className="rl-cal-body" ref={body} onScroll={onScroll}
        // The wheel pressed down: back to today (and no autoscroll).
        onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); toToday() } }}>
        <svg ref={links} className="rl-cal-links" />
        {weeks.map((ws) => {
          // Where a name starts: at the record's first day, if two days or more
          // are left from it to the bar's end here (the trip's end); else at the bar's beginning.
          const skipOf = (ev, a, b) => (ev.s > addDays(ws, a) && ev.s <= addDays(ws, b) && b - diff(ws, ev.s) >= 1 ? diff(ws, ev.s) - a : 0)
          const numClass = (d) => `rl-cal-num${d === today ? ' today' : d === shown ? ' shown' : ''}${d.slice(8) === '01' ? ' first' : ''}`
          const numText = (d) => (d.slice(8) === '01' ? tr('rk_month_first', Number(d.slice(5, 7))) : tr('rk_day_num', Number(d.slice(8))))
          const we = addDays(ws, 6)
          const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
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
          // (They stack upwards, so the later time goes in first: the earlier sits above it.)
          const lows = placed.filter((x) => x.ev.low).sort((x, y) => x.ev.low - y.ev.low || byTime(y, x))
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
          // A bar with nothing under it takes the lanes below too — first come,
          // first served, top lanes first — so a lone one-day record has room
          // for its whole name.
          const total = Math.max(lanes.length, LANES)
          // A week a line leaves from has room between its lanes for it.
          const gap = shownEvents.some((ev) => ev.sb && ev.sb !== ev.to
            && ((ev.sb >= ws && ev.sb <= we) || (ev.to >= ws && ev.to <= we))) ? GAP.wide : GAP.base
          const taken = Array.from({ length: total }, (_, i) => (lanes[i] || []).slice())
          for (const s of [...placed].sort((x, y) => x.lane - y.lane)) {
            s.rows = 1
            while (s.lane + s.rows < total && taken[s.lane + s.rows].every(([x, y]) => s.b < x || s.a > y)) {
              taken[s.lane + s.rows].push([s.a, s.b])
              s.rows += 1
            }
          }
          // The days right of a bar that nothing takes, in all its lanes, to the
          // week's end: its name may run on over them.
          for (const s of placed) {
            s.free = 0
            if (s.p.to > we) continue
            while (s.b + s.free < 6 && taken.slice(s.lane, s.lane + s.rows).every((used) => fits(used, s.b + s.free + 1, s.b + s.free + 1))) s.free += 1
          }
          // A day whose top two lanes are free (no bar, no name running over
          // them): its number large, in the middle of those two.
          // How far a name really runs on is measured; until the days have a
          // width, it is taken to run as far as it may.
          const used = Array.from({ length: 7 }, () => new Array(total).fill(false))
          for (const s of placed) {
            const at = s.a + skipOf(s.ev, s.a, s.b)
            const over = dayW ? Math.min(s.free, Math.max(0, at + Math.ceil(textW(s.ev.label) / s.rows / dayW) - 1 - s.b)) : s.free
            for (let c = s.a; c <= s.b + over; c++) for (let r = s.lane; r < s.lane + s.rows; r++) used[c][r] = true
          }
          const open = used.map((lanes) => !lanes[0] && !lanes[1])
          return (
            <div key={ws} className="rl-cal-week" data-week={ws}>
              <div className="rl-cal-cells">
                {days.map((d) => (
                  <div key={d} className={`rl-cal-cell${monthOf(d) !== month ? ' out' : ''}${inSweep(d) ? ' sweep' : ''}${inDrop(d) ? ' drop' : ''}${monthOf(addDays(d, -7)) !== monthOf(d) ? ' m-top' : ''}${open[col(d)] && d.slice(8) !== '01' ? ' big' : ''}`}
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
                    <span className={numClass(d)}>{open[col(d)] && d.slice(8) === '01' ? tr('rk_day_num', 1) : numText(d)}</span>
                  </div>
                ))}
              </div>
              <div className="rl-cal-events" style={{ gridTemplateRows: `repeat(${total}, 22px)`, rowGap: gap }}>
                {days.map((d) => open[col(d)] && (
                  // On the 1st the month is large and the day stays small in its corner.
                  <span key={d} data-big={d} className={`${d.slice(8) === '01' ? 'rl-cal-num first' : numClass(d)} big${monthOf(d) !== month ? ' out' : ''}${inSweep(d) ? ' sweep' : ''}`}
                    style={{ gridColumn: col(d) + 1, gridRow: '1 / span 2' }}>{d.slice(8) === '01' ? tr('rk_month_short', Number(d.slice(5, 7))) : numText(d)}</span>
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
                    <div key={`${ev.id}:${p.key}`} data-ev={ev.id} data-piece={p.key} data-bottom={bottom ? '1' : undefined} className={`rl-cal-bar${ev.paper ? ' paper' : ''}${ev.hatch ? ' hatch' : ''}${ev.online ? ' online' : ''}${ev.ext ? ' ext' : ''}${ev.ext?.done ? ' done' : ''}${ev.copy ? ' copy' : ''}${free ? ' spill' : ''}${ev.occ ? ' occ' : ''}${picked?.has(ev.base || ev.id) ? ' on' : ''}${p.from < ws ? ' cont-l' : ''}${p.to > we ? ' cont-r' : ''}${rows > 1 ? ' tall' : ''}`}
                      style={{ '--c': ev.color, gridRow: `${lane + 1} / span ${rows}`, gridColumn: `${a + 1} / ${b + 2}`, '--lines': Math.floor((rows * 22 + (rows - 1) * gap - 4) / 15) }} {...barProps(ev)}>
                      <span className="rl-cal-fill">
                        {Array.from({ length: n }, (_, i) => { const d = addDays(ws, a + i); return <i key={i} data-day={d} className={`lv${level(d)}${miss(d) ? ' miss' : ''}`} /> })}
                      </span>
                      <span className="rl-cal-label" data-submit={p.key === 'submit' ? '' : undefined} style={{ marginLeft: skip ? `${(skip / n) * 100}%` : undefined,
                        width: free ? `${((n - skip + free) / n) * 100}%` : undefined }}>
                        {typeof ev.ext?.done === 'boolean' && <i className="rl-cal-box" title={tr("rk_todo_tick")}>{ev.ext.done ? '☑' : '☐'}</i>}
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
