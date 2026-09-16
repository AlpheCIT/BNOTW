/**
 * The frequency layer, switched on the way a player would switch it on.
 *
 * Written because the first version of this feature passed every unit and
 * component test and then showed nothing at all in a browser. The layer
 * settings are stored per profile, so a test that seeds the unscoped key is
 * testing a key the app never reads — and the panel that was "working" was
 * simply switched off. Nothing short of driving the real control catches that.
 */

import { test, expect } from '@playwright/test'
import { signIn, watchForErrors } from './helpers'

/** Play on, passively, until the coach is facing a bet with the panel up. */
async function playUntilFacingABet(page: import('@playwright/test').Page): Promise<boolean> {
  const next = page.locator(
    '.confirm-actions .btn.danger, '
    + '.table-screen button:has-text("Deal the cards"), '
    + '.table-screen button:has-text("Next hand"), '
    + '.action-buttons .btn',
  ).first()
  const passive = page.locator('.action-buttons .btn.call, .action-buttons .btn.check').first()
  const rebuy = page.locator('.table-screen button:has-text("Rebuy")').first()
  const panel = page.locator('.freq-rows')

  for (let i = 0; i < 60; i++) {
    if (await panel.count()) return true
    await next.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(300)
    if (await panel.count()) return true
    if (await rebuy.count()) {
      await rebuy.click({ timeout: 5_000 }).catch(() => {})
      continue
    }
    if (await passive.count()) {
      await passive.click({ timeout: 5_000 }).catch(() => {})
      continue
    }
    await next.click({ timeout: 5_000 }).catch(() => {})
  }
  return false
}

/** Turn a layer on through the picker, as a player would. */
async function turnOn(page: import('@playwright/test').Page, name: string) {
  /*
   * Matched on the whole label rather than the word "layers", which also
   * appears inside "Players" — a substring selector opened the Players tab and
   * then waited for a dialog that was never coming.
   */
  await page.getByRole('button', { name: /^(\d+ of \d+ layers|All layers)$/ }).click()
  await page.locator('.resetrow', { hasText: name }).locator('input[type="checkbox"]').check()
  await page.locator('.overlay').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.overlay')).toHaveCount(0)
}

test('the frequency layer is off until you ask for it, then it is there', async ({ page }) => {
  const errors = watchForErrors(page)
  await signIn(page)
  await page.getByRole('tab', { name: 'Coach' }).click()

  // A new player starts on the price and the hand; this is further along.
  await expect(page.locator('.freq-rows')).toHaveCount(0)

  await turnOn(page, 'The frequency')
  expect(await playUntilFacingABet(page)).toBe(true)

  const panel = page.locator('.layer-panel').filter({ hasText: 'The frequency' }).first()
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('of your range has to go on')
  // The caveat is not decoration: without it the number is bad advice.
  await expect(panel).toContainText('Nothing here knows your cards')

  expect(errors).toEqual([])
})

test('the numbers it shows are the ones the arithmetic gives', async ({ page }) => {
  await signIn(page)
  await page.getByRole('tab', { name: 'Coach' }).click()
  await turnOn(page, 'The frequency')
  expect(await playUntilFacingABet(page)).toBe(true)

  const panel = page.locator('.layer-panel').filter({ hasText: 'The frequency' }).first()
  const text = ((await panel.textContent()) ?? '').replace(/\s+/g, ' ')

  /*
   * Re-derived from the two amounts on screen rather than trusted. If the coach
   * ever priced a raise off the hero's call amount instead of what the raiser
   * put in, these would stop agreeing — which is the one mistake this whole
   * feature is most likely to make.
   */
  /*
   * `[\d.]+` rather than a real number pattern cost an afternoon: the figures
   * sit right after a sentence-ending full stop once the elements are run
   * together, so the greedy class captured ".58.3" and quietly produced NaN.
   */
  const NUM = String.raw`(\d+(?:\.\d+)?)`
  const money = text.match(new RegExp(String.raw`Risking \$${NUM} to win \$${NUM}`))
  expect(money).not.toBeNull()
  const risk = Number(money![1])
  const potBefore = Number(money![2])

  const foldPct = text.match(new RegExp(String.raw`fold ${NUM}% of the time`))
  expect(foldPct).not.toBeNull()
  const alpha = (risk / (potBefore + risk)) * 100
  expect(Number(foldPct![1])).toBeCloseTo(alpha, 0)

  // No space before "of": the figure and its label are separate elements, so
  // textContent runs them together.
  const defend = text.match(new RegExp(String.raw`${NUM}%\s*of your range has to go on`))
  expect(defend).not.toBeNull()
  expect(Number(defend![1])).toBeCloseTo(100 - alpha, 0)
})
