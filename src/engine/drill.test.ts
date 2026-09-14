import { describe, it, expect } from 'vitest'
import {
  STREETS, dealSpot, nextSpot, pickStreet, seededRng, weakestStreets,
} from './drill'
import { defaultRoster } from './persona'
import { emptyTotals, type PlayerTotals } from './playerStats'
import { legalActions, livePlayers } from './hand'
import type { Street } from './types'

const opponents = defaultRoster().slice(0, 5)
const fast = { opponents, trials: 200 }

function totalsWith(rows: Partial<Record<Street, [number, number]>>): PlayerTotals {
  const totals = emptyTotals()
  for (const [street, [decisions, agreed]] of Object.entries(rows)) {
    totals.byStreet[street] = { decisions, agreed, evLost: 0 }
  }
  return totals
}

describe('ranking the streets to drill', () => {
  it('puts the street you disagree with the coach on most first', () => {
    const totals = totalsWith({
      preflop: [200, 190], // 5% off
      flop: [120, 70],     // 42% off
      turn: [60, 25],      // 58% off
      river: [80, 60],     // 25% off
    })
    expect(weakestStreets(totals)).toEqual(['turn', 'flop', 'river', 'preflop'])
  })

  it('ignores a street with too small a sample to mean anything', () => {
    // Three river decisions, all wrong, must not outrank a hundred measured flops.
    const totals = totalsWith({ river: [3, 0], flop: [120, 70] })
    const order = weakestStreets(totals)
    expect(order[0]).toBe('flop')
    // It is not dropped, just not led with — drilling it is how it gets measured.
    expect(order).toContain('river')
  })

  it('puts every measured street ahead of every unmeasured one', () => {
    // Even a street you are good at is better evidence than one with none.
    const totals = totalsWith({ preflop: [200, 198] })
    expect(weakestStreets(totals)[0]).toBe('preflop')
  })

  it('drills everything evenly before there is anything to go on', () => {
    expect(weakestStreets(emptyTotals())).toEqual(STREETS)
  })

  it('leans on the weakest street without ever excluding the rest', () => {
    const order: Street[] = ['turn', 'flop', 'river', 'preflop']
    const rng = seededRng(11)
    const counts: Record<string, number> = {}
    for (let i = 0; i < 2000; i++) {
      const street = pickStreet(order, rng)
      counts[street] = (counts[street] ?? 0) + 1
    }
    // Every street appears, and the ranking is respected.
    for (const street of order) expect(counts[street], street).toBeGreaterThan(0)
    expect(counts.turn).toBeGreaterThan(counts.flop)
    expect(counts.flop).toBeGreaterThan(counts.river)
    expect(counts.river).toBeGreaterThan(counts.preflop)
  })
})

describe('dealing a spot', () => {
  it('lands on the street it was asked for', { timeout: 20000 }, () => {
    for (const street of STREETS) {
      const spot = dealSpot(street, seededRng(42), fast)
      expect(spot, street).not.toBe(null)
      expect(spot!.street, street).toBe(street)
      expect(spot!.hand.street, street).toBe(street)
    }
  })

  it('hands over a spot where it is genuinely your turn to act', () => {
    const spot = dealSpot('flop', seededRng(7), fast)!
    expect(spot.hand.phase).toBe('acting')
    expect(spot.hand.actingSeat).toBe(spot.seat)
    expect(spot.hand.complete).toBe(false)
  })

  it('gives you cards, opponents and something legal to do', () => {
    const spot = dealSpot('turn', seededRng(3), fast)!
    expect(spot.hand.players[spot.seat].hole).toHaveLength(2)
    expect(livePlayers(spot.hand).length).toBeGreaterThan(1)

    const legal = legalActions(spot.hand, spot.seats, spot.seat)
    expect(legal.canCheck || legal.canFold).toBe(true)
  })

  it('shows the right number of board cards for the street', () => {
    // Only the four betting streets; `Street` also has a showdown value that
    // no decision is ever taken on.
    const sizes: [Street, number][] = [['preflop', 0], ['flop', 3], ['turn', 4], ['river', 5]]
    for (const [street, size] of sizes) {
      const spot = dealSpot(street, seededRng(19), fast)!
      expect(spot.hand.board, street).toHaveLength(size)
    }
  })

  it('comes with the coach already having an opinion', () => {
    const spot = dealSpot('flop', seededRng(5), fast)!
    expect(spot.advice.recommendation.headline).toBeTruthy()
    expect(spot.advice.recommendation.reasons.length).toBeGreaterThan(0)
    expect(spot.advice.equity.equity).toBeGreaterThanOrEqual(0)
    expect(spot.advice.equity.equity).toBeLessThanOrEqual(1)
  })

  it('leaves bomb pots and straddles out of it', () => {
    // Both change the price of everything for reasons unrelated to the
    // decision being practised.
    for (let seed = 0; seed < 6; seed++) {
      const spot = dealSpot('flop', seededRng(seed), fast)
      if (!spot) continue
      expect(spot.hand.isBombPot, `seed ${seed}`).toBe(false)
      expect(spot.hand.straddles, `seed ${seed}`).toHaveLength(0)
    }
  })

  it('gives up rather than looping when a street cannot be reached', () => {
    const spot = dealSpot('river', seededRng(1), { ...fast, attempts: 0 })
    expect(spot).toBe(null)
  })

  it('is reproducible from a seed', () => {
    const a = dealSpot('flop', seededRng(99), fast)!
    const b = dealSpot('flop', seededRng(99), fast)!
    expect(a.hand.players[a.seat].hole).toEqual(b.hand.players[b.seat].hole)
    expect(a.hand.board).toEqual(b.hand.board)
  })
})

describe('the next spot', () => {
  it('always finds something, even when the asked-for street will not come', { timeout: 30000 }, () => {
    for (let seed = 0; seed < 5; seed++) {
      const spot = nextSpot(emptyTotals(), seededRng(seed), fast)
      expect(spot, `seed ${seed}`).not.toBe(null)
      expect(STREETS).toContain(spot!.street)
    }
  })

  it('favours the weak street across a run of spots', { timeout: 30000 }, () => {
    const totals = totalsWith({
      preflop: [200, 198], flop: [200, 196], turn: [200, 80], river: [200, 195],
    })
    const rng = seededRng(21)
    const seen: Record<string, number> = {}
    for (let i = 0; i < 8; i++) {
      const spot = nextSpot(totals, rng, fast)
      if (spot) seen[spot.street] = (seen[spot.street] ?? 0) + 1
    }
    // Not a strict guarantee on eight samples, but the turn should show up.
    expect(seen.turn ?? 0).toBeGreaterThan(0)
  })
})
