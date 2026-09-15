/**
 * The screen standing in front of the app.
 *
 * It shipped able to trap people twice over: once because it was taller than
 * an iPad with its submit button off the bottom, and once because the prompt
 * to install a waiting fix rendered only *past* it — so the fix sat downloaded
 * on the device, unable to activate, behind the screen it was meant to repair.
 *
 * Adding this gate turned one bad screen into a way to brick the whole app, so
 * these are the tests that matter most in the file.
 */

import { test, expect } from '@playwright/test'
import { horizontalOverflow, watchForErrors } from './helpers'

test.beforeEach(async ({ context }) => { await context.clearCookies() })

test('a first-time player can get in', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/')

  await page.fill('#pname', 'Richard')
  await page.getByRole('button', { name: 'Start playing' }).click()

  await expect(page.locator('.tabs')).toBeVisible()
  await expect(page.locator('.whoami-name')).toHaveText('Richard')
  expect(errors).toEqual([])
})

test('the whole form is on screen without scrolling', async ({ page }, info) => {
  await page.goto('/')
  await page.waitForSelector('#pname')

  const dialog = (await page.locator('.dialog').boundingBox())!
  const viewport = page.viewportSize()!
  // It was about 1630px on an iPad, with the button below the fold and no way
  // to know it was there.
  expect(dialog.height, `dialog is ${dialog.height}px on ${info.project.name}`)
    .toBeLessThanOrEqual(viewport.height)

  const button = (await page.getByRole('button', { name: 'Start playing' }).boundingBox())!
  expect(button.y + button.height).toBeLessThanOrEqual(viewport.height)
})

test('nothing hangs off the side of the screen', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('#pname')
  // The form once pushed the dialog wider than the screen, and the centred
  // overlay clipped it at both ends — losing the left half of every heading.
  expect(await horizontalOverflow(page)).toEqual([])
})

test('the keyboard alone is enough', async ({ page }) => {
  await page.goto('/')
  await page.fill('#pname', 'Dave')
  // A submit button below the fold is survivable if Enter works. It was a
  // `div`, so it did not.
  await page.keyboard.press('Enter')
  await expect(page.locator('.tabs')).toBeVisible()
})

test('a guest can play without touching anybody else’s record', async ({ page }) => {
  await page.goto('/')
  await page.fill('#pname', 'Richard')
  await page.getByRole('button', { name: 'Start playing' }).click()
  await page.waitForSelector('.tabs')

  await page.locator('.whoami').click()
  await page.getByRole('button', { name: 'Play as guest' }).click()

  await expect(page.locator('.guestbar')).toBeVisible()
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('guest')))
  expect(keys).toEqual([])
})

test('the player picker comes back after a reload, and remembers nobody', async ({ page }) => {
  await page.goto('/')
  await page.fill('#pname', 'Richard')
  await page.getByRole('button', { name: 'Start playing' }).click()
  await page.waitForSelector('.tabs')

  await page.locator('.whoami').click()
  await page.getByRole('button', { name: 'Play as guest' }).click()
  await page.waitForSelector('.guestbar')

  await page.reload()
  // A guest is never remembered: whoever picks the device up next is asked,
  // rather than dropped into a stranger's throwaway session.
  await expect(page.getByText("Who's playing?")).toBeVisible()
  await expect(page.locator('.playerchip', { hasText: 'Richard' })).toBeVisible()
})
