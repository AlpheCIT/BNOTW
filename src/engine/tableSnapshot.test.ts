import { describe, it, expect } from 'vitest'
import { Table } from './table'
import { defaultRoster } from './persona'
import { mulberry32 } from './cards'
import { decideAction, decideDiscard } from './ai'
import { BUY_IN_CHIPS } from './bnotw'

/** Play `hands` out, so the table carries real state rather than a fresh deal. */
function playedTable(hands = 14, seed = 5): Table {
  const table = new Table({ opponents: defaultRoster().slice(0, 5) }, seed)
  const rng = mulberry32(seed * 31 + 7)
  for (let i = 0; i < hands; i++) {
    for (const s of table.seats) if (s.stack < 200) table.rebuy(s.seat)
    const hand = table.startHand()
    if (hand.phase === 'straddles') table.closeStraddles()
    for (let g = 0; g < 5000 && !hand.complete; g++) {
      switch (hand.phase) {
        case 'acting': {
          const seat = hand.actingSeat!
          table.act(seat, decideAction({ state: hand, seats: table.seats, seat, rng }))
          break
        }
        case 'discard': {
          const seat = hand.pendingDiscards[0]
          table.discard(seat, decideDiscard(hand, seat, rng))
          break
        }
        case 'street': table.advance(); break
        case 'dexterShow': table.resolveDexter(true); break
        default: throw new Error(`Stuck in ${hand.phase}`)
      }
    }
    table.finishHand()
  }
  return table
}

/** What a fresh table would be built with, so a restore has something to overwrite. */
function emptyTable(): Table {
  return new Table({ opponents: defaultRoster().slice(0, 5) }, 99)
}

describe('carrying a session across a restart', () => {
  it('brings back everything the night is settled from', () => {
    const before = playedTable()
    const json = JSON.parse(JSON.stringify(before.snapshot()))

    const after = emptyTable()
    expect(after.restore(json)).toBe(true)

    // These are exactly the fields Cash Out turns into a GameNight.
    expect(after.seats.map((s) => s.stack)).toEqual(before.seats.map((s) => s.stack))
    expect(after.seats.map((s) => s.buyIns)).toEqual(before.seats.map((s) => s.buyIns))
    expect(after.seats.map((s) => s.name)).toEqual(before.seats.map((s) => s.name))
    expect(after.seats.map((s) => s.sittingOut)).toEqual(before.seats.map((s) => s.sittingOut))
    expect(after.dexterCount).toBe(before.dexterCount)
    expect(after.dexterLog).toEqual(before.dexterLog)
    expect(after.handsPlayed).toBe(before.handsPlayed)
  })

  it('keeps the button and the bomb-pot schedule where they were', () => {
    const before = playedTable()
    const after = emptyTable()
    after.restore(JSON.parse(JSON.stringify(before.snapshot())))

    expect(after.regularButtonSeat).toBe(before.regularButtonSeat)
    expect(after.bombRunLength).toBe(before.bombRunLength)
    expect(after.handsSinceBomb).toBe(before.handsSinceBomb)
    expect(after.pendingBomb).toBe(before.pendingBomb)
    expect(after.handNumber).toBe(before.handNumber)
  })

  it('does not owe you a bomb pot for having closed the app', () => {
    const before = playedTable()
    before.lastBombAt = Date.now() - 6 * 60 * 60 * 1000 // shut for six hours

    const after = new Table(
      { opponents: defaultRoster().slice(0, 5), bombPotTrigger: 'time', bombPotMinutes: 12 },
      99,
    )
    after.restore(JSON.parse(JSON.stringify(before.snapshot())))

    // The clock restarts on reopening; six hours of being closed is not
    // twelve minutes of play.
    expect(after.bombPotDue()).toBe(null)
  })

  it('drops the hand in progress rather than half-restoring it', () => {
    const before = playedTable()
    before.startHand()
    expect(before.hand).not.toBe(null)

    const after = emptyTable()
    after.restore(JSON.parse(JSON.stringify(before.snapshot())))
    expect(after.hand).toBe(null)
  })

  it('survives a round trip through JSON unchanged', () => {
    const table = playedTable()
    const once = JSON.parse(JSON.stringify(table.snapshot()))
    const restored = emptyTable()
    restored.restore(once)
    const twice = JSON.parse(JSON.stringify(restored.snapshot()))

    // savedAt is the moment of writing, so it is expected to differ.
    delete once.savedAt
    delete twice.savedAt
    expect(twice).toEqual(once)
  })

  it('does not hand out a copy that the live table keeps mutating', () => {
    const table = playedTable()
    const snapshot = table.snapshot()
    const stackBefore = snapshot.seats[0].stack

    table.rebuy(0)

    expect(snapshot.seats[0].stack).toBe(stackBefore)
    expect(table.seats[0].stack).toBe(stackBefore + BUY_IN_CHIPS)
  })

  it('bumps the version so React re-renders against the restored table', () => {
    const before = playedTable()
    const after = emptyTable()
    const version = after.getVersion()
    after.restore(JSON.parse(JSON.stringify(before.snapshot())))
    expect(after.getVersion()).toBeGreaterThan(version)
  })
})

describe('refusing a snapshot that cannot be trusted', () => {
  const good = () => JSON.parse(JSON.stringify(playedTable(3).snapshot()))

  it('turns down nothing at all', () => {
    const table = emptyTable()
    expect(table.restore(null)).toBe(false)
    expect(table.restore(undefined)).toBe(false)
  })

  it('turns down a version it does not know', () => {
    const table = emptyTable()
    expect(table.restore({ ...good(), version: 2 as never })).toBe(false)
  })

  it('turns down a table nobody could be sitting at', () => {
    const table = emptyTable()
    expect(table.restore({ ...good(), seats: [] })).toBe(false)
    expect(table.restore({ ...good(), seats: undefined as never })).toBe(false)
    expect(table.restore({ ...good(), seats: good().seats.slice(0, 1) })).toBe(false)
  })

  it('turns down one where seat zero is not you', () => {
    const snapshot = good()
    snapshot.seats[0].isHuman = false
    expect(emptyTable().restore(snapshot)).toBe(false)
  })

  it('leaves the table untouched when it refuses', () => {
    const table = emptyTable()
    const stacks = table.seats.map((s) => s.stack)
    expect(table.restore({ ...good(), seats: [] })).toBe(false)
    expect(table.seats.map((s) => s.stack)).toEqual(stacks)
    expect(table.seats.every((s) => s.stack === BUY_IN_CHIPS)).toBe(true)
  })

  it('repairs a mangled number rather than carrying NaN into the ledger', () => {
    const snapshot = good()
    snapshot.seats[1].stack = 'lots' as never
    snapshot.seats[1].buyIns = NaN as never
    snapshot.dexterCount = null as never
    snapshot.regularButtonSeat = 47

    const table = emptyTable()
    expect(table.restore(snapshot)).toBe(true)
    expect(table.seats[1].stack).toBe(0)
    expect(table.seats[1].buyIns).toBe(1)
    expect(table.dexterCount).toBe(0)
    // Out of range rather than merely wrong: a button off the table would
    // throw the moment a hand was dealt.
    expect(table.regularButtonSeat).toBeLessThan(table.seats.length)
  })

  it('can still deal a hand after restoring a repaired snapshot', () => {
    const snapshot = good()
    snapshot.regularButtonSeat = 47
    const table = emptyTable()
    table.restore(snapshot)
    expect(() => table.startHand()).not.toThrow()
    expect(table.hand).not.toBe(null)
  })
})
