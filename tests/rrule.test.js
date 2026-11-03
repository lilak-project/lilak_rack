import { it } from 'vitest'

// The hand-checked repeat rules live in racklist/rrule.check.mjs as plain
// asserts. Plain node cannot resolve the kit's `lilak-ui` import that rrule.js
// carries, so the file runs here, where the alias is.
it('rrule: the hand-checked cases hold', async () => {
  document.documentElement.lang = 'ko'            // the expected sentences are Korean
  await import('../racklist/rrule.check.mjs')
})
