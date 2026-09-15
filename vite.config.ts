import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    globals: true,
    // Node by default, because the engine is the bulk of the suite and does
    // not need a DOM. UI tests opt in per file with a
    // `@vitest-environment jsdom` docblock rather than slowing everything.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The browser suite is Playwright's, and its files would fail loudly if
    // Vitest picked them up: `@playwright/test` has its own `test` and
    // `expect` and no DOM to attach to.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
