import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { emptyTotals, type HandRecord, type PlayerTotals } from '../engine/playerStats'
import { DEFAULT_PROFILE_ID } from './profiles'

/** Whose history these tests are about, unless they say otherwise. */
const ME = DEFAULT_PROFILE_ID

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
    expect(await db.appendHand(hand(1), totalsWith(1), ME)).toBe(true)

    expect(await db.countHands(ME)).toBe(1)
    expect((await db.readRecentHands(ME))[0].handNumber).toBe(1)
    expect((await db.readTotals(ME))?.hands).toBe(1)
  })

  it('returns the newest hands first', async () => {
    const db = await freshDb()
    for (const at of [1, 2, 3, 4, 5]) await db.appendHand(hand(at), totalsWith(at), ME)

    expect((await db.readRecentHands(ME)).map((h) => h.handNumber)).toEqual([5, 4, 3, 2, 1])
  })

  it('reads only the window asked for, not the whole history', async () => {
    const db = await freshDb()
    for (let at = 1; at <= 50; at++) await db.appendHand(hand(at), totalsWith(at), ME)

    const recent = await db.readRecentHands(ME, 10)
    expect(recent).toHaveLength(10)
    expect(recent[0].handNumber).toBe(50)
    // Everything is still there; only the read was narrowed.
    expect(await db.countHands(ME)).toBe(50)
  })

  it('keeps every hand, past anything localStorage could have held', async () => {
    const db = await freshDb()
    // Well past the old 600-hand cap, which is the entire point of the change.
    for (let at = 1; at <= 1500; at++) await db.appendHand(hand(at), totalsWith(at), ME)

    expect(await db.countHands(ME)).toBe(1500)
    expect((await db.readAllHands(ME))).toHaveLength(1500)
    // Still in play order, oldest first.
    const all = await db.readAllHands(ME)
    expect(all[0].handNumber).toBe(1)
    expect(all.at(-1)!.handNumber).toBe(1500)
  })

  it('keeps replays rather than shedding them as the history grows', async () => {
    const db = await freshDb()
    for (let at = 1; at <= 400; at++) {
      await db.appendHand(hand(at, { replay: { handNumber: at } as never }), totalsWith(at), ME)
    }
    const all = await db.readAllHands(ME)
    expect(all.every((h) => h.replay)).toBe(true)
  })

  it('replaces everything when asked, for a migration or a reset', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(1), ME)

    expect(await db.replaceAll([hand(10), hand(11)], totalsWith(2), ME)).toBe(true)
    expect(await db.countHands(ME)).toBe(2)
    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([10, 11])
    expect((await db.readTotals(ME))?.hands).toBe(2)
  })

  it('orders an out-of-order import by when the hands were played', async () => {
    const db = await freshDb()
    await db.replaceAll([hand(30), hand(10), hand(20)], totalsWith(3), ME)
    expect((await db.readRecentHands(ME)).map((h) => h.handNumber)).toEqual([30, 20, 10])
  })

  it('empties cleanly', async () => {
    const db = await freshDb()
    for (const at of [1, 2, 3]) await db.appendHand(hand(at), totalsWith(at), ME)
    await db.replaceAll([], emptyTotals(), ME)

    expect(await db.countHands(ME)).toBe(0)
    expect(await db.readRecentHands(ME)).toEqual([])
  })

  it('deletes the hands asked for and leaves the rest alone', async () => {
    const db = await freshDb()
    for (const at of [1, 2, 3, 4, 5]) await db.appendHand(hand(at), totalsWith(at), ME)

    expect(await db.deleteHands([2, 4], totalsWith(3), ME)).toBe(2)
    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([1, 3, 5])
    // The totals come from the caller, which has already subtracted them.
    expect((await db.readTotals(ME))?.hands).toBe(3)
  })

  it('ignores a hand that is not there rather than failing the whole delete', async () => {
    const db = await freshDb()
    for (const at of [1, 2, 3]) await db.appendHand(hand(at), totalsWith(at), ME)

    // 99 was trimmed, or never stored. The other two still have to go.
    expect(await db.deleteHands([1, 99, 3], totalsWith(1), ME)).toBe(2)
    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([2])
  })

  it('writes no totals for an empty delete', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(1), ME)

    expect(await db.deleteHands([], totalsWith(99), ME)).toBe(0)
    expect(await db.countHands(ME)).toBe(1)
    // A no-op must not overwrite a good record with whatever was passed in.
    expect((await db.readTotals(ME))?.hands).toBe(1)
  })

  it('removes every copy of a duplicated hand, not just the first', async () => {
    const db = await freshDb()
    // Two records sharing a timestamp should not survive being deleted.
    await db.appendHand(hand(7), totalsWith(1), ME)
    await db.appendHand(hand(7), totalsWith(2), ME)
    await db.appendHand(hand(8), totalsWith(3), ME)

    expect(await db.deleteHands([7], totalsWith(1), ME)).toBe(2)
    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([8])
  })

  it('keeps one profile\u2019s hands out of another\u2019s history', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(1), ME)
    await db.appendHand(hand(2), totalsWith(2), ME)
    await db.appendHand(hand(3), totalsWith(1), 'dave')

    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([1, 2])
    expect((await db.readAllHands('dave')).map((h) => h.handNumber)).toEqual([3])
    expect(await db.countHands(ME)).toBe(2)
    expect(await db.countHands('dave')).toBe(1)
  })

  it('keeps the totals apart too', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(9), ME)
    await db.appendHand(hand(2), totalsWith(4), 'dave')

    expect((await db.readTotals(ME))?.hands).toBe(9)
    expect((await db.readTotals('dave'))?.hands).toBe(4)
    // Somebody who has never played has no totals, not zeroed ones.
    expect(await db.readTotals('nobody')).toBe(null)
  })

  it('does not take everyone else down with a reset', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(1), ME)
    await db.appendHand(hand(2), totalsWith(1), 'dave')

    await db.replaceAll([], emptyTotals(), ME)

    expect(await db.countHands(ME)).toBe(0)
    // Dave did not ask for his history to be erased.
    expect(await db.countHands('dave')).toBe(1)
    expect((await db.readTotals('dave'))?.hands).toBe(1)
  })

  it('deletes only from the profile that asked', async () => {
    const db = await freshDb()
    await db.appendHand(hand(7), totalsWith(1), ME)
    await db.appendHand(hand(7), totalsWith(1), 'dave')

    // The same timestamp in two histories. Only one of them goes.
    expect(await db.deleteHands([7], totalsWith(0), ME)).toBe(1)
    expect(await db.countHands('dave')).toBe(1)
  })

  it('notes a hand in the right history when two share a timestamp', async () => {
    const db = await freshDb()
    await db.appendHand(hand(7), totalsWith(1), ME)
    await db.appendHand(hand(7), totalsWith(1), 'dave')

    expect(await db.setNote(7, 'mine', ME)).toBe(true)
    expect((await db.readAllHands(ME))[0].note).toBe('mine')
    expect((await db.readAllHands('dave'))[0].note).toBeUndefined()
  })

  it('reads a profile\u2019s recent hands newest first, past other profiles', async () => {
    const db = await freshDb()
    for (const at of [1, 3, 5]) await db.appendHand(hand(at), totalsWith(at), ME)
    for (const at of [2, 4, 6]) await db.appendHand(hand(at), totalsWith(at), 'dave')

    expect((await db.readRecentHands(ME, 2)).map((h) => h.handNumber)).toEqual([5, 3])
  })

  it('does not leak the store key into the records it hands back', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1), totalsWith(1), ME)
    expect((await db.readRecentHands(ME))[0]).not.toHaveProperty('key')
    expect((await db.readAllHands(ME))[0]).not.toHaveProperty('key')
  })
})

describe('notes on a hand', () => {
  it('attaches a note and reads it back', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1700), totalsWith(1), ME)

    expect(await db.setNote(1700, '  had him on a draw  ', ME)).toBe(true)
    expect((await db.readRecentHands(ME))[0].note).toBe('had him on a draw')
  })

  it('replaces a note without disturbing the hand', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1700, { net: 250 }), totalsWith(1), ME)
    await db.setNote(1700, 'first thought', ME)
    await db.setNote(1700, 'second thought', ME)

    const stored = (await db.readRecentHands(ME))[0]
    expect(stored.note).toBe('second thought')
    expect(stored.net).toBe(250)
  })

  it('clears a note when given nothing', async () => {
    const db = await freshDb()
    await db.appendHand(hand(1700), totalsWith(1), ME)
    await db.setNote(1700, 'never mind', ME)
    await db.setNote(1700, '   ', ME)

    expect((await db.readRecentHands(ME))[0].note).toBeUndefined()
  })

  it('notes the right hand out of many', async () => {
    const db = await freshDb()
    for (const at of [10, 20, 30]) await db.appendHand(hand(at), totalsWith(at), ME)
    await db.setNote(20, 'this one', ME)

    const all = await db.readAllHands(ME)
    expect(all.find((h) => h.at === 20)?.note).toBe('this one')
    expect(all.filter((h) => h.note)).toHaveLength(1)
  })

  it('says so rather than throwing when the hand is not stored', async () => {
    const db = await freshDb()
    expect(await db.setNote(999999, 'nothing to attach to', ME)).toBe(false)
  })

  it('survives a history far past anything localStorage would hold', async () => {
    const db = await freshDb()
    for (let at = 1; at <= 1200; at++) await db.appendHand(hand(at), totalsWith(at), ME)
    await db.setNote(1, 'the very first hand', ME)

    // Nothing is evicted here at all, which is the whole point of the store.
    const all = await db.readAllHands(ME)
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
    expect(await db.appendHand(hand(1), emptyTotals(), ME)).toBe(false)
    expect(await db.readTotals(ME)).toBe(null)
    expect(await db.readRecentHands(ME)).toEqual([])
    expect(await db.readAllHands(ME)).toEqual([])
    expect(await db.countHands(ME)).toBe(0)
    expect(await db.replaceAll([hand(1)], emptyTotals(), ME)).toBe(false)
    expect(await db.setNote(1, 'x', ME)).toBe(false)

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

describe('upgrading a history that predates profiles', () => {
  /**
   * Build a version-1 database by hand, the way the app used to write one:
   * no `profileId` anywhere and totals under a bare key.
   */
  async function legacyDb(handsAt: number[]) {
    indexedDB = new IDBFactory()
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('bnotw', 1)
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('hands', { keyPath: 'key', autoIncrement: true })
        store.createIndex('at', 'at')
        open.result.createObjectStore('meta')
      }
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['hands', 'meta'], 'readwrite')
        for (const at of handsAt) tx.objectStore('hands').add(hand(at))
        tx.objectStore('meta').put(totalsWith(handsAt.length), 'totals')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })
    vi.resetModules()
    return import('./db')
  }

  it('gives the existing history to the person who has been playing', async () => {
    const db = await legacyDb([10, 20, 30])

    // Not to nobody, and not lost: the default profile is whoever owns this
    // device's history from before there was a way to say so.
    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([10, 20, 30])
    expect((await db.readTotals(ME))?.hands).toBe(3)
  })

  it('leaves a new profile empty rather than showing them somebody else\u2019s hands', async () => {
    const db = await legacyDb([10, 20])
    expect(await db.readAllHands('dave')).toEqual([])
    expect(await db.countHands('dave')).toBe(0)
  })

  it('carries on appending after the upgrade', async () => {
    const db = await legacyDb([10])
    expect(await db.appendHand(hand(11), totalsWith(2), ME)).toBe(true)
    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([10, 11])
  })

  it('does not re-stamp on a second open', async () => {
    const db = await legacyDb([10])
    await db.appendHand(hand(11), totalsWith(2), 'dave')
    // Dave's hand was written after the upgrade and must stay Dave's.
    expect((await db.readAllHands(ME)).map((h) => h.handNumber)).toEqual([10])
    expect((await db.readAllHands('dave')).map((h) => h.handNumber)).toEqual([11])
  })
})
