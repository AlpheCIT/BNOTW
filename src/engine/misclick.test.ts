import { describe, it, expect } from 'vitest'
import { guardFor, STRONG_CHEN } from './misclick'
import { legalActions, dealHand, applyAction, advanceStreet } from './hand'
import { evenSeats, newHand, setHoleCards, stackedShoe } from './testkit'
import type { Action, HandState, Seat } from './types'

/** A pre-flop spot with chosen hole cards and a raise already in front of you. */
function preflop(hole: string, { raised = true } = {}) {
  const seats = evenSeats(3)
  const hand = newHand(seats, 2)
  dealHand(hand, seats, stackedShoe('9s 8d  Ks Kh  Qc Qd'))
  setHoleCards(hand, { 1: hole })
  if (raised) applyAction(hand, seats, 2, { kind: 'raise', amount: 200 })
  else applyAction(hand, seats, 2, { kind: 'call' })
  return { hand, seats }
}

/**
 * A limped pot to a chosen flop, with seat 1 holding what you name.
 *
 * `advanceStreet` takes a burn card before the flop, and the betting round has
 * to close before it will advance — both of which are easy to get wrong by
 * hand, so every post-flop case goes through here.
 */
function flop(hole: Record<number, string>, board: string) {
  const seats = evenSeats(3)
  const hand = newHand(seats, 2)
  dealHand(hand, seats, stackedShoe('9s 8d  Jh Th  Qc Qd'))
  setHoleCards(hand, hole)
  applyAction(hand, seats, 2, { kind: 'call' })
  applyAction(hand, seats, 0, { kind: 'call' })
  applyAction(hand, seats, 1, { kind: 'check' })
  advanceStreet(hand, stackedShoe(`2d  ${board}`))
  return { hand, seats }
}

function guard(hand: HandState, seats: Seat[], seat: number, action: Action, options = {}) {
  return guardFor(hand, seats, seat, action, legalActions(hand, seats, seat), options)
}

describe('folding', () => {
  it('needs no guard for folding when checking is free, because it is not legal', () => {
    const { hand, seats } = flop({ 1: '7c 2h' }, '8h 5d 3c')
    const legal = legalActions(hand, seats, 1)

    // The engine already rules this out, so there is nothing for a
    // confirmation to protect. Asserted here so that if the rule ever
    // loosens, this comes back as a failure rather than a silent gap.
    expect(legal.canCheck).toBe(true)
    expect(legal.canFold).toBe(false)
  })

  it('questions a fold with a premium hand facing a raise', () => {
    const { hand, seats } = preflop('As Ah')
    const found = guard(hand, seats, 1, { kind: 'fold' })
    expect(found?.title).toMatch(/fold/i)
    expect(found?.detail).toMatch(/\$/)
  })

  it('lets a routine fold through without comment', () => {
    const { hand, seats } = preflop('9c 4d')
    expect(guard(hand, seats, 1, { kind: 'fold' })).toBe(null)
  })

  it('draws the pre-flop line at the Chen score it advertises', () => {
    // A hand either side of the threshold, checked through the real scorer.
    const strong = preflop('As Ks')          // Chen 12
    const weak = preflop('Jd 9c')            // Chen 5.5
    expect(guard(strong.hand, strong.seats, 1, { kind: 'fold' })).not.toBe(null)
    expect(guard(weak.hand, weak.seats, 1, { kind: 'fold' })).toBe(null)
  })

  it('can be told to use a different threshold', () => {
    const { hand, seats } = preflop('Jd 9c')
    expect(guard(hand, seats, 1, { kind: 'fold' })).toBe(null)
    expect(guard(hand, seats, 1, { kind: 'fold' }, { strongChen: 4 })).not.toBe(null)
  })

  it('questions a fold with two pair or better after the flop', () => {
    const { hand, seats } = flop({ 1: 'Ks Qh' }, 'Kd Qs 4h')
    applyAction(hand, seats, 0, { kind: 'bet', amount: 200 })

    const found = guard(hand, seats, 1, { kind: 'fold' })
    expect(found?.title).toMatch(/two pair/i)
  })

  it('says nothing about folding one pair, which happens constantly', () => {
    const { hand, seats } = flop({ 1: 'Kc 5h' }, 'Kd 9c 4h')
    applyAction(hand, seats, 0, { kind: 'bet', amount: 200 })

    expect(guard(hand, seats, 1, { kind: 'fold' })).toBe(null)
  })
})

describe('putting the stack in', () => {
  it('questions a shove', () => {
    const { hand, seats } = preflop('Jd 9c')
    const legal = legalActions(hand, seats, 1)
    const found = guardFor(hand, seats, 1, { kind: 'raise', amount: legal.maxRaiseTo }, legal)
    expect(found?.title).toMatch(/all in/i)
    expect(found?.detail).toMatch(/whole stack/i)
  })

  it('leaves an ordinary raise alone', () => {
    const { hand, seats } = preflop('Jd 9c')
    const legal = legalActions(hand, seats, 1)
    expect(guardFor(hand, seats, 1, { kind: 'raise', amount: legal.minRaiseTo }, legal)).toBe(null)
  })

  it('questions a call that is for everything', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('9s 8d  Jd 9c  Qc Qd'))
    setHoleCards(hand, { 1: 'Jd 9c' })
    applyAction(hand, seats, 2, { kind: 'raise', amount: seats[2].stack })

    const legal = legalActions(hand, seats, 1)
    expect(legal.callIsAllIn).toBe(true)
    expect(guardFor(hand, seats, 1, { kind: 'call' }, legal)?.title).toMatch(/all in/i)
  })
})

describe('staying out of the way', () => {
  it('never questions a check or an ordinary call', () => {
    const { hand, seats } = preflop('As Ah')
    expect(guard(hand, seats, 1, { kind: 'call' })).toBe(null)
  })

  it('goes quiet entirely when switched off', () => {
    const { hand, seats } = preflop('As Ah')
    expect(guard(hand, seats, 1, { kind: 'fold' }, { enabled: false })).toBe(null)

    const legal = legalActions(hand, seats, 1)
    expect(guardFor(
      hand, seats, 1, { kind: 'raise', amount: legal.maxRaiseTo }, legal, { enabled: false },
    )).toBe(null)
  })

  it('exports a threshold that actually means something on the Chen scale', () => {
    expect(STRONG_CHEN).toBeGreaterThan(5)
    expect(STRONG_CHEN).toBeLessThan(20)
  })
})
