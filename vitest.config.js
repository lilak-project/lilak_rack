import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// racklist's tests. The kit (lilak_ui) is aliased as the services alias it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'lilak-ui': resolve(process.env.LILAK_UI_PATH || resolve(__dirname, '../lilak_ui'), 'src'),
      // A service's own module may be under test too, and it reaches the
      // kit by the name every service's vite config gives it.
      racklist: resolve(__dirname, 'racklist/index.js'),
    },
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.{js,jsx}'] },
})
