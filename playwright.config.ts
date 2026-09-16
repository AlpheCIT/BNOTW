/**
 * Browser tests, for the bugs the rest of the suite cannot see.
 *
 * The unit and component tests are thorough and they have missed, in two
 * sessions: a service worker that cached every asset and served none of them,
 * a form taller than an iPad, a table that dealt no hand after switching
 * player, and a gate that could trap you in the app with no way out. Every one
 * was found by opening a browser by hand.
 *
 * The common thread is that jsdom has no layout, no service worker, no network
 * and no real event loop, so a component can be structurally perfect and
 * useless. These tests run the production build in a real browser, and they
 * are deliberately few: each one covers a class of failure that has actually
 * shipped rather than re-testing what Vitest already proves.
 */

import { defineConfig, devices } from '@playwright/test'

/** The one the sandbox already has, so nothing downloads a browser. */
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH

export default defineConfig({
  testDir: './e2e',
  // A production build, because half of what is being tested only exists in
  // one: the generated service worker, the worker chunk, the relative base.
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    // Every test starts from a device with nothing on it.
    storageState: undefined,
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    ...(CHROMIUM ? { launchOptions: { executablePath: CHROMIUM } } : {}),
  },
  // One worker: the tests share a service worker registration and a port, and
  // a flaky suite is worse than a slow one.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  /*
   * Generous, because these tests play real hands at real speed.
   *
   * Three hands measured between 25 and 33 seconds, and a hand that goes to
   * showdown with a decision on every street — or a bust and a rebuy — is
   * several seconds longer again. At 60 seconds that variance failed a test
   * about something else roughly one run in ten, which is worse than useless:
   * a suite people learn to re-run is a suite people stop believing.
   *
   * This does not weaken the check for a table that has actually stopped.
   * `playHands` throws on its own after 15 seconds with nothing to press, and
   * prints what is on screen, so a real hang still fails fast and says why.
   */
  timeout: 120_000,
  /*
   * Three shapes, and landscape is not optional.
   *
   * The iPad in landscape is only 834px tall — the tightest vertical case in
   * the set and the one the report that started this suite came from. A
   * portrait-only run passed the very regression it was written for, because
   * 1194px of height forgives a form that a real device does not.
   */
  projects: [
    {
      name: 'ipad-landscape',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1194, height: 834 } },
    },
    {
      name: 'ipad-portrait',
      use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1194 } },
    },
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
})
