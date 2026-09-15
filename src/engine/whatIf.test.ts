/**
 * What would have happened, had you stayed.
 *
 * Most of these tests are about the cases where the honest answer is "there is
 * no answer" — a feature that quietly guesses a runout would be showing you a
 * different hand from the one you folded.
 */

import { describe, it, expect } from 'vitest'
import {
  advanceStreet, applyAction, applyDiscard, dealHand, resolveShowdown,
} from './hand'
import { cardCode, makeDeck } from './cards'
import { evenSeats, newHand, setHoleCards, stackedShoe } from './testkit'
import { isWhatIf, whatIf } from './whatIf'
import type { HandState, Seat } from './types'

const showdownOpts = (tableSeats: number[]) => ({ dexterCount: 0, tableSeats })

/**
 * Burn cards that are not already in play.
 *
 * Every street burns one, and a burn that collides with a board or hole card
 * puts the same card in two places — which the evaluator will happily score as
 * a pair. The first version of these tests did exactly that and the failure
 * looked like a bug in `whatIf` rather than in its fixture.
 */
function burns(inPlay: string[], count: number): string[] {
  const taken = new Set(inPlay)
  return makeDeck().map(cardCode).filter((c) => !taken.has(c)).slice(0, count)
}

/**
 * Deal out every remaining street, checking through each one.
 *
 * What is under test is the runout, not the betting, so nobody ever bets.
 */
function runOut(hand: HandState, seats: Seat[], board: string[], holes: string[]) {
  const needed = 5 - hand.board.length
  const toCome = board.slice(board.length - needed)
  const burn = burns([...board, ...holes.flatMap((h) => h.split(/\s+/))], 3)

  // Board cards arrive in groups: three, then one, then one — each behind its
  // own burn, and only for the streets that have not already been dealt.
  const groups = needed === 5
    ? [toCome.slice(0, 3), [toCome[3]], [toCome[4]]]
    : needed === 2 ? [[toCome[0]], [toCome[1]]] : [[toCome[0]]]
  const shoe = stackedShoe(
    groups.map((g, i) => `${burn[i]} ${g.join(' ')}`).join(' '),
  )

  let guard = 0
  while (hand.phase !== 'showdown' && guard++ < 24) {
    if (hand.phase === 'street') advanceStreet(hand, shoe)
    else if (hand.phase === 'acting') {
      applyAction(hand, seats, hand.actingSeat!, { kind: 'check' })
    } else break
  }
  resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))
}

/**
 * Three seats, hero on seat 0, folded pre-flop, the other two to the river.
 *
 * Seat 2 is the button and acts first pre-flop; seat 0 is the small blind.
 * Hole cards are stacked so the outcome is known rather than sampled.
 */
function foldedPreflop(hole: Record<number, string>, board: string) {
  const seats = evenSeats(3)
  const hand = newHand(seats, 2)
  dealHand(hand, seats, stackedShoe('2c 3c 4c 5c 6c 7c'))
  setHoleCards(hand, hole)

  applyAction(hand, seats, 2, { kind: 'call' })
  applyAction(hand, seats, 0, { kind: 'fold' })
  applyAction(hand, seats, 1, { kind: 'check' })

  runOut(hand, seats, board.split(/\s+/), Object.values(hole))
  return { hand, seats }
}

describe('how the hand would have finished', () => {
  it('says what you would have made', () => {
    const { hand, seats } = foldedPreflop(
      { 0: 'Ah Kh', 1: '7c 2d', 2: '9s 8s' },
      'Qh Jh Th 4c 3d',
    )
    const result = whatIf(hand, seats, 0)
    if (!isWhatIf(result)) throw new Error(`expected an answer, got ${result.unknown}`)

    // A royal flush is hard to argue with.
    expect(result.madeLabel).toMatch(/straight flush|royal/i)
    expect(result.wouldHaveWon).toBe(true)
    expect(result.hole).toBe('Ah Kh')
    // `cardCode` writes a ten as "10h", not "Th" — the codes it emits are
    // what the replay and the record store, so that is what is asserted.
    expect(result.board).toBe('Qh Jh 10h 4c 3d')
  })

  it('says when you would have been beaten, and by whom', () => {
    const { hand, seats } = foldedPreflop(
      { 0: 'Ah Kd', 1: '7c 7d', 2: '9s 8s' },
      'Qh Jc 2h 4c 3d',
    )
    const result = whatIf(hand, seats, 0)
    if (!isWhatIf(result)) throw new Error(`expected an answer, got ${result.unknown}`)

    expect(result.wouldHaveWon).toBe(false)
    expect(result.best?.name).toBe('P1')
    expect(result.best?.hand).toMatch(/sevens/i)
    // Ace high made nothing.
    expect(result.madeLabel).toMatch(/high/i)
  })

  it('counts a chop as holding the best hand rather than losing', () => {
    const { hand, seats } = foldedPreflop(
      { 0: 'Ah Kd', 1: 'Ac Kh', 2: '9s 8s' },
      'Qh Jc 2h 4c 3d',
    )
    const result = whatIf(hand, seats, 0)
    if (!isWhatIf(result)) throw new Error('expected an answer')
    // You would have chopped, not lost. Calling that a loss would be wrong.
    expect(result.wouldHaveWon).toBe(true)
  })

  it('orders the showdown strongest first', () => {
    const { hand, seats } = foldedPreflop(
      { 0: '5h 5d', 1: 'Ac Ah', 2: '9s 8s' },
      'Ad Jc 2h 4c 3d',
    )
    const result = whatIf(hand, seats, 0)
    if (!isWhatIf(result)) throw new Error('expected an answer')

    expect(result.showdown.map((s) => s.name)).toEqual(['P1', 'P2'])
    expect(result.showdown[0].hand).toMatch(/three|trip/i)
  })

  it('reports what the pot was actually worth', () => {
    const { hand, seats } = foldedPreflop(
      { 0: 'Ah Kh', 1: '7c 2d', 2: '9s 8s' },
      'Qh Jh Th 4c 3d',
    )
    const result = whatIf(hand, seats, 0)
    if (!isWhatIf(result)) throw new Error('expected an answer')
    // Every chip awarded, which is the pot the hero passed on.
    expect(result.pot).toBe(hand.awards.reduce((sum, a) => sum + a.amount, 0))
    expect(result.pot).toBeGreaterThan(0)
  })
})

describe('when there is no honest answer', () => {
  it('has nothing to say while you are still in the hand', () => {
    const { hand, seats } = foldedPreflop(
      { 0: 'Ah Kh', 1: '7c 2d', 2: '9s 8s' },
      'Qh Jh Th 4c 3d',
    )
    // Seat 1 never folded.
    expect(whatIf(hand, seats, 1)).toEqual({ unknown: 'still-in' })
  })

  it('refuses to invent a runout when the hand ended early', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('2c 3c 4c 5c 6c 7c'))
    setHoleCards(hand, { 0: 'Ah Kh', 1: '7c 2d', 2: '9s 8s' })

    applyAction(hand, seats, 2, { kind: 'fold' })
    applyAction(hand, seats, 0, { kind: 'fold' })
    advanceStreet(hand, stackedShoe('2d 3d 4d'))
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))

    expect(hand.board).toHaveLength(0)
    // Dealing a board that never came would be answering about a different
    // hand entirely.
    expect(whatIf(hand, seats, 0)).toEqual({ unknown: 'no-river' })
  })

  it('refuses when the hand stopped on the flop', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('2c 3c 4c 5c 6c 7c'))
    setHoleCards(hand, { 0: 'Ah Kh', 1: '7c 2d', 2: '9s 8s' })

    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'fold' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d Qh Jh Th'))
    expect(hand.board).toHaveLength(3)

    applyAction(hand, seats, 1, { kind: 'bet', amount: 200 })
    applyAction(hand, seats, 2, { kind: 'fold' })
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))

    expect(whatIf(hand, seats, 0)).toEqual({ unknown: 'no-river' })
  })

  it('has nothing to compare against when everyone else folded too', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('2c 3c 4c 5c 6c 7c'))
    setHoleCards(hand, { 0: 'Ah Kh', 1: '7c 2d', 2: '9s 8s' })

    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'fold' })
    applyAction(hand, seats, 1, { kind: 'raise', amount: 400 })
    applyAction(hand, seats, 2, { kind: 'fold' })
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))

    // Only one player left, and no board: there is no hand to have held.
    expect(whatIf(hand, seats, 0)).toEqual({ unknown: 'no-river' })
  })
})

describe('Crazy Pineapple', () => {
  /**
   * The engine makes a folded three-card holding impossible: acting throws
   * during the discard phase, and every seat has pitched before betting opens.
   * That invariant is what lets `whatIf` read the hole cards straight through
   * without guessing which card you would have kept — so it is asserted here
   * rather than assumed, and this test is what fails if the engine changes.
   */
  function crazyPineapple() {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2, 'pineapple', 'crazyPineapple')
    dealHand(hand, seats, stackedShoe('Ah Kh 2s  7c 2d 3s  9s 8s 4h  Qh Jh Th'))
    return { hand, seats }
  }

  it('does not let a player fold while still holding three cards', () => {
    const { hand, seats } = crazyPineapple()
    expect(hand.phase).toBe('discard')
    expect([0, 1, 2].map((s) => hand.players[s].hole.length)).toEqual([3, 3, 3])

    expect(() => applyAction(hand, seats, 0, { kind: 'fold' })).toThrow(/phase/i)

    for (const seat of [0, 1, 2]) applyDiscard(hand, seat, 2)
    expect([0, 1, 2].map((s) => hand.players[s].hole.length)).toEqual([2, 2, 2])
  })

  it('reads the two cards you kept, on a hand you folded after the flop', () => {
    const { hand, seats } = crazyPineapple()
    for (const seat of [0, 1, 2]) applyDiscard(hand, seat, 2)

    // Hero is first to act on the flop and folds; the rest check it down.
    expect(hand.actingSeat).toBe(0)
    applyAction(hand, seats, 0, { kind: 'fold' })

    runOut(hand, seats, ['Qh', 'Jh', 'Th', '4c', '3d'], ['Ah Kh', '7c 2d', '9s 8s'])

    const result = whatIf(hand, seats, 0)
    if (!isWhatIf(result)) throw new Error(`expected an answer, got ${result.unknown}`)
    expect(result.hole).toBe('Ah Kh')
    expect(result.madeLabel).toMatch(/straight flush|royal/i)
    expect(result.wouldHaveWon).toBe(true)
  })
})
