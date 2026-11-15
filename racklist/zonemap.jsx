import './strings.js'
import { useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { CITIES, kstGap, stdHours } from './zone.js'

/** Which zones the calendar's menu offers, picked on a map: a place under the
 *  pointer says where it is, what time it is there and how far from Seoul; a
 *  press puts it in the list or takes it out. The list below keeps the order
 *  the menu shows, and ‹ › move one along it. Under the pointer, a city or any
 *  spot lights its zone's area (tzareas.js: by standard offset, so summer time
 *  and two zones of one offset are not told apart). The land and the areas
 *  (worldmap.js, tzareas.js, ~120KB) are read only when this opens. */
const X = (lon) => (lon + 180) * 2, Y = (lat) => (90 - lat) * 2
const sign = (h) => `${h < 0 ? '−' : '+'}${Math.abs(h)}`
// The time in an area that keeps standard time `h` hours from UTC.
const areaClock = (h) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).format(new Date(Date.now() + h * 36e5))
const clock = (zone) => { try { return new Intl.DateTimeFormat('ko-KR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).format(new Date()) } catch { return '' } }

export function ZoneMap({ zones, onChange, onClose }) {
  const [land, setLand] = useState('')
  const [areas, setAreas] = useState([])
  const [hover, setHover] = useState(null)      // a city under the pointer
  const [area, setArea] = useState(null)        // else the standard offset of the area under it
  useEffect(() => {
    import('./worldmap.js').then((m) => setLand(m.LAND)).catch(() => {})
    import('./tzareas.js').then((m) => setAreas(m.AREAS)).catch(() => {})
  }, [])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const has = (c) => zones.some((z) => z.zone === c[0] && z.name === c[1])
  const toggle = (c) => onChange(has(c) ? zones.filter((z) => !(z.zone === c[0] && z.name === c[1])) : [...zones, { zone: c[0], name: c[1] }])
  const move = (i, d) => { const l = [...zones]; [l[i], l[i + d]] = [l[i + d], l[i]]; onChange(l) }
  // The area lit: the one under the pointer, or the one the city under it keeps.
  const lit = hover ? stdHours(hover[0]) : area
  const says = hover ? `${hover[1]} · ${kstGap(hover[0])} · ${clock(hover[0])} · ${hover[0]}${has(hover) ? ` — ${tr('rk_zone_in')}` : ''}`
    : area != null ? `UTC${sign(area)} · KST${sign(area - 9)} · ${areaClock(area)} · ${tr('rk_zone_std')}` : tr('rk_zone_map_hint')
  return (
    <div className="rl-zmap-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rl-zmap" role="dialog" aria-label={tr('rk_zone_map')}>
        <div className="rl-zmap-top">
          <b>{tr('rk_zone_map')}</b>
          <span className="rl-hint">{says}</span>
          <button type="button" className="rl-btn" onClick={onClose}>{tr('rk_done')}</button>
        </div>
        <svg className="rl-zmap-svg" viewBox="0 0 720 300" onMouseLeave={() => { setHover(null); setArea(null) }}>
          <path className="rl-zmap-land" d={land} />
          {/* The zones by standard offset, every other one faintly tinted so their edges show. */}
          {areas.map(([h, d], i) => (
            <path key={h} d={d} className={`rl-zmap-area${i % 2 ? ' odd' : ''}${lit === h ? ' lit' : ''}`}
              onMouseEnter={() => { setHover(null); setArea(h) }} />
          ))}
          {CITIES.map((c) => {
            const on = has(c), lit = hover === c || (hover && hover[0] === c[0])
            return (
              <g key={`${c[0]}|${c[1]}`} className={`rl-zmap-city${on ? ' on' : ''}${lit ? ' lit' : ''}`}
                transform={`translate(${X(c[3])} ${Y(c[2])})`} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)} onClick={() => toggle(c)}>
                <circle r="9" className="rl-zmap-hit" />
                <circle r={on ? 4 : 3} />
                {(on || hover === c) && <text y="-7">{c[1]}</text>}
              </g>
            )
          })}
        </svg>
        <div className="rl-zmap-list">
          {zones.map((z, i) => (
            <span key={`${z.zone}|${z.name}`} className="rl-tag">
              <button type="button" className="rl-x" disabled={!i} title={tr('rk_zone_left')} onClick={() => move(i, -1)}>‹</button>
              {z.name} · {kstGap(z.zone)}
              <button type="button" className="rl-x" disabled={i === zones.length - 1} title={tr('rk_zone_right')} onClick={() => move(i, 1)}>›</button>
              <button type="button" className="rl-x" title={tr('rk_zone_out')} onClick={() => onChange(zones.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {!zones.length && <span className="rl-hint">{tr('rk_zone_none')}</span>}
        </div>
      </div>
    </div>
  )
}
