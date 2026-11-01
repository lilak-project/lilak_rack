// node lilak_ui/src/racklist/rrule.check.mjs — the repeating rules against
// days worked out by hand (and Google's own rules from the 비정우 calendar).
import assert from 'node:assert/strict'
import { occurrences, describe, parseRule, withUntil, withCount } from './rrule.js'

const eq = (a, b, why) => assert.deepEqual(a, b, why)

// Weekly, the start's own weekday; a day taken out.
eq(occurrences('2026-10-20', 'FREQ=WEEKLY', '2026-10-01', '2026-11-10', ['2026-11-03']),
  ['2026-10-20', '2026-10-27', '2026-11-10'], 'weekly, one out')
// Weekly on two days, every 2 weeks, 5 times (COUNT from the start).
eq(occurrences('2026-10-20', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5', '2026-01-01', '2027-12-31'),
  ['2026-10-20', '2026-10-22', '2026-11-03', '2026-11-05', '2026-11-17'], 'biweekly TU,TH x5')
// COUNT counts the days left out too.
eq(occurrences('2026-10-20', 'FREQ=DAILY;COUNT=3', '2026-01-01', '2027-01-01', ['2026-10-21']),
  ['2026-10-20', '2026-10-22'], 'daily x3, one out')
// Monthly on the 14th (멜론 결제일), and on the 31st skipping short months.
eq(occurrences('2023-10-14', 'FREQ=MONTHLY;BYMONTHDAY=14', '2026-10-01', '2026-12-31'),
  ['2026-10-14', '2026-11-14', '2026-12-14'], 'monthly 14th')
eq(occurrences('2026-01-31', 'FREQ=MONTHLY', '2026-01-01', '2026-05-31'),
  ['2026-01-31', '2026-03-31', '2026-05-31'], 'monthly 31st skips short months')
// Every 2 months, the first Sunday (면도기 세척액 교체: 2021-12-19 start, Google's rule).
eq(occurrences('2021-12-19', 'FREQ=MONTHLY;INTERVAL=2;BYDAY=1SU', '2022-01-01', '2022-06-30'),
  ['2022-02-06', '2022-04-03', '2022-06-05'], 'bimonthly first Sunday')
// Last Friday of the month.
eq(occurrences('2026-10-01', 'FREQ=MONTHLY;BYDAY=-1FR', '2026-10-01', '2026-12-31'),
  ['2026-10-30', '2026-11-27', '2026-12-25'], 'last Friday')
// UNTIL with a time in UTC is a day in Korea (Google writes these).
assert.equal(parseRule('FREQ=WEEKLY;UNTIL=20240721T145959Z').until, '2024-07-21')
assert.equal(parseRule('FREQ=WEEKLY;UNTIL=20240721T150000Z').until, '2024-07-22')
eq(occurrences('2024-07-01', 'FREQ=WEEKLY;UNTIL=20240715', '2024-01-01', '2024-12-31'),
  ['2024-07-01', '2024-07-08', '2024-07-15'], 'until inclusive')
// Yearly on the start's day.
eq(occurrences('2024-02-29', 'FREQ=YEARLY', '2024-01-01', '2032-12-31'),
  ['2024-02-29', '2028-02-29', '2032-02-29'], 'yearly 29 Feb')
// Said in Korean.
assert.equal(describe('FREQ=WEEKLY;BYDAY=TU', '2026-10-20'), '매주 화요일')
assert.equal(describe('FREQ=MONTHLY;INTERVAL=2;BYDAY=1SU'), '2개월마다 첫째 일요일')
assert.equal(describe('FREQ=MONTHLY;BYMONTHDAY=14;COUNT=10'), '매월 14일 · 10회')
assert.equal(describe('FREQ=DAILY;UNTIL=20261231'), '매일 · 2026-12-31까지')
// Ends set and taken off.
assert.equal(withUntil('FREQ=WEEKLY;COUNT=5;BYDAY=TU', '2026-11-02'), 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261102')
assert.equal(withCount('FREQ=WEEKLY;UNTIL=20261102', 3), 'FREQ=WEEKLY;COUNT=3')
console.log('rrule ok')
