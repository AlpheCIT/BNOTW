import { describe, it, expect } from 'vitest'
import { trimForStorage } from './useTracker'
import type { HandRecord } from '../engine/playerStats'

function hand(at: number, extra: Partial<HandRecord> = {}): HandRecord {
  return {
    at, mode: 'table', handNumber: at, bomb: false, position: 'other', hole: 'As Kd',
    couldStraddle: true, straddled: false, vpip: true, pfr: false, facedRaise: false,
    threeBet: false, sawFlop: true, showdown: false, wonShowdown: false, net: 0,
    aggressive: 0, passive: 0, dexterHeld: false, dexterWon: false, decisions: [],
    replay: { handNumber: at } as never,
    ...extra,
  } as HandRecord
}

/** Newest first, as the log is held. */
function history(count: number, noteEvery = 0): HandRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const at = count - i
    return hand(at, noteEvery && at % noteEvery === 0 ? { note: `note ${at}` } : {})
  })
}

describe('trimming the fallback log', () => {
  it('keeps the newest hands when nothing is noted', () => {
    const kept = trimForStorage(history(900), 600, 150)
    expect(kept).toHaveLength(600)
    expect(kept[0].handNumber).toBe(900)
    expect(kept.at(-1)!.handNumber).toBe(301)
  })

  it('keeps replays only for the newest, as before', () => {
    const kept = trimForStorage(history(900), 600, 150)
    expect(kept.filter((h) => h.replay)).toHaveLength(150)
    expect(kept.slice(0, 150).every((h) => h.replay)).toBe(true)
  })

  it('never trims away a noted hand, however old', () => {
    // One note on the very first hand of a long history.
    const hands = history(900)
    hands[hands.length - 1] = hand(1, { note: 'the one I want to remember' })

    const kept = trimForStorage(hands, 600, 150)
    const survivor = kept.find((h) => h.handNumber === 1)
    expect(survivor?.note).toBe('the one I want to remember')
  })

  it('keeps a noted hand its replay, however old', () => {
    const hands = history(900)
    hands[hands.length - 1] = hand(1, { note: 'kept' })

    const kept = trimForStorage(hands, 600, 150)
    expect(kept.find((h) => h.handNumber === 1)?.replay).toBeTruthy()
  })

  it('keeps every note even when they outnumber the replay budget', () => {
    // 90 noted hands against a replay budget of 10.
    const hands = history(900, 10)
    const noted = hands.filter((h) => h.note).length
    expect(noted).toBe(90)

    const kept = trimForStorage(hands, 600, 10)
    expect(kept.filter((h) => h.note)).toHaveLength(90)
    expect(kept.filter((h) => h.note).every((h) => h.replay)).toBe(true)
  })

  it('spends the history budget on notes first, then the newest', () => {
    const hands = history(900, 3) // 300 noted
    const kept = trimForStorage(hands, 400, 50)

    expect(kept).toHaveLength(400)
    expect(kept.filter((h) => h.note)).toHaveLength(300)
  })

  it('still reads newest first after mixing old notes back in', () => {
    const hands = history(300)
    hands[hands.length - 1] = hand(1, { note: 'old' })
    const kept = trimForStorage(hands, 200, 50)

    for (let i = 1; i < kept.length; i++) {
      expect(kept[i - 1].at, `index ${i}`).toBeGreaterThan(kept[i].at)
    }
  })

  it('does nothing to a history that already fits', () => {
    const hands = history(20)
    expect(trimForStorage(hands, 600, 150)).toHaveLength(20)
    expect(trimForStorage(hands, 600, 150).every((h) => h.replay)).toBe(true)
  })
})
