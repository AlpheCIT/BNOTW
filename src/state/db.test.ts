import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { emptyTotals, type HandRecord, type PlayerTotals } from '../engine/playerStats'

/**
 * A fresh database per test.
 *
 * `openDb` caches its connection in a module-level promise, so the module has
 * to be re-imported alongside a new factory or every test after the first
 * would talk to the previous test's data.
 */
async function freshDb() {
  indexedDB = new IDBFactory()
  vi.resetModules()
  return import('./db')
}

function hand(at: number, overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    at,
    mode: 'table',
    handNumber: at,
    bomb: false,
    position: 'other',
    hole: 'As Kd',
    couldStraddle: true,
    straddled: false,
    vpip: true,
    pfr: false,
    facedRaise: false,
    threeBet: false,
    sawFlop: true,
    showdown: false,
    wonShowdown: false,
    net: 100,
    aggressive: 1,
    passive: 0,
    dexterHeld: false,
    dexterWon: false,
    decisions: [],
    ...overrides,
  } as HandRecord
}

function totalsWith(hands: number): PlayerTotals {
  return { ...emptyTotals(), hands }
}

describe('keeping the history', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('stores a hand and reads it back', async () => {
    const db = await freshDb()
    expect(await db.appendHand(hand(1), totalsWith(1))).toBe(true)

    expect(await db.countHands()).toBe(1)
    expect((await db.readRecentHands())[0].handNumber).toBe(1)
    expect((await db.readTotals())?.hands).toBe(1)
  })

  it('returns the newest hands first', async () => {
    const db = await freshDb()
    for (const at of [1, 2, 3, 4, 5]) await db.appendHand(hand(at), totalsWith(at))

    expect((await db.readRecentHands()).map((h) => h.handNumber)).toEqual([5, 4, 3, 2, 1])
  })

  it('reads only the window asked for, not the whole history', async () => {
    const db = await freshDb()
    for (let at = 1; at <= 50; at++) await db.appendHand(hand(at), totalsWith(at))

    const recent = await db.readRecentHands(10)
    expect(recent).toHaveLength(10)
    expect(recent[0].handNumber).toBe(50)
    // Everything is still there; only the read was narrowed.
    expect(await db.countHands()).toBe(50)
  })

  it('keeps every hand, past anything localStorage could have held', async () => {
    const db = await freshDb()
    // Well past the old 600-hand cap, which is the entire point of the change.
    for (let at = 1; at <= 1500; at++) await db.appendHand(hand(at), totalsWith(at))

    expect(await db.countHands()).toBe(1500)
    expect((await db.readAllHands())).toHaveLength(1500)
    // Still in play order, oldest first.
    const all = await db.readAllHands()
    expect(all[0].handNumber).toBe(1)
    expect(all.at(-1)!.handNumber).toBe(1500)
  })

  it('keeps replays rather than shedding them as the history grows', async () => {
    const db = await freshDb()
    for (let at = 1; at <= 400; at++) {
      await db.appendHand(hand(at, { replay: { handNumber: at } as never }), totalsWith(at))
    }
    const all = await db.readAllHands()
    expect(all.every((h) => h.replay)).toBe(true)
  })

  it('replaces everything when asked, for a migration or a reset', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(1))

    expect(await db.replaceAll([hand(10), hand(11)], totalsWith(2))).toBe(true)
    expect(await db.countHands()).toBe(2)
    expect((await db.readAllHands()).map((h) => h.handNumber)).toEqual([10, 11])
    expect((await db.readTotals())?.hands).toBe(2)
  })

  it('orders an out-of-order import by when the hands were played', async () => {
    const db = await freshDb()
    await db.replaceAll([hand(30), hand(10), hand(20)], totalsWith(3))
    expect((await db.readRecentHands()).map((h) => h.handNumber)).toEqual([30, 20, 10])
  })

  it('empties cleanly', async () => {
    const db = await freshDb()
    for (const at of [1, 2, 3]) await db.appendHand(hand(at), totalsWith(at))
    await db.replaceAll([], emptyTotals())

    expect(await db.countHands()).toBe(0)
    expect(await db.readRecentHands()).toEqual([])
  })

  it('does not leak the store key into the records it hands back', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(1))
    expect((await db.readRecentHands())[0]).not.toHaveProperty('key')
    expect((await db.readAllHands())[0]).not.toHaveProperty('key')
  })
})

describe('notes on a hand', () => {
  it('attaches a note and reads it back', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1700), totalsWith(1))

    expect(await db.setNote(1700, '  had him on a draw  ')).toBe(true)
    expect((await db.readRecentHands())[0].note).toBe('had him on a draw')
  })

  it('replaces a note without disturbing the hand', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1700, { net: 250 }), totalsWith(1))
    await db.setNote(1700, 'first thought')
    await db.setNote(1700, 'second thought')

    const stored = (await db.readRecentHands())[0]
    expect(stored.note).toBe('second thought')
    expect(stored.net).toBe(250)
  })

  it('clears a note when given nothing', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1700), totalsWith(1))
    await db.setNote(1700, 'never mind')
    await db.setNote(1700, '   ')

    expect((await db.readRecentHands())[0].note).toBeUndefined()
  })

  it('notes the right hand out of many', async () => {
    const db = await freshDb()
    for (const at of [10, 20, 30]) await db.appendHand(hand(at), totalsWith(at))
    await db.setNote(20, 'this one')

    const all = await db.readAllHands()
    expect(all.find((h) => h.at === 20)?.note).toBe('this one')
    expect(all.filter((h) => h.note)).toHaveLength(1)
  })

  it('says so rather than throwing when the hand is not stored', async () => {
    const db = await freshDb()
    expect(await db.setNote(999999, 'nothing to attach to')).toBe(false)
  })

  it('survives a history far past anything localStorage would hold', async () => {
    const db = await freshDb()
    for (let at = 1; at <= 1200; at++) await db.appendHand(hand(at), totalsWith(at))
    await db.setNote(1, 'the very first hand')

    // Nothing is evicted here at all, which is the whole point of the store.
    const all = await db.readAllHands()
    expect(all).toHaveLength(1200)
    expect(all.find((h) => h.at === 1)?.note).toBe('the very first hand')
  })
})

describe('when IndexedDB cannot be used', () => {
  it('reports unavailable rather than throwing, so the caller can fall back', async () => {
    vi.resetModules()
    // Private browsing and locked-down profiles do both of these.
    const original = globalThis.indexedDB
    // @ts-expect-error deliberately removing it
    delete globalThis.indexedDB
    const db = await import('./db')

    expect(await db.openDb()).toBe(null)
    expect(await db.appendHand(hand(1), emptyTotals())).toBe(false)
    expect(await db.readTotals()).toBe(null)
    expect(await db.readRecentHands()).toEqual([])
    expect(await db.readAllHands()).toEqual([])
    expect(await db.countHands()).toBe(0)
    expect(await db.replaceAll([hand(1)], emptyTotals())).toBe(false)
    expect(await db.setNote(1, 'x')).toBe(false)

    globalThis.indexedDB = original
  })

  it('survives open() throwing outright', async () => {
    vi.resetModules()
    const original = globalThis.indexedDB
    globalThis.indexedDB = {
      open: () => { throw new Error('SecurityError') },
    } as unknown as IDBFactory
    const db = await import('./db')

    expect(await db.openDb()).toBe(null)
    globalThis.indexedDB = original
  })
})
