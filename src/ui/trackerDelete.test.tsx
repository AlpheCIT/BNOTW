// @vitest-environment jsdom
/**
 * Deleting hands, end to end through the hook.
 *
 * The two halves of a delete have to move together: the hands leave the list
 * and the totals lose exactly their contribution. A test that only checks the
 * list would pass on a record that still counted the deleted hands in your
 * rating — which is the thing the feature exists to fix.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { renderHook, act, waitFor } from '@testing-library/react'
import { accumulate, emptyTotals, type HandRecord } from '../engine/playerStats'
import { DEFAULT_PROFILE_ID } from '../state/profiles'

const ME = DEFAULT_PROFILE_ID

function hand(at: number, mode: 'table' | 'coach', evLost: number): HandRecord {
  return {
    at,
    mode,
    handNumber: at,
    bomb: false,
    position: 'other',
    hole: 'As Kd',
    couldStraddle: true,
    straddled: false,
    vpip: true,
    pfr: mode === 'table',
    facedRaise: false,
    threeBet: false,
    sawFlop: true,
    showdown: false,
    wonShowdown: false,
    net: mode === 'table' ? 400 : -900,
    aggressive: 1,
    passive: 0,
    dexterHeld: false,
    dexterWon: false,
    decisions: [{
      street: 'flop',
      action: 'call',
      recommended: evLost > 0 ? 'fold' : 'call',
      agreed: evLost === 0,
      evLost,
      leak: evLost > 0 ? 'calling too wide' : null,
    }],
  }
}

const REAL = [hand(1000, 'table', 0), hand(1100, 'table', 0)]
const TESTING = [hand(2000, 'coach', 1500), hand(2100, 'coach', 1800)]

/**
 * A fresh store seeded with a history, and the hook hydrated from it.
 *
 * The modules are re-imported alongside a new factory because `openDb` caches
 * its connection for the life of the module.
 */
async function trackerWith(hands: HandRecord[]) {
  indexedDB = new IDBFactory()
  localStorage.clear()
  vi.resetModules()
  const db = await import('../state/db')
  await db.replaceAll(hands, hands.reduce(accumulate, emptyTotals()), ME)

  const { useTracker } = await import('./useTracker')
  const view = renderHook(() => useTracker())
  await waitFor(() => expect(view.result.current.recent.length).toBe(hands.length))
  return { view, db }
}

describe('deleting hands through the tracker', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('removes the hands from the list and from the totals together', async () => {
    const { view } = await trackerWith([...REAL, ...TESTING])
    expect(view.result.current.totals.hands).toBe(4)
    expect(view.result.current.totals.evLost).toBe(3300)

    await act(async () => {
      view.result.current.deleteHands(TESTING.map((h) => h.at))
    })

    expect(view.result.current.recent.map((h) => h.at)).toEqual([1100, 1000])
    expect(view.result.current.totals.hands).toBe(2)
    expect(view.result.current.totals.handsByMode.coach).toBe(0)
    // The leak went with the hands that had it, not just the rows.
    expect(view.result.current.totals.evLost).toBe(0)
    expect(view.result.current.totals.leaks).toEqual({})
  })

  it('leaves the totals a history without those hands would have had', async () => {
    const { view } = await trackerWith([...REAL, ...TESTING])
    await act(async () => {
      view.result.current.deleteHands(TESTING.map((h) => h.at))
    })

    const never = REAL.reduce(accumulate, emptyTotals())
    const { firstAt: _f, lastAt: _l, ...after } = view.result.current.totals
    const { firstAt: _f2, lastAt: _l2, ...want } = never
    expect(after).toEqual(want)
  })

  it('writes the delete through to the store, so it survives a reload', async () => {
    const { view, db } = await trackerWith([...REAL, ...TESTING])
    await act(async () => {
      view.result.current.deleteHands([TESTING[0].at])
    })

    await waitFor(async () => {
      expect((await db.readAllHands(ME)).map((h) => h.at)).toEqual([1000, 1100, 2100])
    })
    expect((await db.readTotals(ME))?.hands).toBe(3)
  })

  it('ignores a hand it is not holding rather than corrupting the totals', async () => {
    const { view } = await trackerWith(REAL)
    await act(async () => {
      // 9999 was never played. Subtracting a guess at it would be worse than
      // doing nothing.
      view.result.current.deleteHands([9999])
    })
    expect(view.result.current.totals.hands).toBe(2)
    expect(view.result.current.recent).toHaveLength(2)
  })

  it('subtracts a hand once when it is named twice', async () => {
    const { view } = await trackerWith(REAL)
    await act(async () => {
      view.result.current.deleteHands([1000, 1000])
    })
    expect(view.result.current.totals.hands).toBe(1)
    expect(view.result.current.recent.map((h) => h.at)).toEqual([1100])
  })

  it('empties cleanly when every hand goes', async () => {
    const { view, db } = await trackerWith([...REAL, ...TESTING])
    await act(async () => {
      view.result.current.deleteHands([...REAL, ...TESTING].map((h) => h.at))
    })

    expect(view.result.current.recent).toEqual([])
    expect(view.result.current.totals).toEqual(emptyTotals())
    await waitFor(async () => expect(await db.countHands(ME)).toBe(0))
  })
})
