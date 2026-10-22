/**
 * Repeating records — the rule Google Calendar (and every iCalendar reader)
 * writes, RFC 5545's RRULE, kept as that text so it goes to Google and back
 * unchanged. A record that repeats holds { rule: 'FREQ=WEEKLY;BYDAY=TU', ex:
 * ['2026-11-03'] } — the rule, and the days taken out of it (EXDATE).
 *
 * What is understood: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY
 * (TU, and in a month or year 1SU / -1FR), BYMONTHDAY (14, -1), BYMONTH,
 * COUNT, UNTIL, WKST. That is what Google's own editor writes; a rule with
 * more than that still repeats, by the parts read.
 *
 * Days are 'YYYY-MM-DD' strings throughout, as the calendar's are.
 */
import './strings.js'
import { tr } from '../i18n.jsx'

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
/** A weekday's short name, 0 = Sunday, in the active language. */
const dow = (d) => tr(`rk_dow_${d}`)

const day = (d) => new Date(`${d}T00:00:00Z`)
const iso = (t) => t.toISOString().slice(0, 10)
const add = (d, n) => { const t = day(d); t.setUTCDate(t.getUTCDate() + n); return iso(t) }
const ymd = (y, m, dd) => iso(new Date(Date.UTC(y, m - 1, dd)))
const inMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** UNTIL as a day in Korea: 20240721T145959Z is the 21st there (23:59). */
function untilDay(v) {
  if (!v) return ''
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return ''
  if (!m[4] || !m[7]) return `${m[1]}-${m[2]}-${m[3]}`
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 9 * 3600e3)
  return iso(t)
}

export function parseRule(text) {
  const o = {}
  for (const part of String(text || '').replace(/^RRULE:/i, '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) o[part.slice(0, i).toUpperCase()] = part.slice(i + 1)
  }
  return {
    freq: (o.FREQ || '').toUpperCase(),
    interval: Math.max(1, parseInt(o.INTERVAL, 10) || 1),
    count: o.COUNT ? parseInt(o.COUNT, 10) : 0,
    until: untilDay(o.UNTIL),
    byday: (o.BYDAY ? o.BYDAY.split(',') : []).map((x) => {
      const m = x.trim().toUpperCase().match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/)
      return m ? { n: m[1] ? parseInt(m[1], 10) : 0, d: DAYS.indexOf(m[2]) } : null
    }).filter(Boolean),
    bymonthday: (o.BYMONTHDAY ? o.BYMONTHDAY.split(',') : []).map(Number).filter(Boolean),
    bymonth: (o.BYMONTH ? o.BYMONTH.split(',') : []).map(Number).filter(Boolean),
    wkst: Math.max(0, DAYS.indexOf((o.WKST || 'MO').toUpperCase())),
  }
}

/** The days of month (y, m) the rule picks, given the first day's day of month. */
function monthDays(r, y, m, dom) {
  const len = inMonth(y, m)
  if (r.bymonthday.length) {
    return r.bymonthday.map((n) => (n > 0 ? n : len + n + 1)).filter((n) => n >= 1 && n <= len).map((n) => ymd(y, m, n))
  }
  if (r.byday.length) {
    const out = []
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
    for (const { n, d } of r.byday) {
      const all = []
      for (let k = 1 + ((d - first + 7) % 7); k <= len; k += 7) all.push(k)
      const pick = n === 0 ? all : n > 0 ? [all[n - 1]] : [all[all.length + n]]
      for (const k of pick) if (k) out.push(ymd(y, m, k))
    }
    return out
  }
  return dom <= len ? [ymd(y, m, dom)] : []
}

/** The days in from..to a rule starting on `start` falls on, the days in
 *  `ex` left out. COUNT counts from the start, the left-out days among them. */
export function occurrences(start, rule, from, to, ex = []) {
  const r = typeof rule === 'string' ? parseRule(rule) : rule
  if (!r?.freq || !start || to < start) return []
  const skip = new Set(ex)
  const out = []
  let n = 0
  const [sy, sm, sd] = start.split('-').map(Number)
  const sdow = day(start).getUTCDay()
  // Each period's candidate days, in order; false once nothing more can come.
  const take = (days) => {
    for (const d of [...new Set(days)].sort()) {
      if (d < start) continue
      if ((r.until && d > r.until) || (r.count && n >= r.count) || d > to) return false
      n += 1
      if (d >= from && !skip.has(d)) out.push(d)
    }
    return true
  }
  for (let p = 0; p < 20000; p += 1) {
    let days = []
    if (r.freq === 'DAILY') {
      days = [add(start, p * r.interval)]
    } else if (r.freq === 'WEEKLY') {
      const week = add(start, -((sdow - r.wkst + 7) % 7) + p * 7 * r.interval)
      const want = r.byday.length ? r.byday.map((x) => x.d) : [sdow]
      days = want.map((d) => add(week, (d - r.wkst + 7) % 7))
    } else if (r.freq === 'MONTHLY') {
      const k = sm - 1 + p * r.interval
      days = monthDays(r, sy + Math.floor(k / 12), (k % 12) + 1, sd)
    } else if (r.freq === 'YEARLY') {
      const y = sy + p * r.interval
      const months = r.bymonth.length ? r.bymonth : [sm]
      days = months.flatMap((m) => monthDays(r, y, m, sd))
    } else return out
    if (!take(days)) return out
  }
  return out
}

/** The rule said in words: 매주 화요일, 2개월마다 첫째 일요일, 매월 14일 · 10회 —
 *  "every week on Tue", "every 2 months on the 1st Sun" in English. Each piece
 *  is a dictionary entry, so a language puts the pieces in its own order. */
export function describe(rule, start = '') {
  const r = typeof rule === 'string' ? parseRule(rule) : rule
  if (!r?.freq) return ''
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq)) return tr('rk_repeat')
  const head = r.interval > 1 ? tr(`rk_every_n_${r.freq}`, r.interval) : tr(`rk_every_${r.freq}`)
  let what = ''
  if (r.byday.length) {
    what = tr('rk_on_weekdays', r.byday.map(({ n, d }) => (n ? tr('rk_nth_day', nth(n), dow(d)) : dow(d))).join('·'))
  } else if (r.bymonthday.length) {
    what = r.bymonthday.map((n) => (n > 0 ? tr('rk_day_n', n) : tr('rk_last_day'))).join('·')
  } else if (start) {
    const [, m, d] = start.split('-').map(Number)
    what = r.freq === 'WEEKLY' ? tr('rk_on_weekdays', dow(day(start).getUTCDay())) : r.freq === 'MONTHLY' ? tr('rk_day_n', d)
      : r.freq === 'YEARLY' ? tr('rk_month_day', m, d) : ''
  }
  if (r.freq === 'YEARLY' && r.bymonth.length && (r.byday.length || r.bymonthday.length)) {
    what = tr('rk_in_months', r.bymonth.join('·'), what)
  }
  const end = r.until ? tr('rk_until', r.until) : r.count ? tr('rk_times', r.count) : ''
  return `${head}${what ? ` ${what}` : ''}${end}`
}

/** The rule with its end put at a day (and no count) — or its count set. */
const setPart = (rule, key, val) => {
  const parts = String(rule || '').replace(/^RRULE:/i, '').split(';').filter((p) => p && !/^(UNTIL|COUNT)=/i.test(p))
  return [...parts, ...(val ? [`${key}=${val}`] : [])].join(';')
}
export const withUntil = (rule, d) => setPart(rule, 'UNTIL', d ? d.replace(/-/g, '') : '')
export const withCount = (rule, n) => setPart(rule, 'COUNT', n > 0 ? String(n) : '')
export const withoutEnd = (rule) => setPart(rule, '', '')
/** 1st … 5th, or last (-1). */
export const nth = (n) => (n === -1 ? tr('rk_nth_last') : n >= 1 && n <= 5 ? tr(`rk_nth_${n}`) : tr('rk_nth_n', n))
export { DAYS, dow }
