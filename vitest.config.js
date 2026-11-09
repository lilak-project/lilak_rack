import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// racklist's tests. The kit (lilak_ui) is aliased as the services alias it.
const UI = resolve(process.env.LILAK_UI_PATH || resolve(__dirname, '../lilak_ui'), 'src')

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    // An ARRAY, not a map: a map's keys match as prefixes, so `racklist` alone
    // would send `racklist/rack.css` to `racklist/index.js/rack.css`. A
    // service's own module imports both — the barrel by name and the
    // stylesheet by path — and a test that imports that module must resolve
    // the two differently.
    alias: [
      { find: /^racklist$/, replacement: resolve(__dirname, 'racklist/index.js') },
      { find: /^racklist\//, replacement: `${resolve(__dirname, 'racklist')}/` },
      // CodeMirror lives in note's own tree; the test and the module under it
      // must get the SAME copy or the view refuses the state.
      { find: /^@codemirror\//, replacement: `${resolve(__dirname, 'note/node_modules/@codemirror')}/` },
      { find: /^lilak-ui\//, replacement: `${UI}/` },
      { find: /^lilak-ui$/, replacement: UI },
    ],
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.{js,jsx}'] },
})
