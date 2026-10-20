import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { typeOf } from './types.jsx'
import { ctxFor, labelOf, valueOf } from './schema.js'
import { load, save, projectKey } from './portal.js'

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
 *   }
 *
 * One bar: the days around (the trip) light gray, the record's own days light
 * in its colour, the marked day strong. A week has room for three lanes at
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
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const GRAY = '#8a94a6'
// How many weeks are drawn around what is on screen, and how many more are
// added when the scroll nears an end.
const BEFORE = 10
const AFTER = 30
const MORE = 16
const LANES = 3        // a week's room, at least, in lanes of 22px

export function RackCalendar({ def, doc, items, query, ctx, picked, onPick, onOpen, onNew, onResize }) {
  const cal = def.calendar
  const idk = def.item.id || 'id'
  const today = fmt(new Date())
  const viewKey = projectKey(def.key, 'calmonth')
  const [month, setMonth] = useState(() => load(viewKey, monthOf(today)))     // the month on screen
  useEffect(() => { save(viewKey, month) }, [viewKey, month])
  const [hidden, setHidden] = useState(() => new Set(load(projectKey(def.key, 'calhide'), [])))
  useEffect(() => { save(projectKey(def.key, 'calhide'), [...hidden]) }, [def.key, hidden])

  // The weeks drawn: [first, count]. Grows at either end as you scroll there.
  const [span, setSpan] = useState(() => [addDays(sunday(`${month}-01`), -7 * BEFORE), BEFORE + AFTER])
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

  const events = useMemo(() => items.map((r) => {
    const id = r[idk]
    const o = over?.id === id ? over : null
    const s = o ? o.start : day(r[cal.start])
    if (!s) return null
    let e = o ? o.end : (day(r[cal.end]) || s)
    if (e < s) e = s
    const ts = cal.outline ? day(r[cal.outline.start]) : ''
    let te = ts ? (day(r[cal.outline.end]) || ts) : ''
    if (te < ts) te = ts
    const mk = cal.mark ? day(r[cal.mark]) : ''
    const g = groupOf(r)
    if (hidden.has(g)) return null
    const ev = { r, id, s, e, ts, te, mk, color: g >= 0 ? cal.groups[g].color : GRAY,
      label: cal.label ? cal.label(r, (k) => textOf(r, k)) : labelOf(def, r) }
    // What is drawn: the record's days, joined to the trip when the two touch;
    // a trip or a marked day that does not touch them is a piece of its own on
    // its own days — never a bar bridging the weeks between.
    const touches = (a, b) => a && b && a <= addDays(e, 1) && b >= addDays(s, -1)
    const main = touches(ts, te) ? { from: min(s, ts), to: max(e, te) } : { from: s, to: e }
    ev.pieces = [{ key: 'main', ...main }]
    if (ts && !touches(ts, te)) ev.pieces.push({ key: 'trip', from: ts, to: te })
    if (mk && (mk < main.from || mk > main.to)) ev.pieces.push({ key: 'mark', from: mk, to: mk })
    return ev
  }).filter(Boolean), [items, over, hidden, doc])   // eslint-disable-line react-hooks/exhaustive-deps

  // While searching: the months that have something found, to step between.
  const found = useMemo(() => (query ? [...new Set(events.map((ev) => monthOf(ev.s)))].sort() : []), [events, query])
  const prevFound = found.filter((m) => m < month).at(-1)
  const nextFound = found.find((m) => m > month)

  // ── scrolling ───────────────────────────────────────────────────────────
  const body = useRef(null)
  const goal = useRef(`${month}-01`)            // a day to bring to the top after the next draw
  const keep = useRef(null)                     // weeks added above: keep what is on screen still
  const goTo = useCallback((ym) => {
    const w = sunday(`${ym}-01`)
    goal.current = w
    setSpan(([a, n]) => {
      const last = addDays(a, 7 * (n - 1))
      if (w >= a && w <= last) return [a, n]
      return [addDays(w, -7 * BEFORE), BEFORE + AFTER]
    })
    setMonth(ym)
  }, [])
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    if (goal.current) {
      const w = el.querySelector(`[data-week="${sunday(goal.current)}"]`)
      if (w) el.scrollTop = w.offsetTop - el.offsetTop
      goal.current = null
    } else if (keep.current != null) {
      el.scrollTop += el.scrollHeight - keep.current
      keep.current = null
    }
  }, [span])
  const onScroll = () => {
    const el = body.current
    if (!el) return
    // The month on screen: the one a week a third of the way down is in.
    const y = el.scrollTop + el.clientHeight / 3
    const ws = [...el.querySelectorAll('[data-week]')].find((w) => w.offsetTop - el.offsetTop + w.offsetHeight > y)
    // A week belongs to the month its Thursday is in.
    if (ws) { const m = monthOf(addDays(ws.dataset.week, 4)); if (m !== month) setMonth(m) }
    // More weeks before or after, before the edge is reached.
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

  // ── dragging: an end of a bar, or days being lit ───────────────────────
  const drag = useRef(null)
  useEffect(() => {
    const move = (e) => {
      const d = drag.current
      if (!d) return
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
      const now = d.now
      if (now && (now.start !== d.start || now.end !== d.end)) {
        Promise.resolve(onResize(d.rec, { [cal.start]: now.start, [cal.end]: now.end === now.start && !d.hadEnd ? '' : now.end }))
          .finally(() => setOver(null))
      } else setOver(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [onNew, onResize, cal])   // eslint-disable-line react-hooks/exhaustive-deps

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
  const barProps = (ev) => ({
    onMouseDown: (e) => e.stopPropagation(),
    onClick: () => onPick(ev.id),
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); hoverOff(); onOpen(ev.id) },
    onMouseEnter: (e) => hoverOn(ev.r, e), onMouseMove: hoverMove, onMouseLeave: hoverOff,
  })

  return (
    <div className="rl-cal">
      <div className="rl-cal-head">
        <h2 className="rl-cal-title">{ty}년 {tm}월</h2>
        <div className="rl-cal-legend">
          {(cal.groups || []).map((g, i) => (
            <button key={g.label} type="button" className={`rl-cal-key${hidden.has(i) ? ' off' : ''}`}
              title={hidden.has(i) ? '보이기' : '감추기'}
              onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}>
              <i style={{ background: g.color }} />{g.label}
            </button>
          ))}
          {/* What the three strengths of one bar mean. */}
          <span className="rl-cal-levels" style={{ '--c': GRAY }}>
            {cal.outline && <><i className="lv1" />출장</>}
            <i className="lv2" />행사
            {cal.mark && <><i className="lv3" />발표</>}
          </span>
        </div>
        <span className="rl-sp" />
        {query && (
          <span className="rl-cal-found">
            <span className="rl-hint">찾은 일정 {events.length}개</span>
            <button type="button" className="rl-btn" disabled={!prevFound} title="앞의 찾은 달"
              onClick={() => goTo(prevFound)}>‹</button>
            <button type="button" className="rl-btn" disabled={!nextFound} title="뒤의 찾은 달"
              onClick={() => goTo(nextFound)}>›</button>
          </span>
        )}
        <span className="rl-cal-nav">
          <button type="button" className="rl-btn" title="이전 달" onClick={() => goTo(shiftMonth(month, -1))}>‹</button>
          <button type="button" className="rl-btn" onClick={() => goTo(monthOf(today))}>오늘</button>
          <button type="button" className="rl-btn" title="다음 달" onClick={() => goTo(shiftMonth(month, 1))}>›</button>
        </span>
      </div>
      <div className="rl-cal-days">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="rl-cal-body" ref={body} onScroll={onScroll}>
        {weeks.map((ws) => {
          const we = addDays(ws, 6)
          const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
          const col = (d) => diff(ws, d)
          // This week's records, longest first, each in the first lane it fits.
          const segs = events.flatMap((ev) => ev.pieces.filter((p) => p.from <= we && p.to >= ws).map((p) => ({ ev, p })))
            .sort((x, y) => diff(y.p.from, y.p.to) - diff(x.p.from, x.p.to) || x.p.from.localeCompare(y.p.from) || x.ev.label.localeCompare(y.ev.label))
          const lanes = []
          const placed = segs.map(({ ev, p }) => {
            const a = col(max(p.from, ws)), b = col(min(p.to, we))
            let lane = lanes.findIndex((used) => used.every(([x, y]) => b < x || a > y))
            if (lane < 0) { lane = lanes.length; lanes.push([]) }
            lanes[lane].push([a, b])
            return { ev, p, a, b, lane }
          })
          // A bar with nothing under it takes the lanes below too — first come,
          // first served, top lanes first — so a lone one-day record has room
          // for its whole name.
          const total = Math.max(lanes.length, LANES)
          const taken = Array.from({ length: total }, (_, i) => (lanes[i] || []).slice())
          for (const s of [...placed].sort((x, y) => x.lane - y.lane)) {
            s.rows = 1
            while (s.lane + s.rows < total && taken[s.lane + s.rows].every(([x, y]) => s.b < x || s.a > y)) {
              taken[s.lane + s.rows].push([s.a, s.b])
              s.rows += 1
            }
          }
          return (
            <div key={ws} className="rl-cal-week" data-week={ws}>
              <div className="rl-cal-cells">
                {days.map((d) => (
                  <div key={d} className={`rl-cal-cell${monthOf(d) !== month ? ' out' : ''}${inSweep(d) ? ' sweep' : ''}`}
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
                    <span className={`rl-cal-num${d === today ? ' today' : ''}`}>
                      {d.slice(8) === '01' ? `${Number(d.slice(5, 7))}월 1일` : `${Number(d.slice(8))}일`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rl-cal-events" style={{ gridTemplateRows: `repeat(${total}, 22px)` }}>
                {placed.map(({ ev, p, a, b, lane, rows }) => {
                  const n = b - a + 1
                  // How each day of the bar is painted: the trip around (light
                  // gray), the record's own days (light), the marked day (strong).
                  const level = (d) => (d === ev.mk ? 3 : d >= ev.s && d <= ev.e ? 2 : ev.ts && d >= ev.ts && d <= ev.te ? 1 : 0)
                  // The ends that stretch are the record's own, and only on its main piece.
                  const own = p.key === 'main'
                  const sIn = own && ev.s >= ws && ev.s <= we, eIn = own && ev.e >= ws && ev.e <= we
                  return (
                    <div key={`${ev.id}:${p.key}`} className={`rl-cal-bar${picked?.has(ev.id) ? ' on' : ''}${p.from < ws ? ' cont-l' : ''}${p.to > we ? ' cont-r' : ''}${rows > 1 ? ' tall' : ''}`}
                      style={{ '--c': ev.color, gridRow: `${lane + 1} / span ${rows}`, gridColumn: `${a + 1} / ${b + 2}`, '--lines': Math.floor((rows * 22 + (rows - 1) * 2 - 4) / 15) }} {...barProps(ev)}>
                      <span className="rl-cal-fill">
                        {Array.from({ length: n }, (_, i) => <i key={i} className={`lv${level(addDays(ws, a + i))}`} />)}
                      </span>
                      <span className="rl-cal-label">{ev.label}</span>
                      {sIn && (
                        <b className="rl-cal-grip" style={{ left: `${((col(ev.s) - a) / n) * 100}%` }} title="시작을 옮기기"
                          onMouseDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); hoverOff(); drag.current = { kind: 'end', edge: 'start', id: ev.id, rec: ev.r, start: ev.s, end: ev.e, hadEnd: !!day(ev.r[cal.end]) } }} />
                      )}
                      {eIn && (
                        <b className="rl-cal-grip" style={{ left: `calc(${((col(ev.e) - a + 1) / n) * 100}% - 6px)` }} title="끝을 옮기기"
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
