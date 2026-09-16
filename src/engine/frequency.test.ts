/**
 * The arithmetic, checked against the figures this maths is famous for.
 *
 * Every expectation here is a number that can be looked up or derived by hand
 * — half pot defends two thirds, a pot-sized river bet carries one bluff per
 * two value bets — rather than whatever the implementation happened to return
 * the first time it ran. A test that only agrees with itself would have
 * shipped a sign error happily.
 */

import { describe, it, expect } from 'vitest'
import {
  alpha,
  bluffReport,
  bluffShare,
  defenceAdvice,
  defenceFrequency,
  defenceReport,
  defenceShare,
  valuePerBluff,
} from './frequency'
import { NEUTRAL_AGGRESSION } from './reads'

const near = (got: number, want: number) => expect(got).toBeCloseTo(want, 6)

describe('how often a bluff needs to work', () => {
  it('breaks even at half the time for a pot-sized bet', () => {
    near(alpha(100, 100), 0.5)
  })

  it('needs a third for a half-pot bet', () => {
    near(alpha(100, 50), 1 / 3)
  })

  it('needs a fifth for a quarter-pot bet', () => {
    near(alpha(100, 25), 0.2)
  })

  it('needs two thirds for a bet of twice the pot', () => {
    near(alpha(100, 200), 2 / 3)
  })

  it('asks nothing of you when nothing is at risk', () => {
    expect(alpha(100, 0)).toBe(0)
    expect(alpha(100, -50)).toBe(0)
  })

  it('never claims a bluff needs more than every fold there is', () => {
    for (const bet of [1, 50, 1_000, 100_000]) {
      expect(alpha(1, bet)).toBeLessThanOrEqual(1)
    }
  })

  it('does not divide by nothing when there is no pot and no bet', () => {
    expect(alpha(0, 0)).toBe(0)
    expect(Number.isNaN(alpha(0, 0))).toBe(false)
  })
})

describe('the share of your range that has to go on', () => {
  it('is two thirds against a half-pot bet', () => {
    near(defenceFrequency(100, 50), 2 / 3)
  })

  it('is half against a pot-sized bet', () => {
    near(defenceFrequency(100, 100), 0.5)
  })

  it('is everything when there is nothing to call', () => {
    expect(defenceFrequency(100, 0)).toBe(1)
  })

  it('is exactly what alpha leaves behind, at every size', () => {
    for (const bet of [5, 25, 50, 75, 100, 150, 300]) {
      near(defenceFrequency(120, bet) + alpha(120, bet), 1)
    }
  })

  it('falls as the bet grows, never the other way', () => {
    const sizes = [25, 50, 100, 200, 400]
    const defences = sizes.map((bet) => defenceFrequency(100, bet))
    for (let i = 1; i < defences.length; i++) {
      expect(defences[i]).toBeLessThan(defences[i - 1])
    }
  })
})

describe('sharing the defending out', () => {
  it('is the plain figure when you are the only one left', () => {
    near(defenceShare(100, 100, 1), defenceFrequency(100, 100))
  })

  it('asks less of each of you as more players can do it', () => {
    const one = defenceShare(100, 100, 1)
    const two = defenceShare(100, 100, 2)
    const three = defenceShare(100, 100, 3)
    expect(two).toBeLessThan(one)
    expect(three).toBeLessThan(two)
  })

  it('still adds up: everybody folding at their share leaves the bluff break-even', () => {
    for (const defenders of [1, 2, 3, 5]) {
      const share = defenceShare(100, 75, defenders)
      const folds = (1 - share) ** defenders
      near(folds, alpha(100, 75))
    }
  })

  it('treats nonsense player counts as one player', () => {
    near(defenceShare(100, 100, 0), defenceFrequency(100, 100))
    near(defenceShare(100, 100, -3), defenceFrequency(100, 100))
  })
})

describe('how many bluffs a bet can carry', () => {
  it('is one bluff per two value bets at pot', () => {
    near(valuePerBluff(100, 100), 2)
    near(bluffShare(100, 100), 1 / 3)
  })

  it('is one per three at half pot', () => {
    near(valuePerBluff(100, 50), 3)
    near(bluffShare(100, 50), 0.25)
  })

  it('is one per five at quarter pot', () => {
    near(valuePerBluff(100, 25), 5)
  })

  it('is three per two at twice the pot', () => {
    near(valuePerBluff(100, 200), 1.5)
  })

  it('carries no bluffs at all when you are not betting', () => {
    expect(bluffShare(100, 0)).toBe(0)
    expect(valuePerBluff(100, 0)).toBe(Infinity)
  })

  it('agrees with the price the caller is being given', () => {
    // The caller's break-even equity and the bluff share are the same number;
    // that is the whole point of the ratio.
    for (const bet of [25, 50, 100, 250]) {
      const pot = 100
      const callerNeeds = bet / (pot + bet + bet)
      near(bluffShare(pot, bet), callerNeeds)
    }
  })

  it('says plainly whether the street makes it exact', () => {
    expect(bluffReport(100, 50, 'river').exact).toBe(true)
    expect(bluffReport(100, 50, 'turn').exact).toBe(false)
    expect(bluffReport(100, 50, 'flop').exact).toBe(false)
    expect(bluffReport(100, 50, 'preflop').exact).toBe(false)
  })
})

describe('the report handed to the coach', () => {
  it('carries the price it was built from, so nothing has to be recomputed', () => {
    const report = defenceReport(240, 120, 2)
    expect(report.potBefore).toBe(240)
    expect(report.risk).toBe(120)
    expect(report.defenders).toBe(2)
    near(report.alpha, 1 / 3)
    near(report.defence, 2 / 3)
    near(report.share, defenceShare(240, 120, 2))
  })
})

describe('whether the floor is worth respecting against this player', () => {
  it('says nothing at all on a player nobody has watched', () => {
    expect(defenceAdvice({ aggression: 0.05, confidence: 0 })).toBe('unknown')
    expect(defenceAdvice({ aggression: 0.9, confidence: 0.2 })).toBe('unknown')
  })

  it('lets you fold more than the floor against somebody who never bets', () => {
    expect(defenceAdvice({ aggression: 0.04, confidence: 1 })).toBe('overfolds-fine')
  })

  it('holds you to it against somebody who bets plenty', () => {
    expect(defenceAdvice({ aggression: 0.55, confidence: 1 })).toBe('binds')
  })

  it('holds an ordinary player to it rather than calling them a nit', () => {
    expect(defenceAdvice({ aggression: NEUTRAL_AGGRESSION, confidence: 1 })).toBe('binds')
  })
})
