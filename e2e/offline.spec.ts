/**
 * Does it work with no signal?
 *
 * This is the test that would have caught the worst bug in the project. The
 * service worker precached every asset and then served none of them: Vite
 * marks module scripts `crossorigin`, the responses carry `Vary: Origin`, and
 * every cache lookup missed on that header. The app looked cached, reported
 * itself installed, and was dead the moment the network went. Nothing in the
 * suite noticed, because a service worker does not exist in jsdom.
 *
 * A poker night in somebody's basement is exactly where the signal is bad, so
 * offline is a feature here rather than a nicety.
 */

import { test, expect } from '@playwright/test'
import { signIn, watchForErrors } from './helpers'

test('the app starts with the network cut', async ({ page, context }) => {
  const errors = watchForErrors(page)

  // First visit: let the worker install and take the page over.
  await signIn(page, 'Richard')
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 20_000,
  })

  await context.setOffline(true)
  await page.reload()

  // Everything below here is served from the cache or not at all.
  await expect(page.locator('.tabs')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.felt')).toBeVisible()
  expect(errors.filter((e) => !/Failed to fetch|NetworkError/i.test(e))).toEqual([])

  await context.setOffline(false)
})

test('a hand can be played with the network cut', async ({ page, context }) => {
  await signIn(page, 'Richard')
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 20_000,
  })

  await context.setOffline(true)
  await page.reload()
  await page.waitForSelector('.tabs')

  // The engine is all on-device, so this must work exactly as it does online.
  const deal = page.locator('.table-screen button:has-text("Deal the cards")')
  if (await deal.count()) await deal.first().click()
  await page.waitForTimeout(600)
  await expect(page.locator('.action-buttons .btn').first()).toBeVisible({ timeout: 15_000 })

  await context.setOffline(false)
})

test('your history survives the network being gone', async ({ page, context }) => {
  await signIn(page, 'Richard')
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 20_000,
  })

  await context.setOffline(true)
  await page.reload()
  await page.waitForSelector('.tabs')

  // Records live on the device, so being offline should not even be visible
  // here — which is the point of there being no backend.
  await expect(page.locator('.whoami-name')).toHaveText('Richard')
  await page.getByRole('tab', { name: 'My Game' }).click()
  await expect(page.locator('.scroll')).toBeVisible()

  await context.setOffline(false)
})

/*
 * A fourth test lived here and has been deleted rather than kept.
 *
 * It walked the cache asking for each entry with and without `ignoreVary`, on
 * the theory that anything only findable with it was unreachable in practice.
 * It passed with the bug deliberately reintroduced — because matching a stored
 * entry against its own cache key never trips the `Vary` mismatch, which only
 * happens between the precache request and the one the page later makes.
 *
 * So it was a test that could not fail, sitting next to three that can. That
 * is worse than no test: it implies coverage of the exact failure it does not
 * cover. The three above are verified to fail when `ignoreVary` is removed
 * from the worker.
 */
