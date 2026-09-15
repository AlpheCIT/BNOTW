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
  },
})
