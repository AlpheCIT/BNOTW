/**
 * The recap at the end of a hand, in a real browser.
 *
 * The complaint that produced it was that feedback went past too fast to read.
 * It was not really speed: the coach kept one verdict at a time, so each
 * decision overwrote the last and by the end of the hand only the final one
 * was left. A unit test can prove the component renders four rows; only this
 * can prove the app actually puts four in it after a hand that had four.
 */

import { test, expect } from '@playwright/test'
import { signIn, watchForErrors } from './helpers'

/** Play on, taking the passive option, until a hand ends with a recap in it. */
async function playToRecap(page: import('@playwright/test').Page, rows = 1) {
  const next = page.locator(
    '.confirm-actions .btn.danger, '
    + '.table-screen button:has-text("Deal the cards"), '
    + '.table-screen button:has-text("Next hand"), '
    + '.action-buttons .btn',
  ).first()
  const passive = page.locator('.action-buttons .btn.call, .action-buttons .btn.check').first()

  for (let i = 0; i < 40; i++) {
    await next.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(420)
    const label = ((await next.textContent().catch(() => '')) ?? '').trim()
    if (label.includes('Next hand') && await page.locator('.recap-row').count() >= rows) return true
    // Calling and checking keeps the hand going, which is what produces a
    // recap with more than one row in it.
    if (await passive.count()) {
      await passive.click({ timeout: 5_000 }).catch(() => {})
      continue
    }
    await next.click({ timeout: 5_000 }).catch(() => {})
  }
  return false
}

/**
 * Play on until a hand has finished, rebuying through any bust on the way.
 *
 * The rebuy matters: busting is not rare over a hand or two, and a table
 * asking for $42 is not waiting on anything it could deal itself. A test that
 * did not answer it read that as "the table never advanced" and failed on
 * correct behaviour.
 */
async function playToHandEnd(page: import('@playwright/test').Page): Promise<boolean> {
  const next = page.locator(
    '.confirm-actions .btn.danger, '
    + '.table-screen button:has-text("Deal the cards"), '
    + '.table-screen button:has-text("Next hand"), '
    + '.action-buttons .btn',
  ).first()
  const passive = page.locator('.action-buttons .btn.call, .action-buttons .btn.check').first()
  const rebuy = page.locator('.table-screen button:has-text("Rebuy")').first()

  for (let i = 0; i < 60; i++) {
    await next.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(420)
    if (await rebuy.count()) {
      await rebuy.click({ timeout: 5_000 }).catch(() => {})
      continue
    }
    if (((await next.textContent().catch(() => '')) ?? '').includes('Next hand')) return true
    if (await passive.count()) {
      await passive.click({ timeout: 5_000 }).catch(() => {})
      continue
    }
    await next.click({ timeout: 5_000 }).catch(() => {})
  }
  return false
}

test('coach mode recaps the hand when it is over', async ({ page }) => {
  const errors = watchForErrors(page)
  await signIn(page)
  await page.getByRole('tab', { name: 'Coach' }).click()

  expect(await playToRecap(page)).toBe(true)
  await expect(page.locator('.recap')).toBeVisible()
  await expect(page.locator('.recap h3')).toHaveText('How that hand went')
  expect(errors).toEqual([])
})

test('a hand with several decisions shows all of them', async ({ page }) => {
  await signIn(page)
  await page.getByRole('tab', { name: 'Coach' }).click()

  // This is the bug in one assertion: the panel used to hold exactly one
  // verdict however many times you acted.
  expect(await playToRecap(page, 2)).toBe(true)
  expect(await page.locator('.recap-row').count()).toBeGreaterThanOrEqual(2)
})

test('the recap stays put until you deal the next hand', async ({ page }) => {
  await signIn(page)
  await page.getByRole('tab', { name: 'Coach' }).click()
  expect(await playToRecap(page)).toBe(true)

  /*
   * The regression this exists for: the table used to deal the next hand on a
   * timer, 3.2 seconds after the pot was pushed at normal speed and 1.7 at the
   * fast setting these tests run on. The recap went with it, which is exactly
   * what "it goes so fast I can't see the feedback" was. Nothing times it out
   * now — it goes when the player decides to move on, not before.
   */
  const recap = page.locator('.recap')
  const played = await recap.getAttribute('data-hand')
  await page.waitForTimeout(3_000)
  await expect(recap).toBeVisible()
  expect(await recap.getAttribute('data-hand')).toBe(played)

  /*
   * And it is the hand on screen that it describes, never a stale one. Asserting
   * the panel simply disappears here was flaky for a real reason: the next hand
   * can end before the assertion runs — everyone folding to the big blind is
   * enough — and then its own recap is up in the same place. The hand number is
   * on the element so the two cannot be confused.
   */
  await page.locator('.table-screen button:has-text("Next hand")').first().click()

  // Busting on the hand just played puts the rebuy question up instead of a
  // new deal — and the recap correctly stays underneath it, because the hand
  // it describes is still the last one played. Answer it and the table moves.
  await page.waitForTimeout(600)
  const rebuy = page.locator('.table-screen button:has-text("Rebuy")').first()
  if (await rebuy.count()) await rebuy.click({ timeout: 5_000 })

  await expect
    .poll(async () => (await recap.count()) === 0 || (await recap.getAttribute('data-hand')) !== played,
      { timeout: 15_000 })
    .toBe(true)
})

test('the table gets one too, but only once the hand is over', async ({ page }) => {
  await signIn(page)

  // No coaching while you are deciding — that is what the table is for. The
  // recap appears only when it can no longer change anything.
  await expect(page.locator('.recap')).toHaveCount(0)
  expect(await playToRecap(page)).toBe(true)
  await expect(page.locator('.recap')).toBeVisible()
})

test('the old behaviour is still there for anyone who wants it', async ({ page }) => {
  /*
   * "Deal the next one automatically" is off by default now, which makes it
   * the kind of setting that can quietly stop working without a single test
   * going red. So: turn it on, reach the end of a hand, touch nothing, and the
   * table should move on by itself.
   */
  await signIn(page)
  await page.evaluate(() => {
    const raw = localStorage.getItem('bnotw.settings.v1')
    const settings = raw ? JSON.parse(raw) : {}
    localStorage.setItem('bnotw.settings.v1', JSON.stringify({ ...settings, handEnd: 'auto' }))
  })
  await page.reload()
  await page.waitForSelector('.tabs')

  expect(await playToHandEnd(page)).toBe(true)
  const handNumber = page.locator('.statusbar .stat').nth(2).locator('b')
  const played = ((await handNumber.textContent()) ?? '').trim()

  /*
   * Well clear of the 1.7s the fast setting waits, and nothing is clicked.
   *
   * Either the next hand is in the air, or the hero busted on that one and the
   * table is asking for a rebuy. Both count: `nextHand` is the only thing in
   * the app that raises that question, so a rebuy prompt nobody clicked for is
   * itself proof the table moved on by itself.
   */
  await expect.poll(async () => {
    const dealt = ((await handNumber.textContent()) ?? '').trim() !== played
    const busted = (await page.locator('.table-screen button:has-text("Rebuy")').count()) > 0
    return dealt || busted
  }, { timeout: 15_000 }).toBe(true)
})

test('a hand you walk away from on the recap is still there when you come back', async ({ page }) => {
  /*
   * The regression the waiting table nearly shipped with.
   *
   * The session snapshot was written when the next hand was dealt, which was
   * fine while the next hand was dealt on a timer. Once the table started
   * resting on a finished hand, the recap became the natural place to put the
   * iPad down — and closing it there rolled the hand back. Measured before the
   * fix: a hero who busted to $0 on hand #1 came back to a full $40 stack,
   * with the hand still in the history. Two records of the same night that did
   * not agree.
   */
  await signIn(page)
  expect(await playToHandEnd(page)).toBe(true)

  const stack = page.locator('.statusbar .stat').first().locator('b')
  const handNumber = page.locator('.statusbar .stat').nth(2).locator('b')
  const settled = ((await stack.textContent()) ?? '').trim()
  const played = ((await handNumber.textContent()) ?? '').trim()
  expect(played).toMatch(/^#[1-9]/)

  /*
   * What was written down, rather than what is on screen after a reload.
   *
   * Reading the restored stack out of the status bar was flaky for a reason
   * worth keeping: the next hand is dealt as soon as the table comes back, and
   * the hero's blind is posted out of that stack before the assertion can run.
   * The saved session is the thing under test and it does not move.
   */
  const saved = await page.evaluate(() => {
    // Found rather than named: a profile that is not the default one carries
    // its id on the end of the key.
    const key = Object.keys(localStorage).find((k) => k.startsWith('bnotw.table.v1'))
    const raw = key ? localStorage.getItem(key) : null
    return raw ? (JSON.parse(raw) as { seats: { stack: number }[]; handNumber: number }) : null
  })
  expect(saved).not.toBeNull()
  expect(`$${(saved!.seats[0].stack / 100).toFixed(2)}`).toBe(settled)
  expect(`#${saved!.handNumber}`).toBe(played)

  // And coming back does not deal that hand a second time under the same number.
  await page.reload()
  await page.waitForSelector('.statusbar')
  await expect.poll(async () => ((await handNumber.textContent()) ?? '').trim(), { timeout: 15_000 })
    .not.toBe(played)
})
