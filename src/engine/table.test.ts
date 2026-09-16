import { describe, it, expect } from 'vitest'
import { mulberry32, type Rng } from './cards'
import { BUY_IN_CHIPS, HIGH_ROLLER_THRESHOLD, dexterPayPerPlayer, dexterTotalBonus, money, owesHighRollerFee, parseMoney, chipBreakdown, CHIP_SET } from './bnotw'
import { decideAction, decideDiscard } from './ai'
import { Table } from './table'
import { potTotal } from './hand'
import type { HandState } from './types'

/**
 * Play one hand start to finish with the bots driving every seat.
 *
 * `beforeSettle` runs on the finished hand just before the table settles it,
 * for the triggers a hand raises on its way past — the only moment they can be
 * set, now that settling a hand twice is a no-op.
 */
function playHand(table: Table, rng: Rng, beforeSettle?: (hand: HandState) => void) {
  const hand = table.startHand()
  if (hand.phase === 'straddles') table.closeStraddles()

  for (let guard = 0; guard < 5000; guard++) {
    if (hand.complete) break
    switch (hand.phase) {
      case 'acting': {
        const seat = hand.actingSeat!
        table.act(seat, decideAction({ state: hand, seats: table.seats, seat, rng, trials: 30 }))
        break
      }
      case 'discard': {
        const seat = hand.pendingDiscards[0]
        table.discard(seat, decideDiscard(hand, seat, rng))
        break
      }
      case 'street':
        table.advance()
        break
      case 'dexterShow':
        table.resolveDexter(true)
        break
      default:
        throw new Error(`Stuck in phase ${hand.phase}`)
    }
  }
  if (!hand.complete) throw new Error('Hand never completed')
  beforeSettle?.(hand)
  table.finishHand()
  return hand
}

/** Chips only ever enter the table through a buy-in, so this must always hold. */
function assertChipsBalance(table: Table) {
  const stacks = table.seats.reduce((sum, s) => sum + s.stack, 0)
  const issued = table.seats.reduce((sum, s) => sum + s.buyIns * BUY_IN_CHIPS, 0)
  expect(stacks).toBe(issued)
}

describe('the dealer button', () => {
  it('moves one seat per regular hand', () => {
    const table = new Table({ botCount: 5, bombPotTrigger: 'off', straddleMultiplier: 0 }, 7)
    const rng = mulberry32(11)
    const buttons: number[] = []
    for (let i = 0; i < 6; i++) buttons.push(playHand(table, rng).buttonSeat)
    expect(buttons).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('leaves the button in place for a bomb pot and resumes the rotation after', () => {
    const table = new Table({ botCount: 5, bombPotTrigger: 'off', straddleMultiplier: 0 }, 3)
    const rng = mulberry32(5)

    table.pendingBomb = null
    expect(playHand(table, rng).buttonSeat).toBe(0)
    table.pendingBomb = null
    expect(playHand(table, rng).buttonSeat).toBe(1)

    // A bomb pot is an extra hand: the button stays exactly where it was.
    table.pendingBomb = 'test'
    const bomb = playHand(table, rng)
    expect(bomb.isBombPot).toBe(true)
    expect(bomb.buttonSeat).toBe(1)

    // Regular play resumes; nobody lost their turn on the button.
    table.pendingBomb = null
    expect(playHand(table, rng).buttonSeat).toBe(2)
  })

  it('advances one seat for a back-to-back bomb pot, then returns', () => {
    const table = new Table({ botCount: 5, bombPotTrigger: 'off', straddleMultiplier: 0 }, 9)
    const rng = mulberry32(21)

    table.pendingBomb = null
    playHand(table, rng)                       // button 0
    table.pendingBomb = null
    expect(playHand(table, rng).buttonSeat).toBe(1)

    table.pendingBomb = 'first bomb'
    expect(playHand(table, rng).buttonSeat).toBe(1)
    table.pendingBomb = 'second bomb'
    expect(playHand(table, rng).buttonSeat).toBe(2)
    table.pendingBomb = 'third bomb'
    expect(playHand(table, rng).buttonSeat).toBe(3)

    // The run ends; the regular rotation carries on from where it left off.
    table.pendingBomb = null
    expect(playHand(table, rng).buttonSeat).toBe(2)
  })
})

describe('bomb pot triggers', () => {
  it('schedules one after the configured number of hands', () => {
    const table = new Table(
      { botCount: 3, bombPotTrigger: 'hands', bombPotHands: 3, straddleMultiplier: 0 },
      4,
    )
    const rng = mulberry32(2)
    const bombs: boolean[] = []
    for (let i = 0; i < 8; i++) {
      table.pendingBomb = null // ignore any suited-flop triggers for this test
      bombs.push(playHand(table, rng).isBombPot)
    }
    expect(bombs.slice(0, 3)).toEqual([false, false, false])
    expect(bombs[3]).toBe(true)
  })

  it('queues a bomb pot after a monotone flop', () => {
    const table = new Table({ botCount: 3, bombPotTrigger: 'off', straddleMultiplier: 0 }, 1)
    const rng = mulberry32(3)
    playHand(table, rng, (hand) => { hand.suitedFlopTriggered = true })
    expect(table.bombPotDue()).toMatch(/Suited flop/)
    expect(playHand(table, rng).isBombPot).toBe(true)
  })
})

describe('self-play soak test', () => {
  it('plays 400 hands without breaking any invariant', () => {
    const table = new Table(
      { botCount: 5, bombPotTrigger: 'hands', bombPotHands: 9, straddleMultiplier: 1 },
      424242,
    )
    const rng = mulberry32(99)
    let bombs = 0
    let dexters = 0
    let straddled = 0

    for (let i = 0; i < 400; i++) {
      // Keep everyone in action so the table never runs short-handed.
      for (const seat of table.seats) if (seat.stack < 100) table.rebuy(seat.seat)

      const hand = playHand(table, rng)
      if (hand.isBombPot) bombs++
      if (hand.dexter) dexters++
      if (hand.straddles.length > 0) straddled++

      assertChipsBalance(table)
      expect(potTotal(hand)).toBeGreaterThan(0)
      // Every chip that went in must have come back out.
      const paidIn = potTotal(hand)
      const paidOut = hand.awards.reduce((sum, a) => sum + a.amount, 0)
      expect(paidOut).toBe(paidIn)
      expect(table.seats.every((s) => s.stack >= 0)).toBe(true)
    }

    expect(bombs).toBeGreaterThan(20)
    expect(straddled).toBeGreaterThan(5)
    expect(table.dexterCount).toBe(dexters)
  }, 120_000)
})

describe('BNOTW money rules', () => {
  it('formats and parses amounts', () => {
    expect(money(175)).toBe('$1.75')
    expect(money(675)).toBe('$6.75')
    expect(money(0)).toBe('$0.00')
    expect(money(-500)).toBe('-$5.00')
    expect(parseMoney('$1.75')).toBe(175)
    expect(parseMoney('42')).toBe(4200)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
  })

  it('issues exactly $40.00 in 29 chips', () => {
    const total = CHIP_SET.reduce((sum, c) => sum + c.value * c.quantity, 0)
    const count = CHIP_SET.reduce((sum, c) => sum + c.quantity, 0)
    expect(total).toBe(BUY_IN_CHIPS)
    expect(total).toBe(4000)
    expect(count).toBe(29)
  })

  it('breaks a Dave-aloo into one of every colour', () => {
    const breakdown = chipBreakdown(675)
    expect(breakdown.map((b) => `${b.count} ${b.chip.label}`))
      .toEqual(['1 Black', '1 White', '1 Red', '1 Green'])
  })

  it('breaks a Bob-aloo into one of every colour but black', () => {
    const breakdown = chipBreakdown(175)
    expect(breakdown.map((b) => `${b.count} ${b.chip.label}`))
      .toEqual(['1 White', '1 Red', '1 Green'])
  })

  it('charges the High Roller Fee only above $100 profit', () => {
    expect(owesHighRollerFee(HIGH_ROLLER_THRESHOLD)).toBe(false)
    expect(owesHighRollerFee(HIGH_ROLLER_THRESHOLD + 25)).toBe(true)
    expect(owesHighRollerFee(10500)).toBe(true)   // $105 profit, per the rules
    expect(owesHighRollerFee(9500)).toBe(false)   // $95 profit after a rebuy
  })

  it('escalates the Dexter bonus with no cap', () => {
    expect(dexterPayPerPlayer(1)).toBe(100)
    expect(dexterPayPerPlayer(4)).toBe(400)
    expect(dexterPayPerPlayer(11)).toBe(1100)
    // Seven other players at $3 a head on the third Dexter.
    expect(dexterTotalBonus(3, 8)).toBe(2100)
  })
})

describe('settling a hand', () => {
  /*
   * The table settles a hand as soon as the pot is pushed, so the session
   * survives the player closing the app on the recap, and again on the way to
   * the next deal. Both calls are real; only the first may do anything.
   */
  it('counts a hand once however many times it is settled', () => {
    const table = new Table({ botCount: 3, bombPotTrigger: 'off', straddleMultiplier: 0 }, 1)
    const rng = mulberry32(7)
    playHand(table, rng)
    expect(table.handsPlayed).toBe(1)
    table.finishHand()
    table.finishHand()
    expect(table.handsPlayed).toBe(1)
  })

  it('counts each new hand, so the guard is not simply stuck', () => {
    const table = new Table({ botCount: 3, bombPotTrigger: 'off', straddleMultiplier: 0 }, 1)
    const rng = mulberry32(8)
    for (let i = 0; i < 3; i++) playHand(table, rng)
    expect(table.handsPlayed).toBe(3)
  })

  it('does not rebuy a busted bot twice over', () => {
    const table = new Table({ botCount: 3, bombPotTrigger: 'off', straddleMultiplier: 0 }, 1)
    const rng = mulberry32(9)
    playHand(table, rng)
    const buyIns = table.seats.map((s) => s.buyIns)
    table.finishHand()
    expect(table.seats.map((s) => s.buyIns)).toEqual(buyIns)
    assertChipsBalance(table)
  })

  it('settles a restored session’s next hand, not the one already written down', () => {
    const table = new Table({ botCount: 3, bombPotTrigger: 'off', straddleMultiplier: 0 }, 1)
    const rng = mulberry32(10)
    playHand(table, rng)

    const back = new Table({ botCount: 3, bombPotTrigger: 'off', straddleMultiplier: 0 }, 1)
    expect(back.restore(table.snapshot())).toBe(true)
    expect(back.handsPlayed).toBe(1)
    playHand(back, mulberry32(11))
    expect(back.handsPlayed).toBe(2)
  })
})
