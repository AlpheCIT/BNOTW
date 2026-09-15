/**
 * Where you were sitting.
 *
 * Two things under test. The seat has to be right at every table size — the
 * version this replaced was wrong three-handed and heads-up, and that error
 * is now being written into permanent history rather than only spoken aloud.
 * And the totals have to hold positions the same way they hold everything
 * else: as running counters that survive the hand list being trimmed.
 */

import { describe, it, expect } from 'vitest'
import {
  POSITIONS, POSITION_LABEL, POSITION_SHORT, isLate, positionLabelFor,
  positionOf, storedPosition,
} from './position'
import { dealHand } from './hand'
import { evenSeats, newHand, stackedShoe } from './testkit'
import {
  POSITION_SAMPLE, accumulate, byPosition, emptyTotals, handsWithoutPosition,
  unaccumulate, type HandRecord,
} from './playerStats'

/** A dealt hand at a given table size, hero on seat 0. */
function table(n: number, button = n - 1) {
  const seats = evenSeats(n)
  const hand = newHand(seats, button)
  dealHand(hand, seats, stackedShoe(
    Array.from({ length: n * 2 }, (_, i) => `${2 + (i % 8)}${'shdc'[i % 4]}`).join(' '),
  ))
  return { seats, hand }
}

describe('naming the seat', () => {
  it('places every seat at a full table', () => {
    const { hand } = table(6, 5)
    // order runs small blind first, button last.
    const seen = hand.order.map((seat) => positionOf(hand, seat))
    expect(seen).toEqual(['sb', 'bb', 'ep', 'mp', 'co', 'btn'])
  })

  it('has no cut-off three-handed, where there is nobody sitting in it', () => {
    const { hand } = table(3, 2)
    const seen = hand.order.map((seat) => positionOf(hand, seat))
    // The old version called the big blind the cut-off, because it tested the
    // seat's index before it tested the blinds.
    expect(seen).toEqual(['sb', 'bb', 'btn'])
    expect(seen).not.toContain('co')
  })

  it('calls the big blind the big blind heads-up', () => {
    const { hand } = table(2, 1)
    const seen = hand.order.map((seat) => positionOf(hand, seat))
    expect(seen).not.toContain('co')
    expect(seen).toContain('bb')
    expect(seen).toContain('btn')
  })

  it('places everyone by seat in a bomb pot, which posts no blinds', () => {
    const seats = evenSeats(6)
    // A bomb pot is any non-hold'em variant: no blinds, flop already out.
    const hand = newHand(seats, 5, 'pineapple', 'pineapple')
    dealHand(hand, seats, stackedShoe(
      'As Ks Qs Js 10s 9s 8s 7s 6s 5s 4s 3s 2s Ah Kh Qh',
    ))
    expect(hand.smallBlindSeat).toBe(null)
    const seen = hand.order.map((seat) => positionOf(hand, seat))
    expect(seen.at(-1)).toBe('btn')
    expect(new Set(seen).size).toBeGreaterThan(2)
  })

  it('never puts two seats in the same blind', () => {
    for (let n = 2; n <= 9; n++) {
      const { hand } = table(n)
      const seen = hand.order.map((seat) => positionOf(hand, seat))
      expect(seen.filter((p) => p === 'sb').length, `${n}-handed`).toBeLessThanOrEqual(1)
      expect(seen.filter((p) => p === 'bb').length, `${n}-handed`).toBeLessThanOrEqual(1)
      expect(seen.filter((p) => p === 'btn').length, `${n}-handed`).toBe(1)
    }
  })

  it('follows the button around the table', () => {
    for (let button = 0; button < 6; button++) {
      const { hand } = table(6, button)
      expect(positionOf(hand, button)).toBe('btn')
    }
  })

  it('keeps the words the coach was already using', () => {
    const { hand } = table(6, 5)
    expect(positionLabelFor(hand, 5)).toBe('on the button')
    expect(positionLabelFor(hand, 4)).toBe('in the cut-off')
    expect(positionLabelFor(null, 0)).toBe('in this seat')
    for (const p of POSITIONS) {
      expect(POSITION_LABEL[p].startsWith('in ') || POSITION_LABEL[p].startsWith('on ')).toBe(true)
      expect(POSITION_SHORT[p].length, p).toBeLessThanOrEqual(3)
    }
  })

  it('counts the button and the cut-off as late', () => {
    expect(POSITIONS.filter(isLate)).toEqual(['btn', 'co'])
  })
})

describe('reading a stored position back', () => {
  it('takes the codes it writes', () => {
    for (const p of POSITIONS) expect(storedPosition(p)).toBe(p)
  })

  it('recovers the one old value that meant something', () => {
    expect(storedPosition('button')).toBe('btn')
  })

  it('refuses to guess at the one that did not', () => {
    // "other" was five positions in a trench coat. Bucketing it anywhere
    // would put made-up hands in a real row.
    expect(storedPosition('other')).toBe(null)
    expect(storedPosition('')).toBe(null)
  })
})

describe('positions in the totals', () => {
  function hand(position: string, net: number, agreed = true): HandRecord {
    return {
      at: 1, mode: 'table', handNumber: 1, bomb: false, position,
      hole: 'As Kd', couldStraddle: true, straddled: false, vpip: true, pfr: true,
      facedRaise: false, threeBet: false, sawFlop: true, showdown: false,
      wonShowdown: false, net, aggressive: 1, passive: 0,
      dexterHeld: false, dexterWon: false,
      decisions: [{
        street: 'flop', action: 'call', recommended: agreed ? 'call' : 'fold',
        agreed, evLost: agreed ? 0 : 400, leak: agreed ? null : 'Called too light',
      }],
    }
  }

  const many = (position: string, count: number, net: number) =>
    Array.from({ length: count }, () => hand(position, net))

  it('separates the money by seat', () => {
    const totals = [...many('btn', 40, 200), ...many('utg' as never, 0, 0), ...many('ep', 40, -300)]
      .reduce(accumulate, emptyTotals())

    const rows = byPosition(totals)
    const btn = rows.find((r) => r.position === 'btn')!
    const ep = rows.find((r) => r.position === 'ep')!
    expect(btn.hands).toBe(40)
    expect(btn.net).toBe(8000)
    expect(ep.net).toBe(-12000)
    expect(btn.bbPer100).toBeGreaterThan(0)
    expect(ep.bbPer100).toBeLessThan(0)
  })

  it('returns rows in table order, and only seats actually played', () => {
    const totals = [...many('btn', 5, 100), ...many('bb', 5, -100)]
      .reduce(accumulate, emptyTotals())
    expect(byPosition(totals).map((r) => r.position)).toEqual(['btn', 'bb'])
  })

  it('marks a small sample as not worth reading', () => {
    const thin = many('btn', POSITION_SAMPLE - 1, 100).reduce(accumulate, emptyTotals())
    const thick = many('btn', POSITION_SAMPLE, 100).reduce(accumulate, emptyTotals())
    expect(byPosition(thin)[0].meaningful).toBe(false)
    expect(byPosition(thick)[0].meaningful).toBe(true)
  })

  it('carries a confidence band, because a positional sample is mostly noise', () => {
    const mixed = [...many('btn', 20, 4000), ...many('btn', 20, -4000)]
      .reduce(accumulate, emptyTotals())
    const row = byPosition(mixed)[0]
    // Break-even overall, with a band far wider than the figure itself.
    expect(Math.abs(row.bbPer100)).toBeLessThan(1)
    expect(row.margin).toBeGreaterThan(10)
  })

  it('withholds a rate until there is enough to compute one', () => {
    const thin = many('btn', 3, 100).reduce(accumulate, emptyTotals())
    expect(byPosition(thin)[0].vpip).toBe(null)
    expect(byPosition(thin)[0].accuracy).toBe(null)

    const thick = many('btn', 30, 100).reduce(accumulate, emptyTotals())
    expect(byPosition(thick)[0].vpip).toBe(1)
    expect(byPosition(thick)[0].accuracy).toBe(1)
  })

  it('leaves a bomb pot out of the pre-flop rates but not out of the money', () => {
    const bomb = { ...hand('btn', 500), bomb: true, vpip: false, pfr: false }
    const totals = [bomb, ...many('btn', 20, 100)].reduce(accumulate, emptyTotals())
    const row = byPosition(totals)[0]
    expect(row.hands).toBe(21)
    expect(row.net).toBe(500 + 2000)
    // 20 pre-flop hands, all of them voluntary.
    expect(row.vpip).toBe(1)
  })

  it('counts old records everywhere except the table', () => {
    const totals = [hand('other', 100), hand('button', 100), hand('btn', 100)]
      .reduce(accumulate, emptyTotals())
    expect(totals.hands).toBe(3)
    // `button` is recoverable, `other` is not.
    expect(byPosition(totals).find((r) => r.position === 'btn')?.hands).toBe(2)
    expect(handsWithoutPosition(totals)).toBe(1)
  })

  it('takes a deleted hand back out of its seat too', () => {
    const hands = [...many('btn', 10, 200), ...many('sb', 10, -200)]
    const all = hands.reduce(accumulate, emptyTotals())
    const without = hands.slice(0, 10).reduce(accumulate, emptyTotals())
    const removed = hands.slice(10).reduce(unaccumulate, all)
    expect(removed.byPosition).toEqual(without.byPosition)
  })

  it('drops a seat entirely once its last hand goes', () => {
    const one = hand('co', 300)
    const totals = unaccumulate(accumulate(emptyTotals(), one), one)
    // A seat listed at zero reads as a seat you played and broke even at.
    expect('co' in totals.byPosition).toBe(false)
    expect(totals).toEqual(emptyTotals())
  })
})
