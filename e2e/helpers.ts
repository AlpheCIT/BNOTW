/**
 * The few things every browser test needs.
 *
 * Kept small on purpose: a helper that drives the app through several screens
 * is a helper that fails for reasons that have nothing to do with the test.
 */

import { expect, type Page } from '@playwright/test'

/** Console errors and uncaught exceptions, collected for an assertion. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`))
  return errors
}

/**
 * Get past the first-run screen as a named player.
 *
 * The table is put on its fastest setting first. That is not cheating: the
 * pace is a deliberate pause between bot actions so a hand is watchable, and
 * waiting through it multiplies a six-test file into minutes without testing
 * anything. Anything that only works at a leisurely pace is a race the app has
 * anyway, and `fast` is a setting real players use.
 */
export async function signIn(page: Page, name = 'Richard'): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    const raw = localStorage.getItem('bnotw.settings.v1')
    const settings = raw ? JSON.parse(raw) : {}
    localStorage.setItem('bnotw.settings.v1', JSON.stringify({ ...settings, speed: 'fast' }))
  })
  await page.reload()
  await page.waitForSelector('#pname')
  await page.fill('#pname', name)
  await page.getByRole('button', { name: 'Start playing' }).click()
  await page.waitForSelector('.tabs')
}

/**
 * Play until `hands` different hand numbers have been seen.
 *
 * Takes whatever action is offered rather than playing well: what is under
 * test is that the table keeps moving, not how it is played. Both the straddle
 * window and the end-of-hand pause need answering or nothing advances — a trap
 * a hand-written driver fell into twice.
 *
 * Waits for the next thing to press rather than polling for it. The polling
 * version spent twenty seconds on four hands and only three of those were
 * clicks; the rest was several hundred round trips asking whether a button had
 * appeared yet.
 *
 * The pause before each click outlasts the action bar's own fat-finger guard,
 * which ignores taps for a moment after the buttons arrive. Clicking inside it
 * is swallowed, silently, which looks exactly like a table that has stopped.
 *
 * About four seconds a hand, measured. Two attempts to cut that — running the
 * table on its fast setting, and skipping the guard wait for the buttons that
 * do not have one — each made it *slower*, so the bottleneck is not where it
 * looks and chasing it further is not worth the time it would save. Tests ask
 * for as few hands as they can instead.
 */
const SETTLE_MS = 420

/** A hand number the table has actually dealt, or null while it is settling. */
async function dealtHand(page: Page): Promise<string | null> {
  const text = ((await page.locator('.statusbar .stat').nth(2).locator('b').textContent()) ?? '').trim()
  // "" before the bar renders, "#0" before the first deal. Counting either as
  // a hand made this helper report three when one had been played, which made
  // every assertion built on it pass without meaning anything.
  return /^#[1-9]/.test(text) ? text : null
}

export async function playHands(page: Page, hands: number): Promise<number> {
  /*
   * Everything the table can be waiting on.
   *
   * The confirmation sheet is in here because leaving it out stalled the
   * driver dead: the misclick guard asks before folding a strong hand, and a
   * selector that only knew about the action bar sat waiting for buttons that
   * were behind an `alertdialog`. Answering it also means the guard itself is
   * exercised on the way past rather than avoided.
   */
  const next = page.locator(
    '.confirm-actions .btn.danger, '
    + '.table-screen button:has-text("Deal the cards"), '
    + '.table-screen button:has-text("Next hand"), '
    + '.action-buttons .btn',
  ).first()

  // Start from a table that has actually dealt something.
  await expect.poll(() => dealtHand(page), { timeout: 15_000 }).not.toBeNull()

  const seen = new Set<string>([(await dealtHand(page))!])
  // Generous: a hand takes several decisions, and a rebuy or a bomb pot takes
  // a couple more.
  for (let i = 0; i < hands * 25 && seen.size < hands; i++) {
    const ready = await next.waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (!ready) {
      // Loudly, with what is on screen. Returning a short count quietly is how
      // a test ends up asserting nothing and passing.
      const onScreen = await page.locator('.table-screen button').allInnerTexts()
      throw new Error(
        `the table stopped after ${seen.size} hand(s) with nothing to press. `
        + `Buttons: ${JSON.stringify(onScreen)}`,
      )
    }
    await page.waitForTimeout(SETTLE_MS)
    await next.click({ timeout: 5_000 }).catch(() => {})
    const now = await dealtHand(page)
    if (now) seen.add(now)
  }
  return seen.size
}

/** Everything the page can scroll horizontally, which should be nothing. */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const width = document.documentElement.clientWidth
    for (const node of document.querySelectorAll<HTMLElement>('body *')) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      // A couple of pixels of rounding is not a layout bug.
      if (box.right > width + 2 || box.left < -2) {
        const style = getComputedStyle(node)
        if (style.position === 'fixed' || style.overflowX === 'auto') continue
        out.push(`${node.tagName.toLowerCase()}.${node.className || '(none)'}`)
      }
    }
    return [...new Set(out)].slice(0, 10)
  })
}
