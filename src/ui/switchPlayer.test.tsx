// @vitest-environment jsdom
/**
 * Switching player at the table.
 *
 * Every test here is a bug that was actually shipped into a build and caught
 * by driving a real browser, which is the argument for this file existing at
 * all: the table's lifecycle lives in effects, and effects are exactly what
 * jsdom-free reasoning gets wrong.
 *
 * The first one — a reset table that nobody dealt to — showed up as "Hand #0"
 * and no buttons, on the very first player anybody creates.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useGame } from './useGame'
import { DEFAULT_PROFILE_ID, GUEST_ID } from '../state/profiles'
import { loadTableSnapshot, saveTableSnapshot } from '../state/storage'
import { defaultRoster } from '../engine/persona'

afterEach(() => { cleanup(); localStorage.clear() })

const settings = { opponents: defaultRoster().slice(0, 4), bombPotTrigger: 'off' as const }

function table(profileId: string) {
  return renderHook(
    ({ id }: { id: string }) => useGame(settings, true, 'table', id),
    { initialProps: { id: profileId } },
  )
}

describe('sitting somebody else down', () => {
  it('deals a hand for the player who just sat down', () => {
    const view = table(DEFAULT_PROFILE_ID)
    expect(view.result.current.table.hand).not.toBe(null)

    act(() => { view.rerender({ id: 'dave' }) })

    // Shipped once as "Hand #0" with no buttons: the switch reset the table
    // and the effect that deals was not keyed on the profile, so nothing did.
    expect(view.result.current.table.hand).not.toBe(null)
    expect(view.result.current.table.handNumber).toBeGreaterThan(0)
  })

  it('does not hand over the last player’s chips', () => {
    const view = table(DEFAULT_PROFILE_ID)
    act(() => {
      view.result.current.table.human.stack = 1234
      view.rerender({ id: 'dave' })
    })
    // Otherwise Dave sits down behind your stack — and cashing out would
    // record your night under his name.
    expect(view.result.current.table.human.stack).not.toBe(1234)
  })

  it('keeps each player’s table under its own key', () => {
    const view = table(DEFAULT_PROFILE_ID)
    act(() => { view.rerender({ id: 'dave' }) })

    saveTableSnapshot('table', view.result.current.table.snapshot('table'), 'dave')
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('bnotw.table'))
    expect(keys).toContain('bnotw.table.v1:dave')
  })

  it('gives a player their own table back when they return', () => {
    const view = table('dave')
    act(() => {
      view.result.current.table.human.stack = 777
      saveTableSnapshot('table', view.result.current.table.snapshot('table'), 'dave')
      view.rerender({ id: 'eadie' })
    })
    expect(view.result.current.table.human.stack).not.toBe(777)

    act(() => { view.rerender({ id: 'dave' }) })
    expect(view.result.current.table.human.stack).toBe(777)
  })

  it('does not reset when the profile has not actually changed', () => {
    const view = table('dave')
    act(() => { view.result.current.table.human.stack = 999 })
    act(() => { view.rerender({ id: 'dave' }) })
    // A reset on every render would wipe the table mid-hand.
    expect(view.result.current.table.human.stack).toBe(999)
  })
})

describe('a guest at the table', () => {
  it('starts from a fresh table however the last one ended', () => {
    const view = table('dave')
    act(() => {
      view.result.current.table.human.stack = 555
      saveTableSnapshot('table', view.result.current.table.snapshot('table'), 'dave')
      view.rerender({ id: GUEST_ID })
    })
    expect(view.result.current.table.human.stack).not.toBe(555)
    expect(view.result.current.table.hand).not.toBe(null)
  })

  it('leaves nothing behind to restore', () => {
    const view = table(GUEST_ID)
    act(() => { view.result.current.table.human.stack = 321 })
    saveTableSnapshot('table', view.result.current.table.snapshot('table'), GUEST_ID)

    expect(Object.keys(localStorage)).toEqual([])
    expect(loadTableSnapshot('table', GUEST_ID)).toBe(null)
  })
})
