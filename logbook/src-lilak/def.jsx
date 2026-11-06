/**
 * logbook — the declaration. A general log: what happened, when, on which run,
 * with the files that go with it. elog's experiment machinery (formats, tasks,
 * run types, modules) is left out on purpose.
 *
 * A run is written as elog writes it — one (42), a range (1-5) or several
 * (1,3,7) — and sorts by its first number.
 */
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { portalUser } from 'racklist'

const pad = (n) => String(n).padStart(2, '0')
const today = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (r) => `${r.date || ''} ${r.time || ''}`
const firstRun = (v) => {
  const m = String(v || '').match(/\d+/)
  return m ? Number(m[0]) : null
}

export default {
  name: 'logbook', title: tr('lb_title'), unit: tr('lb_unit'), key: 'lb',
  item: {
    key: 'logs', noun: tr('lb_noun'), allLabel: tr('lb_tab_logs'), tabId: 'logs',
    label: (r) => r.title || tr('lb_noun'),
    order: { k: 'date', dir: -1 },
    // Under every sort, newest first by day and minute: two logs of one day keep
    // the order they were written in.
    tie: () => (a, b) => stamp(b).localeCompare(stamp(a)),
    findHint: tr('lb_find_hint'),
    check: (r) => (String(r.title || '').trim() ? '' : tr('lb_need_title')),
    // A log is stamped when it is first saved: the day, the minute and who wrote
    // it, unless they were filled in — a page left open stays truthful.
    fill: (r) => {
      const now = new Date()
      return {
        ...r,
        title: String(r.title || '').trim(),
        date: r.date || today(now),
        time: r.time || `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        author: r.author || portalUser()?.email || '',
      }
    },
    fields: [
      { k: 'title', label: tr('lb_f_title'), type: 'text', required: true, width: 420, col: { w: 320, min: 120 }, tone: 'ink' },
      { k: 'date', label: tr('lb_f_date'), type: 'date', col: { w: 96, min: 80 }, tone: 'dim' },
      { k: 'time', label: tr('lb_f_time'), type: 'time', col: { w: 60, min: 50, drop: 900 }, tone: 'dim' },
      { k: 'run', label: tr('lb_f_run'), type: 'text', mono: true, width: 160, hint: tr('lb_f_run_hint'),
        col: { w: 70, min: 44 }, sort: firstRun },
      { k: 'category', label: tr('lb_f_category'), type: 'class', col: { w: 110, min: 60, drop: 1000 }, tone: 'dim' },
      { k: 'tags', label: tr('lb_f_tags'), type: 'tags', col: { w: 150, min: 60, drop: 1100 }, tone: 'dim' },
      { k: 'author', label: tr('lb_f_author'), type: 'text', edit: false,
        col: { w: 100, min: 60, drop: 1200 }, tone: 'dim', cell: (r) => String(r.author || '').split('@')[0] },
      { k: 'files', label: tr('lb_f_files'), type: 'uploads', col: { w: 44, min: 36 } },
      { k: 'body', label: tr('lb_f_body'), type: 'longtext', rows: 8 },
    ],
  },
  classes: [],
  listing: { presets: [['기본', '{date} {time} [{run}] {title}', '⏎']] },
}
