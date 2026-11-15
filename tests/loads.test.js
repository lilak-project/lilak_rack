import { describe, it, expect } from 'vitest'

/** Every screen module LOADS.
 *
 *  A build does not catch a name that is used but never imported — esbuild
 *  leaves the bare identifier alone and the page dies on the first render
 *  with "Can't find variable: …". Importing each module here evaluates it,
 *  which is what a build does not do. This caught `untagged` moving from
 *  App.jsx to marks.js with the import left behind.
 */
const SCREENS = [
  '../note/src-lilak/App.jsx',
  '../note/src-lilak/marks.js',
  '../note/src-lilak/reading.jsx',
  '../note/src-lilak/liveedit.js',
  '../note/src-lilak/livemd.js',
  '../academic_activities/src-lilak/def.js',
  '../author_manager/src-lilak/def.jsx',
  '../reference_manager/src-lilak/def.jsx',
  '../project_manager/src-lilak/def.jsx',
  '../inbox/src-lilak/def.jsx',
  '../asset_manager2/src-lilak/def.jsx',
]

describe('every screen module loads', () => {
  it.each(SCREENS)('%s', async (path) => {
    const mod = await import(path)
    expect(mod).toBeTruthy()
  })
})
