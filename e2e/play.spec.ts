/**
 * Playing, and switching who is playing.
 *
 * Switching player once left the table showing "Hand #0" with no buttons: the
 * switch reset the table and the effect that deals was not keyed on the
 * profile, so nothing dealt. It was invisible to 552 passing tests and obvious
 * within seconds of opening a browser — which is the argument for this file.
 */

import { test, expect } from '@playwright/test'
import { playHands, signIn, watchForErrors } from './helpers'

test('a hand is dealt as soon as somebody sits down', async ({ page }) => {
  await signIn(page)
  // The bug read exactly as "#0" with an empty action bar.
  await expect(page.locator('.statusbar .stat').nth(2).locator('b')).not.toHaveText('#0')
})

test('the table keeps dealing hand after hand', async ({ page }) => {
  const errors = watchForErrors(page)
  await signIn(page)
  expect(await playHands(page, 3)).toBeGreaterThanOrEqual(3)
  expect(errors).toEqual([])
})

test('somebody else sitting down gets a fresh table, not your chips', async ({ page }) => {
  await signIn(page, 'Richard')
  expect(await playHands(page, 3)).toBeGreaterThanOrEqual(3)
  const mine = await page.locator('.statusbar .stat').nth(2).locator('b').textContent()
  // The comparison below is only worth anything if Richard got past the first
  // hand. Asserted, rather than left to make the test vacuously pass.
  expect(mine).not.toBe('#1')

  await page.locator('.whoami').click()
  await page.getByRole('button', { name: 'Add player' }).click()
  await page.fill('#pname', 'Dave')
  await page.getByRole('button', { name: 'Start playing' }).click()
  await page.waitForSelector('.tabs')

  // Dave starts his own session. Sharing it would sit him behind Richard's
  // stack, and cashing out would record Richard's night under Dave's name.
  await expect(page.locator('.statusbar .stat').nth(2).locator('b')).toHaveText('#1')
  await expect(page.locator('.statusbar .stat').nth(2).locator('b')).not.toHaveText(mine!)
})

test('and a hand is dealt for them too', async ({ page }) => {
  await signIn(page, 'Richard')
  await page.locator('.whoami').click()
  await page.getByRole('button', { name: 'Add player' }).click()
  await page.fill('#pname', 'Dave')
  await page.getByRole('button', { name: 'Start playing' }).click()
  await page.waitForSelector('.tabs')

  // The reset left no hand and nothing dealt one. This is that exact case.
  await expect(page.locator('.felt')).toBeVisible()
  await expect(page.locator('.statusbar .stat').nth(2).locator('b')).not.toHaveText('#0')
})

test('coming back finds your own table where you left it', async ({ page }) => {
  await signIn(page, 'Richard')
  expect(await playHands(page, 3)).toBeGreaterThanOrEqual(3)
  const mine = await page.locator('.statusbar .stat').nth(2).locator('b').textContent()
  expect(mine).not.toBe('#1')

  await page.locator('.whoami').click()
  await page.getByRole('button', { name: 'Add player' }).click()
  await page.fill('#pname', 'Dave')
  await page.getByRole('button', { name: 'Start playing' }).click()
  await page.waitForSelector('.tabs')

  await page.locator('.whoami').click()
  await page.locator('.playerchip', { hasText: 'Richard' }).click()
  await page.waitForSelector('.tabs')
  await expect(page.locator('.statusbar .stat').nth(2).locator('b')).toHaveText(mine!)
})

test('every tab opens without an error', async ({ page }) => {
  const errors = watchForErrors(page)
  await signIn(page)
  await playHands(page, 2)

  for (const tab of ['Coach', 'Drill', 'My Game', 'Players', 'Book', 'Rules', 'Table']) {
    await page.getByRole('tab', { name: tab }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('.screen')).toBeVisible()
  }
  expect(errors).toEqual([])
})
