/**
 * A list shown in a time zone of the viewer's choosing (def.zone). What is
 * stored stays in `home` (activity: Asia/Seoul, as Google sync writes it): the
 * records are moved into the chosen zone as they are read, and the ones an edit
 * touched are moved back as they are saved. Changing the zone moves every time
 * with it; a day with no time is a day anywhere and does not move.
 *
 *   zone: { home: 'Asia/Seoul',
 *           pairs: [['start', 'startTime'], ['end', 'endTime', 'start'], …],  // [day, time, day it falls back to]
 *           repeat: 'repeat', series: 'series', seriesDate: 'seriesDate' }
 */
import { load, save, authHeaders } from './portal.js'
import { useCallback, useEffect, useState } from 'react'

/** The zones the menu offers until an account picks its own (on the map): [{ zone, name }]. */
export const ZONES = [
  { zone: 'Asia/Seoul', name: '서울' }, { zone: 'Asia/Tokyo', name: '도쿄' }, { zone: 'Asia/Shanghai', name: '베이징' },
  { zone: 'America/Chicago', name: '텍사스' }, { zone: 'America/Detroit', name: '미시간' },
]
/** The places on the map: [zone, name, lat, lon]. A place is how a person finds a zone. */
export const CITIES = [
  ['Asia/Seoul', '서울', 37.57, 126.98], ['Asia/Tokyo', '도쿄', 35.68, 139.69], ['Asia/Shanghai', '베이징', 39.9, 116.4],
  ['Asia/Shanghai', '란저우', 36.06, 103.83], ['Asia/Taipei', '타이베이', 25.03, 121.56], ['Asia/Hong_Kong', '홍콩', 22.32, 114.17],
  ['Asia/Ho_Chi_Minh', '하노이', 21.03, 105.85], ['Asia/Bangkok', '방콕', 13.76, 100.5], ['Asia/Singapore', '싱가포르', 1.35, 103.82],
  ['Asia/Kolkata', '뉴델리', 28.61, 77.21], ['Asia/Dubai', '두바이', 25.2, 55.27], ['Europe/Moscow', '모스크바', 55.76, 37.62],
  ['Europe/Istanbul', '이스탄불', 41.01, 28.98], ['Africa/Cairo', '카이로', 30.04, 31.24], ['Africa/Johannesburg', '요하네스버그', -26.2, 28.05],
  ['Europe/Helsinki', '위배스퀼레', 62.24, 25.75], ['Europe/Berlin', '다름슈타트', 49.87, 8.65], ['Europe/Zurich', '제네바', 46.2, 6.14],
  ['Europe/Rome', '로마', 41.9, 12.5], ['Europe/Paris', '파리', 48.86, 2.35], ['Europe/Paris', '칸', 49.18, -0.37],
  ['Europe/Madrid', '마드리드', 40.42, -3.7], ['Europe/London', '런던', 51.51, -0.13], ['America/Sao_Paulo', '상파울루', -23.55, -46.63],
  ['America/Argentina/Buenos_Aires', '부에노스아이레스', -34.6, -58.38], ['America/New_York', '뉴욕', 40.71, -74.01],
  ['America/Toronto', '토론토', 43.65, -79.38], ['America/Detroit', '미시간', 42.73, -84.48], ['America/Chicago', '시카고', 41.71, -87.98],
  ['America/Chicago', '텍사스', 30.62, -96.34], ['America/Mexico_City', '멕시코시티', 19.43, -99.13], ['America/Denver', '덴버', 39.74, -104.99],
  ['America/Los_Angeles', 'LA', 34.05, -118.24], ['America/Los_Angeles', '버클리', 37.87, -122.27], ['America/Vancouver', '밴쿠버', 49.25, -123.23],
  ['Pacific/Honolulu', '호놀룰루', 21.31, -157.86], ['Australia/Perth', '퍼스', -31.95, 115.86], ['Australia/Sydney', '시드니', -33.87, 151.21],
  ['Pacific/Auckland', '오클랜드', -36.85, 174.76],
]
/** A zone's standard offset from UTC in hours (summer time not counted): the smaller of January's and July's. */
export const stdHours = (zone) => {
  const y = new Date().getUTCFullYear()
  return Math.min(offset(zone, Date.UTC(y, 0, 15)), offset(zone, Date.UTC(y, 6, 15))) / 36e5
}
/** How far `zone` is from Seoul right now (summer time counted): 'KST', 'KST−14', 'KST+0'. */
export const kstGap = (zone, now = Date.now()) => {
  if (zone === 'Asia/Seoul') return 'KST'
  const h = Math.round((offset(zone, now) - offset('Asia/Seoul', now)) / 36e5 * 2) / 2
  return `KST${h < 0 ? '−' : '+'}${Math.abs(h)}`
}
/** `[zone, label]` for the menu: the list, then the browser's own zone and the one
 *  chosen when they are not in it. */
export const zoneChoices = (chosen = '', list = ZONES) => {
  let own = ''
  try { own = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* none */ }
  const extra = [own, chosen].filter((z, i, a) => z && a.indexOf(z) === i && !list.some((x) => x.zone === z))
    .map((z) => ({ zone: z, name: CITIES.find((c) => c[0] === z)?.[1] || z.split('/').pop().replace(/_/g, ' ') }))
  const seen = new Set()
  return [...list, ...extra].filter((x) => !seen.has(x.zone) && seen.add(x.zone)).map((x) => [x.zone, `${x.name} · ${kstGap(x.zone)}`])
}

const fmts = new Map()
const partsAt = (tz, ms) => {
  let f = fmts.get(tz)
  if (!f) fmts.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))
  return Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]))
}
const offset = (tz, ms) => {
  const p = partsAt(tz, ms)
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ms
}
/** The wall clock `d t` in zone `from`, read in zone `to`: { d, t }. */
export function moveWall(d, t, from, to) {
  if (from === to) return { d, t }
  const [y, m, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number)
  const w = Date.UTC(y, m - 1, dd, h, mi)
  const ms = w - offset(from, w - offset(from, w))
  const p = partsAt(to, ms)
  return { d: `${p.year}-${p.month}-${p.day}`, t: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` }
}

const DAY = 864e5
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
export const shiftDay = (d, n) => (n ? new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10) : d)
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
/** A rule's days moved n days on: a weekly Wednesday 09:00 in Seoul is a Tuesday in Texas.
 *  ponytail: BYDAY, BYMONTHDAY and UNTIL's day move; a sitting that crosses midnight
 *  differently from the first (a DST change) is drawn at the first one's time. */
export function shiftRule(rule, n) {
  if (!n || !rule) return rule
  return String(rule).split(';').map((part) => {
    const [k, v] = part.split('=')
    const K = (k || '').toUpperCase()
    if (K === 'BYDAY') return `${k}=${v.split(',').map((x) => x.replace(/(SU|MO|TU|WE|TH|FR|SA)$/i, (d) => WD[(WD.indexOf(d.toUpperCase()) + n % 7 + 7) % 7])).join(',')}`
    if (K === 'BYMONTHDAY') return `${k}=${v.split(',').map((x) => { const m = Number(x); return m > 0 ? Math.min(31, Math.max(1, m + n)) : m }).join(',')}`
    if (K === 'UNTIL' && /^\d{8}/.test(v)) { const d = shiftDay(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, n).replace(/-/g, ''); return `${k}=${d}${v.slice(8)}` }
    return part
  }).join(';')
}

const hhmm = (t) => (/^\d{1,2}:\d{2}/.test(String(t || '')) ? String(t).replace(/^(\d):/, '0$1:').slice(0, 5) : '')

/** How many days a record's first pair moves going from → to (0 with no time). */
function startShift(z, r, from, to) {
  const [dk, tk] = z.pairs[0]
  const d = String(r?.[dk] || '').slice(0, 10), t = hhmm(r?.[tk])
  return d && t ? dayDiff(d, moveWall(d, t, from, to).d) : 0
}

/** One record read in zone `to` instead of `from`. byId: id → record, in `from` (a series). */
export function moveRec(z, r, from, to, byId = () => null) {
  if (from === to || !r) return r
  const out = { ...r }
  for (const [dk, tk, fb] of z.pairs) {
    const t = hhmm(r[tk])
    const own = String(r[dk] || '').slice(0, 10)
    const base = own || String((fb && r[fb]) || '').slice(0, 10)
    if (!t || !base) continue
    const w = moveWall(base, t, from, to)
    out[tk] = w.t
    // A day it only borrowed (no end of its own) stays unwritten while it lands
    // on the same day as the one it borrowed from.
    out[dk] = own || (fb && w.d !== String(out[fb] || '').slice(0, 10)) ? w.d : r[dk]
  }
  const n = startShift(z, r, from, to)
  const rp = z.repeat && r[z.repeat]
  if (n && rp?.rule) out[z.repeat] = { ...rp, rule: shiftRule(rp.rule, n), ex: (rp.ex || []).map((d) => shiftDay(d, n)) }
  const s = z.series && (r[z.series]?.id ?? r[z.series])
  if (s && z.seriesDate && r[z.seriesDate]) out[z.seriesDate] = shiftDay(String(r[z.seriesDate]).slice(0, 10), startShift(z, byId(String(s)), from, to))
  return out
}

/** The document as zone `zone` reads it, and how to put an edit of it back. */
export function zoneView(def, doc, zone) {
  const z = def.zone, key = def.item.key, idk = def.item.id || 'id'
  if (!z || !doc || !zone || zone === z.home || !Array.isArray(doc[key])) return { doc, back: (p) => p }
  const raw = doc[key]
  const rawById = new Map(raw.map((r) => [String(r[idk]), r]))
  const was = new Map()                               // shown → stored, for what an edit left alone
  const items = raw.map((r) => { const v = moveRec(z, r, z.home, zone, (id) => rawById.get(id)); was.set(v, r); return v })
  const back = (patch) => {
    if (!patch || !Array.isArray(patch[key])) return patch
    const shown = new Map(patch[key].map((r) => [String(r[idk]), r]))
    return { ...patch, [key]: patch[key].map((r) => was.get(r) || moveRec(z, r, zone, z.home, (id) => shown.get(id))) }
  }
  return { doc: { ...doc, [key]: items }, back }
}

/** The zone times are read in and the zones the menu offers: the ACCOUNT's (portal
 *  prefs.zone / prefs.zones, set in a calendar's menu and its map), the same in every
 *  browser; until it says, the copy this browser kept, else the list's own (home). One
 *  for the page; a solo editor framed in it follows a change. */
const CACHE = 'lilak.zone', LIST = 'lilak.zones'
let prefsAsk = null
const zoneSeen = new Set()
const askPrefs = () => (prefsAsk ||= fetch('/api/account/prefs', { headers: authHeaders() })
  .then((r) => (r.ok ? r.json() : null))
  .then((x) => ({ zone: x?.prefs?.zone || '', zones: x?.prefs?.zones || null }))
  .catch(() => ({ zone: load(CACHE, ''), zones: load(LIST, null) })))
const putPrefs = (body) => fetch('/api/account/prefs', { method: 'PUT',
  headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
export function useZone(def) {
  const home = def.zone?.home || ''
  const [zone, setZ] = useState(() => (home ? load(CACHE, '') || home : ''))
  const [zones, setL] = useState(() => load(LIST, null) || ZONES)
  useEffect(() => {
    if (!home) return undefined
    const take = (p) => {
      if ('zone' in p) setZ(p.zone || home)
      if ('zones' in p) setL(p.zones?.length ? p.zones : ZONES)
    }
    zoneSeen.add(take)
    askPrefs().then((p) => { save(CACHE, p.zone); save(LIST, p.zones); take(p) })
    const on = (e) => {
      if (e.key === CACHE) take({ zone: load(CACHE, '') })
      if (e.key === LIST) take({ zones: load(LIST, null) })
    }
    window.addEventListener('storage', on)
    return () => { zoneSeen.delete(take); window.removeEventListener('storage', on) }
  }, [home])
  const tell = (p) => {
    prefsAsk = askPrefs().then((was) => ({ ...was, ...p }))
    zoneSeen.forEach((f) => f(p))
    putPrefs(p)
  }
  const setZone = useCallback((z) => { save(CACHE, z); tell({ zone: z }) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const setZones = useCallback((l) => { save(LIST, l); tell({ zones: l }) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return [zone, setZone, zones, setZones]
}
