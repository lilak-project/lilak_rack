import { useEffect, useMemo, useRef, useState } from 'react'
import { typeOf } from './types.jsx'
import { ctxFor, labelOf, valueOf } from './schema.js'
import { load, save, projectKey } from './portal.js'

/**
 * [달력] — a month of records with dates, the way Apple's Calendar lays one
 * out: a row per week, a bar per record running from its start to its end.
 * Declared on the service:
 *
 *   calendar: {
 *     start: 'start', end: 'end',            // the bar
 *     mark: 'talkDate',                       // a day inside it, in a strong colour
 *     outline: { start: 'tripStart', end: 'tripEnd' },   // a range drawn as a border
 *     groups: [{ label, color, match: (rec) => bool }],  // colours, and the legend
 *     label: (rec, text) => string,           // text(k) is field k as the table says it
 *   }
 *
 * A week is as tall as its records need — nothing is folded into "…". A record
 * without a start is not on it.
 *
 *   left-click a bar      picks it (as in the table)
 *   right-click a bar     opens it in the editor
 *   hover half a second   what the editor shows, in a small box
 *   drag a bar's end      moves that end
 *   drag across days      a new record from the first day to the last
 *   right-click a day     a new record starting that day
 */
const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '')
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d) }
const diff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000)
const min = (...xs) => xs.filter(Boolean).sort()[0]
const max = (...xs) => xs.filter(Boolean).sort().at(-1)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const GRAY = '#8a94a6'

/** The weeks a month's grid shows: Sunday first, whole weeks. */
function weeksOf(ym) {
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const last = new Date(y, m, 0)
  let s = fmt(new Date(y, m - 1, 1 - first.getDay()))
  const end = fmt(new Date(y, m - 1, last.getDate() + (6 - last.getDay())))
  const out = []
  while (s <= end) { out.push(s); s = addDays(s, 7) }
  return out
}
const monthOf = (s) => s.slice(0, 7)
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }

export function RackCalendar({ def, doc, items, query, ctx, picked, onPick, onOpen, onNew, onResize }) {
  const cal = def.calendar
  const idk = def.item.id || 'id'
  const today = fmt(new Date())
  const viewKey = projectKey(def.key, 'calmonth')
  const [month, setMonth] = useState(() => load(viewKey, monthOf(today)))
  useEffect(() => { save(viewKey, month) }, [viewKey, month])
  const [hidden, setHidden] = useState(() => new Set(load(projectKey(def.key, 'calhide'), [])))
  useEffect(() => { save(projectKey(def.key, 'calhide'), [...hidden]) }, [def.key, hidden])

  // What a field says, the way the table says it.
  const textOf = (r, k) => {
    const f = def.item.fields.find((x) => x.k === k)
    if (!f) return String(r?.[k] ?? '')
    const c = ctxFor(def, doc, f, ctx)
    return typeOf(f).text(valueOf(f, r, c), c)
  }
  const groupOf = (r) => cal.groups?.findIndex((g) => g.match(r)) ?? -1
  const colorOf = (r) => { const g = groupOf(r); return g >= 0 ? cal.groups[g].color : GRAY }

  // A bar's end being dragged: what it would be, shown before it is saved.
  const [over, setOver] = useState(null)        // { id, start, end }
  // A range being dragged across empty days.
  const [sweep, setSweep] = useState(null)      // { from, to }

  const events = useMemo(() => items.map((r) => {
    const id = r[idk]
    const o = over?.id === id ? over : null
    const s = o ? o.start : day(r[cal.start])
    if (!s) return null
    let e = o ? o.end : (day(r[cal.end]) || s)
    if (e < s) e = s
    const ts = cal.outline ? day(r[cal.outline.start]) : ''
    const te = ts ? (day(r[cal.outline.end]) || ts) : ''
    const mk = cal.mark ? day(r[cal.mark]) : ''
    const g = groupOf(r)
    if (hidden.has(g)) return null
    return { r, id, s, e, ts, te: te < ts ? ts : te, mk, from: min(s, ts, mk), to: max(e, te, mk), color: colorOf(r),
      label: cal.label ? cal.label(r, (k) => textOf(r, k)) : labelOf(def, r) }
  }).filter(Boolean), [items, over, hidden, doc])   // eslint-disable-line react-hooks/exhaustive-deps

  // While searching: the months that have something found, to step between.
  const found = useMemo(() => (query ? [...new Set(events.map((ev) => monthOf(ev.s)))].sort() : []), [events, query])
  const prevFound = found.filter((m) => m < month).at(-1)
  const nextFound = found.find((m) => m > month)

  const weeks = useMemo(() => weeksOf(month), [month])

  // The day under the pointer, from the week it is over and how far across.
  const dayAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-week]')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const col = Math.max(0, Math.min(6, Math.floor(((e.clientX - rect.left) / rect.width) * 7)))
    return addDays(el.dataset.week, col)
  }

  // ── dragging: an end of a bar, or a sweep over empty days ─────────────
  const drag = useRef(null)
  useEffect(() => {
    const move = (e) => {
      const d = drag.current
      if (!d) return
      const at = dayAt(e)
      if (!at) return
      if (d.kind === 'sweep') { setSweep({ from: d.from, to: at }); return }
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
      if (d.kind === 'sweep') {
        setSweep((sw) => {
          if (sw && sw.from !== sw.to) {
            const [a, b] = [sw.from, sw.to].sort()
            setTimeout(() => onNew({ [cal.start]: a, [cal.end]: b }), 0)
          }
          return null
        })
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
  }, [onNew, onResize, cal])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── hovering: what the editor shows, after half a second ──────────────
  const [peek, setPeek] = useState(null)        // { r, x, y }
  const timer = useRef(null)
  const hoverOn = (r, e) => {
    clearTimeout(timer.current)
    const at = { x: e.clientX, y: e.clientY }
    timer.current = setTimeout(() => setPeek({ r, ...at }), 500)
  }
  const hoverMove = (e) => setPeek((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))
  const hoverOff = () => { clearTimeout(timer.current); setPeek(null) }
  useEffect(() => () => clearTimeout(timer.current), [])

  const inSweep = (d) => sweep && d >= min(sweep.from, sweep.to) && d <= max(sweep.from, sweep.to)
  const [ty, tm] = month.split('-').map(Number)

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
        </div>
        <span className="rl-sp" />
        {query && (
          <span className="rl-cal-found">
            <span className="rl-hint">찾은 일정 {events.length}개</span>
            <button type="button" className="rl-btn" disabled={!prevFound} title="앞의 찾은 달"
              onClick={() => setMonth(prevFound)}>‹</button>
            <button type="button" className="rl-btn" disabled={!nextFound} title="뒤의 찾은 달"
              onClick={() => setMonth(nextFound)}>›</button>
          </span>
        )}
        <span className="rl-cal-nav">
          <button type="button" className="rl-btn" title="이전 달" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
          <button type="button" className="rl-btn" onClick={() => setMonth(monthOf(today))}>오늘</button>
          <button type="button" className="rl-btn" title="다음 달" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
        </span>
      </div>
      <div className="rl-cal-days">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="rl-cal-body">
        {weeks.map((ws) => {
          const we = addDays(ws, 6)
          const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
          const col = (d) => diff(ws, d)
          // This week's records, longest first, each in the first lane it fits.
          const segs = events.filter((ev) => ev.from <= we && ev.to >= ws)
            .sort((a, b) => diff(b.from, b.to) - diff(a.from, a.to) || a.s.localeCompare(b.s) || a.label.localeCompare(b.label))
          const lanes = []
          for (const ev of segs) {
            const c0 = col(max(ev.from, ws)), c1 = col(min(ev.to, we))
            let lane = lanes.findIndex((used) => used.every(([a, b]) => c1 < a || c0 > b))
            if (lane < 0) { lane = lanes.length; lanes.push([]) }
            lanes[lane].push([c0, c1])
            ev.lane = lane
          }
          return (
            <div key={ws} className="rl-cal-week" data-week={ws}>
              <div className="rl-cal-cells">
                {days.map((d) => (
                  <div key={d} className={`rl-cal-cell${monthOf(d) !== month ? ' out' : ''}${inSweep(d) ? ' sweep' : ''}`}
                    onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); drag.current = { kind: 'sweep', from: d }; setSweep({ from: d, to: d }) } }}
                    onContextMenu={(e) => { e.preventDefault(); onNew({ [cal.start]: d }) }}>
                    <span className={`rl-cal-num${d === today ? ' today' : ''}`}>
                      {d.slice(8) === '01' ? `${Number(d.slice(5, 7))}월 1일` : `${Number(d.slice(8))}일`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rl-cal-events" style={{ gridTemplateRows: `repeat(${Math.max(lanes.length, 1)}, 22px)` }}>
                {segs.map((ev) => {
                  const row = ev.lane + 1
                  const on = picked?.has(ev.id)
                  const style = { '--c': ev.color }
                  const out = []
                  if (ev.ts && ev.ts <= we && ev.te >= ws) {
                    const a = col(max(ev.ts, ws)), b = col(min(ev.te, we))
                    out.push(<div key="trip" className="rl-cal-trip" style={{ ...style, gridRow: row, gridColumn: `${a + 1} / ${b + 2}` }}
                      title="출장 기간" />)
                  }
                  if (ev.s <= we && ev.e >= ws) {
                    const a = col(max(ev.s, ws)), b = col(min(ev.e, we))
                    const n = b - a + 1
                    const mi = ev.mk && ev.mk >= ev.s && ev.mk <= ev.e && ev.mk >= ws && ev.mk <= we ? col(ev.mk) - a : -1
                    out.push(
                      <div key="bar" className={`rl-cal-bar${on ? ' on' : ''}${ev.s < ws ? ' cont-l' : ''}${ev.e > we ? ' cont-r' : ''}`}
                        style={{ ...style, gridRow: row, gridColumn: `${a + 1} / ${b + 2}` }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => onPick(ev.id)}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); hoverOff(); onOpen(ev.id) }}
                        onMouseEnter={(e) => hoverOn(ev.r, e)} onMouseMove={hoverMove} onMouseLeave={hoverOff}>
                        {mi >= 0 && <i className="rl-cal-mark" style={{ left: `${(mi / n) * 100}%`, width: `${100 / n}%` }} />}
                        <span className="rl-cal-label">{ev.label}</span>
                        {ev.s >= ws && (
                          <b className="rl-cal-grip l" title="시작을 옮기기"
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); hoverOff(); drag.current = { kind: 'end', edge: 'start', id: ev.id, rec: ev.r, start: ev.s, end: ev.e, hadEnd: !!day(ev.r[cal.end]) } }} />
                        )}
                        {ev.e <= we && (
                          <b className="rl-cal-grip r" title="끝을 옮기기"
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); hoverOff(); drag.current = { kind: 'end', edge: 'end', id: ev.id, rec: ev.r, start: ev.s, end: ev.e, hadEnd: true } }} />
                        )}
                      </div>,
                    )
                  }
                  // A talk outside the meeting's days: its day alone, strong.
                  if (ev.mk && (ev.mk < ev.s || ev.mk > ev.e) && ev.mk >= ws && ev.mk <= we) {
                    out.push(<div key="mk" className={`rl-cal-bar solo${on ? ' on' : ''}`} style={{ ...style, gridRow: row, gridColumn: `${col(ev.mk) + 1} / ${col(ev.mk) + 2}` }}
                      onMouseDown={(e) => e.stopPropagation()} onClick={() => onPick(ev.id)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); hoverOff(); onOpen(ev.id) }}
                      onMouseEnter={(e) => hoverOn(ev.r, e)} onMouseMove={hoverMove} onMouseLeave={hoverOff}>
                      <span className="rl-cal-label">{ev.label}</span>
                    </div>)
                  }
                  return out
                })}
              </div>
            </div>
          )
        })}
      </div>
      {peek && <Peek def={def} doc={doc} ctx={ctx} r={peek.r} x={peek.x} y={peek.y} />}
    </div>
  )
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
