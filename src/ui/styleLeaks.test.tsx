// @vitest-environment jsdom
/**
 * Components that a surrounding `.field` used to mangle.
 *
 * This file exists because the new-player form shipped looking broken: the
 * experience options rendered one word per line in tiny uppercase, each with
 * an empty box the width of the dialog beside it, and the dialog itself lost
 * the left half of every heading.
 *
 * Nothing in the suite could have caught it. The component tests render real
 * markup but jsdom does no layout, so a correct tree that paints wrongly
 * passes everything. What jsdom *does* do is resolve the cascade — which is
 * enough, because the bug was a cascade bug: `.field label` is a tiny
 * uppercase caption and `.field input` is a full-width text box, and dropping
 * a row that is itself a `<label>` with a radio inside one inherits both.
 *
 * So these tests load the real stylesheet and assert the computed values that
 * were wrong. They are narrow on purpose: this cannot check that anything
 * looks right, only that the specific styles which leaked are not leaking.
 * Catching layout properly needs a browser, which is issue #36.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
  document.head.appendChild(style)
})

/** Render some markup and hand back a computed-style lookup. */
function mount(html: string) {
  document.body.innerHTML = html
  return (selector: string) => {
    const node = document.querySelector(selector)
    if (!node) throw new Error(`nothing matched ${selector}`)
    return getComputedStyle(node as HTMLElement)
  }
}

const OPTION_ROW = `
  <label class="resetrow">
    <input type="radio" />
    <div>
      <div class="resetlabel">New to poker</div>
      <div class="sub">Start with one question at a time: is the price right?</div>
    </div>
  </label>`

describe('a choice row inside a field', () => {
  it('keeps its prose readable rather than becoming a caption', () => {
    const css = mount(`<div class="field">${OPTION_ROW}</div>`)
    // `.field label` is 10px uppercase with wide letter-spacing. Inherited
    // here it turned every description into one word per line.
    expect(css('.resetrow').textTransform).toBe('none')
    expect(css('.resetrow').fontSize).toBe('13px')
    expect(css('.resetrow').letterSpacing).toBe('normal')
  })

  it('keeps the option name readable too', () => {
    const css = mount(`<div class="field">${OPTION_ROW}</div>`)
    expect(css('.resetlabel').textTransform).toBe('none')
    expect(css('.resetlabel').fontSize).toBe('13px')
  })

  it('leaves the radio the size of a radio', () => {
    const css = mount(`<div class="field">${OPTION_ROW}</div>`)
    // `.field input { width: 100% }` turned it into an empty box the width of
    // the dialog, which is what pushed the whole form off the screen.
    expect(css('.resetrow input').width).not.toBe('100%')
    expect(css('.resetrow input').flexGrow).toBe('0')
  })

  it('looks the same outside a field as inside one', () => {
    // Start Fresh uses the same row without a surrounding field. A component
    // that renders two different ways depending on its parent is the bug.
    const inside = mount(`<div class="field">${OPTION_ROW}</div>`)
    const insideValues = [
      inside('.resetrow').textTransform,
      inside('.resetrow').fontSize,
      inside('.resetrow input').width,
    ]
    const outside = mount(OPTION_ROW)
    expect([
      outside('.resetrow').textTransform,
      outside('.resetrow').fontSize,
      outside('.resetrow input').width,
    ]).toEqual(insideValues)
  })
})

describe('other things a field wraps', () => {
  it('leaves an inline checkbox inline', () => {
    // The same trap, papered over once before for this one.
    const css = mount(`
      <div class="field">
        <label class="inline-check"><input type="checkbox" /><span>Confirm big actions</span></label>
      </div>`)
    expect(css('.inline-check').textTransform).toBe('none')
    expect(css('.inline-check input').width).not.toBe('100%')
  })

  it('still styles an ordinary field label as a caption', () => {
    // The rules being worked around are right for what they were written for,
    // and this is what stops a fix turning into a regression.
    const css = mount(`<div class="field"><label for="x">Name</label><input id="x" /></div>`)
    expect(css('.field label').textTransform).toBe('uppercase')
    expect(css('.field input').width).toBe('100%')
  })
})

describe('a dialog cannot be pushed off its own edges', () => {
  it('lets its contents shrink', () => {
    const css = mount('<div class="dialog"><div class="resetlist"></div></div>')
    // A child that refuses to shrink used to widen the dialog past the screen,
    // and the centred overlay then clipped it on both sides.
    expect(css('.dialog').minWidth).toBe('0px')
  })

  it('lets a choice row shrink around long prose', () => {
    const css = mount(`<div class="field">${OPTION_ROW}</div>`)
    expect(css('.resetrow > div').minWidth).toBe('0px')
  })
})
