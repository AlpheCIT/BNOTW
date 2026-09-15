/**
 * Taking a hand back out of the totals.
 *
 * The property worth testing is not "the counters went down". It is that
 * removing a hand leaves exactly the totals you would have had if that hand
 * had never been played — because the whole reason to offer deletion is a
 * record skewed by hands that were not really play, and a subtraction that is
 * merely close would replace one wrong rating with another.
 */

import { describe, it, expect } from 'vitest'
import {
  accumulate, emptyTotals, rating, tendencies, unaccumulate,
  type DecisionRecord, type HandRecord, type PlayerTotals,
} from './playerStats'
import { mulberry32 } from './cards'

function decision(rng: () => number): DecisionRecord {
  const streets = ['preflop', 'flop', 'turn', 'river'] as const
  const leaks = [null, 'calling too wide', 'passive on the river', 'folding too much']
  const agreed = rng() < 0.6
  return {
    street: streets[Math.floor(rng() * streets.length)],
    action: 'call',
    recommended: agreed ? 'call' : 'fold',
    agreed,
    evLost: agreed ? 0 : Math.round(rng() * 900),
    leak: agreed ? null : leaks[Math.floor(rng() * leaks.length)],
  }
}

/** A hand with every flag and counter randomised, so nothing is left untested. */
function randomHand(rng: () => number, at: number): HandRecord {
  const bomb = rng() < 0.15
  const showdown = rng() < 0.4
  return {
    at,
    mode: rng() < 0.5 ? 'table' : 'coach',
    handNumber: at,
    bomb,
    position: 'other',
    hole: 'As Kd',
    couldStraddle: !bomb,
    straddled: !bomb && rng() < 0.2,
    vpip: rng() < 0.5,
    pfr: rng() < 0.3,
    facedRaise: rng() < 0.4,
    threeBet: rng() < 0.1,
    sawFlop: rng() < 0.6,
    showdown,
    wonShowdown: showdown && rng() < 0.5,
    net: Math.round((rng() - 0.45) * 8000),
    aggressive: Math.floor(rng() * 4),
    passive: Math.floor(rng() * 4),
    dexterHeld: rng() < 0.1,
    dexterWon: rng() < 0.05,
    decisions: Array.from({ length: Math.floor(rng() * 5) }, () => decision(rng)),
  }
}

function totalsOf(hands: HandRecord[]): PlayerTotals {
  return hands.reduce(accumulate, emptyTotals())
}

/** Everything but the two fields that are a min and a max over the set. */
function comparable(totals: PlayerTotals) {
  const { firstAt: _f, lastAt: _l, ...rest } = totals
  return rest
}

describe('unaccumulate', () => {
  it('leaves the totals a hand that was never played would have left', () => {
    const rng = mulberry32(20260915)
    const hands = Array.from({ length: 60 }, (_, i) => randomHand(rng, 1000 + i))

    // Every position in the history, so removing the first, the last and
    // everything between is covered rather than one convenient case.
    for (let i = 0; i < hands.length; i++) {
      const after = unaccumulate(totalsOf(hands), hands[i])
      const never = totalsOf(hands.filter((_, j) => j !== i))
      expect(comparable(after)).toEqual(comparable(never))
    }
  })

  it('leaves the same totals however many hands go, and in whatever order', () => {
    const rng = mulberry32(77)
    const hands = Array.from({ length: 40 }, (_, i) => randomHand(rng, 2000 + i))
    const going = [3, 7, 8, 19, 31].map((i) => hands[i])

    const forwards = going.reduce(unaccumulate, totalsOf(hands))
    const backwards = [...going].reverse().reduce(unaccumulate, totalsOf(hands))
    const never = totalsOf(hands.filter((h) => !going.includes(h)))

    expect(comparable(forwards)).toEqual(comparable(never))
    expect(comparable(backwards)).toEqual(comparable(never))
  })

  it('drops a leak and a street rather than leaving them at zero', () => {
    const only: HandRecord = {
      ...randomHand(mulberry32(5), 1),
      decisions: [{
        street: 'turn', action: 'call', recommended: 'fold',
        agreed: false, evLost: 400, leak: 'calling too wide',
      }],
    }
    const totals = accumulate(emptyTotals(), only)
    expect(totals.leaks['calling too wide']).toBe(1)
    expect(totals.byStreet.turn).toBeDefined()

    const after = unaccumulate(totals, only)
    // A leak listed at zero still reads as something you do.
    expect('calling too wide' in after.leaks).toBe(false)
    expect('turn' in after.byStreet).toBe(false)
  })

  it('clears the window when the last hand goes', () => {
    const one = randomHand(mulberry32(9), 4242)
    const after = unaccumulate(accumulate(emptyTotals(), one), one)
    expect(after).toEqual(emptyTotals())
  })

  it('never goes negative, even asked to remove a hand that was never added', () => {
    const rng = mulberry32(1)
    const stranger = randomHand(rng, 1)
    const after = unaccumulate(emptyTotals(), stranger)
    for (const [key, value] of Object.entries(after)) {
      if (typeof value === 'number' && key !== 'net' && key !== 'bombNet') {
        expect(value, key).toBeGreaterThanOrEqual(0)
      }
    }
    expect(after.handsByMode.table).toBeGreaterThanOrEqual(0)
    expect(after.handsByMode.coach).toBeGreaterThanOrEqual(0)
  })

  it('moves the rating back to where it was before the deleted hands', () => {
    // The point of the feature: a run of careless hands, removed, should leave
    // the rating the earlier hands earned rather than some blend of the two.
    const rng = mulberry32(31337)
    const real = Array.from({ length: 30 }, (_, i) => ({
      ...randomHand(rng, 3000 + i),
      decisions: [{
        street: 'flop' as const, action: 'call' as const, recommended: 'call' as const,
        agreed: true, evLost: 0, leak: null,
      }],
    }))
    const testing = Array.from({ length: 30 }, (_, i) => ({
      ...randomHand(rng, 4000 + i),
      decisions: [{
        street: 'flop' as const, action: 'call' as const, recommended: 'fold' as const,
        agreed: false, evLost: 2000, leak: 'calling too wide',
      }],
    }))

    const before = rating(totalsOf(real))
    const skewed = rating(totalsOf([...real, ...testing]))
    expect(skewed.value).toBeLessThan(before.value)

    const cleaned = testing.reduce(unaccumulate, totalsOf([...real, ...testing]))
    expect(rating(cleaned).value).toBe(before.value)
    expect(tendencies(cleaned)).toEqual(tendencies(totalsOf(real)))
  })
})
