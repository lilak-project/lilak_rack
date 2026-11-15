import { it } from 'vitest'

// The hand-checked place rule lives in reference_manager/src-lilak/
// parts.check.mjs as plain asserts. Plain node cannot resolve the kit's
// `lilak-ui` import that paper.js carries, so the file runs here, where the
// alias is.
it('parts: the hand-checked place cases hold', async () => {
  await import('../reference_manager/src-lilak/parts.check.mjs')
})
