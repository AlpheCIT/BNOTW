/**
 * The frequency numbers against real hands, rather than against arithmetic.
 *
 * `frequency.test.ts` proves the formulas. This proves the coach hands them
 * the right two numbers, which is the part that can go wrong without any of
 * those tests noticing: reading the call amount as the bet overstates every
 * raise, and it does so silently.
 */

import { describe, it, expect } from 'vitest'
import { mulberry32, parseCards } from './cards'
import { applyAction, dealHand, legalActions, potTotal } from './hand'
import { evenSeats, newHand, stackedShoe } from './testkit'
import { advise, aggressorRisk } from './coach'
import { alpha } from './frequency'
import { BIG_BLIND } from './bnotw'

const rng = mulberry32(20260916)
const DECK = 'As Ks  Qh Jh  9c 8c  7d 6d  2h 3h 4h  5s  6s'

/** Four-handed, dealt, blinds up, straddle window closed. */
function dealt() {
  const seats = evenSeats(4)
  const state = newHand(seats, 3)
  dealHand(state, seats, stackedShoe(DECK))
  if (state.phase === 'straddles') state.phase = 'acting'
  return { seats, state }
}

describe('what the aggressor actually risked', () => {
  it('is the amount the big blind put up over the small, before anyone acts', () => {
    const { state } = dealt()
    // The blinds are a bet nobody raised over: the gap between the two levels.
    const levels = Object.values(state.players)
      .map((p) => p.committedRound)
      .sort((a, b) => b - a)
    expect(aggressorRisk(state)).toBe(levels[0] - levels[1])
  })

  it('is the raise on top, not the total, once somebody raises', () => {
    const { seats, state } = dealt()
    const first = state.actingSeat!
    applyAction(state, seats, first, { kind: 'raise', amount: BIG_BLIND * 3 })

    expect(state.currentBet).toBe(BIG_BLIND * 3)
    // Raised to $1.50 over a $0.50 big blind: $1.00 went in on top.
    expect(aggressorRisk(state)).toBe(BIG_BLIND * 3 - BIG_BLIND)
  })

  it('is the re-raise on top of the raise, not on top of the blind', () => {
    const { seats, state } = dealt()
    applyAction(state, seats, state.actingSeat!, { kind: 'raise', amount: BIG_BLIND * 3 })
    applyAction(state, seats, state.actingSeat!, { kind: 'raise', amount: BIG_BLIND * 9 })

    expect(aggressorRisk(state)).toBe(BIG_BLIND * 9 - BIG_BLIND * 3)
  })

  it('is nothing at all in a round where everybody checked', () => {
    const { state } = dealt()
    state.currentBet = 0
    for (const p of Object.values(state.players)) p.committedRound = 0
    expect(aggressorRisk(state)).toBe(0)
  })
})

describe('what the coach reports facing a bet', () => {
  it('prices a raise off what went in on top, not off the call', () => {
    const { seats, state } = dealt()
    applyAction(state, seats, state.actingSeat!, { kind: 'raise', amount: BIG_BLIND * 3 })

    const hero = state.actingSeat!
    const advice = advise(state, seats, hero, rng, 200)
    expect(advice.defence).not.toBeNull()

    const risk = BIG_BLIND * 3 - BIG_BLIND
    expect(advice.defence!.risk).toBe(risk)
    expect(advice.defence!.potBefore).toBe(potTotal(state) - risk)
  })

  it('does not price the raise off the hero’s own call amount', () => {
    /*
     * The mistake this helper exists to avoid, asserted from the seat where it
     * actually bites.
     *
     * The big blind is no good for this and that is worth writing down: facing
     * a raise, what the big blind must call and what the raiser put in on top
     * are the same number, because both are measured over the same big blind.
     * They only come apart for somebody holding a different amount — the small
     * blind, who has $0.25 in and must find $1.25 while the raiser risked
     * $1.00. Confusing the two there prices the bet as a quarter bigger than
     * it was.
     */
    const { seats, state } = dealt()
    applyAction(state, seats, state.actingSeat!, { kind: 'raise', amount: BIG_BLIND * 3 })

    const hero = state.smallBlindSeat
    expect(hero).not.toBeNull()
    state.actingSeat = hero
    const legal = legalActions(state, seats, hero!)
    const advice = advise(state, seats, hero!, rng, 200)

    const risk = BIG_BLIND * 3 - BIG_BLIND
    expect(legal.callAmount).not.toBe(risk)
    expect(advice.defence!.risk).toBe(risk)
    expect(advice.defence!.alpha).not.toBeCloseTo(
      alpha(potTotal(state) - legal.callAmount, legal.callAmount), 6,
    )
  })

  it('says nothing about defending when there is nothing to call', () => {
    const { seats, state } = dealt()
    state.street = 'flop'
    state.board = parseCards('2c 7h 9d')
    state.currentBet = 0
    for (const p of Object.values(state.players)) p.committedRound = 0
    state.phase = 'acting'
    state.actingSeat = state.order[0]

    const advice = advise(state, seats, state.actingSeat!, rng, 200)
    expect(advice.defence).toBeNull()
    // …and offers the other side of the coin instead: a pot-sized bet here
    // carries one bluff for every two value bets.
    expect(advice.bluffing).not.toBeNull()
    expect(advice.bluffing!.perBluff).toBeCloseTo(2, 6)
    expect(advice.bluffing!.exact).toBe(false)
  })

  it('calls the ratio exact only once there are no cards to come', () => {
    const { seats, state } = dealt()
    state.street = 'river'
    state.board = parseCards('2c 7h 9d Ts 3h')
    state.currentBet = 0
    for (const p of Object.values(state.players)) p.committedRound = 0
    state.phase = 'acting'
    state.actingSeat = state.order[0]

    const advice = advise(state, seats, state.actingSeat!, rng, 200)
    expect(advice.bluffing!.exact).toBe(true)
  })

  it('shares the defending out when the pot is multiway', () => {
    const { seats, state } = dealt()
    applyAction(state, seats, state.actingSeat!, { kind: 'raise', amount: BIG_BLIND * 3 })

    const advice = advise(state, seats, state.actingSeat!, rng, 200)
    expect(advice.defence!.defenders).toBeGreaterThan(1)
    expect(advice.defence!.share).toBeLessThan(advice.defence!.defence)
  })
})
