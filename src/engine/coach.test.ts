import { describe, it, expect } from 'vitest'
import { mulberry32, parseCards, cardCode } from './cards'
import {
  describeStartingHand, equityVsRange, findOuts, showdownEquity,
} from './coach'

const rng = mulberry32(20260914)

describe('showdown equity', () => {
  it('enumerates every runout when there are two cards to come', () => {
    const [hero] = showdownEquity(
      [parseCards('As Ks'), parseCards('Qh Qd')], parseCards('2c 7d 9h'), rng,
    )
    expect(hero.exact).toBe(true)
    // 52 - 3 board - 4 hole = 45 unseen, choose 2.
    expect(hero.runouts).toBe((45 * 44) / 2)
  })

  it('enumerates all 44 rivers on the turn', () => {
    const [hero] = showdownEquity(
      [parseCards('As Ks'), parseCards('Qh Qd')], parseCards('2c 7d 9h 3s'), rng,
    )
    expect(hero.exact).toBe(true)
    expect(hero.runouts).toBe(44)
  })

  it('gives a locked-up hand 100% and the loser 0%', () => {
    const [hero, villain] = showdownEquity(
      [parseCards('10s 9s'), parseCards('2c 3d')], parseCards('As Ks Qs Js'), rng,
    )
    expect(hero.equity).toBe(1)
    expect(villain.equity).toBe(0)
  })

  it('splits it down the middle when the board plays for both', () => {
    const [a, b] = showdownEquity(
      [parseCards('2c 3d'), parseCards('2h 3s')], parseCards('As Ks Qs Js 10s'), rng,
    )
    expect(a.equity).toBeCloseTo(0.5, 5)
    expect(b.equity).toBeCloseTo(0.5, 5)
    expect(a.tie).toBe(1)
  })

  it('puts aces about 82% over kings pre-flop', () => {
    const [aces, kings] = showdownEquity(
      [parseCards('As Ah'), parseCards('Ks Kh')], parseCards(''), mulberry32(7), 20000,
    )
    expect(aces.equity).toBeGreaterThan(0.78)
    expect(aces.equity).toBeLessThan(0.86)
    expect(aces.equity + kings.equity).toBeCloseTo(1, 6)
  })

  it('makes a pair against two overcards close to a coin flip', () => {
    const [deuces] = showdownEquity(
      [parseCards('2c 2d'), parseCards('As Kh')], parseCards(''), mulberry32(11), 20000,
    )
    expect(deuces.equity).toBeGreaterThan(0.46)
    expect(deuces.equity).toBeLessThan(0.58)
  })

  it('shares the pot three ways between three identical hands', () => {
    const results = showdownEquity(
      [parseCards('2c 3d'), parseCards('2h 3s'), parseCards('2s 3h')],
      parseCards('As Ks Qs Js 10s'), rng,
    )
    for (const r of results) expect(r.equity).toBeCloseTo(1 / 3, 5)
  })
})

describe('counting outs', () => {
  it('finds exactly nine cards for a flush draw', () => {
    // 9-8 of spades on an ace-king-rag board with two spades.
    const outs = findOuts(parseCards('9s 8s'), parseCards('As Ks 2h'))
    const flush = outs.groups.find((g) => g.makes === 'Flush')!
    expect(flush.cards).toHaveLength(9)
    expect(flush.cards.every((c) => c.suit === 's')).toBe(true)
    // 1 - (38/47)(37/46)
    expect(flush.byRiver).toBeCloseTo(0.3497, 3)
  })

  it('finds eight cards for an open-ended straight draw', () => {
    const outs = findOuts(parseCards('9h 8c'), parseCards('7d 6s 2c'))
    const straight = outs.groups.find((g) => g.makes === 'Straight')!
    expect(straight.cards).toHaveLength(8)
    expect(new Set(straight.cards.map((c) => c.rank))).toEqual(new Set([10, 5]))
    expect(straight.byRiver).toBeCloseTo(0.3148, 3)
  })

  it('finds four cards for a gutshot', () => {
    const outs = findOuts(parseCards('9h 8c'), parseCards('7d 5s 2c'))
    const straight = outs.groups.find((g) => g.makes === 'Straight')!
    expect(straight.cards).toHaveLength(4)
    expect(straight.cards.every((c) => c.rank === 6)).toBe(true)
  })

  it('does not count a card that pairs the board as an out', () => {
    // 9-8 offsuit on A-K-2: an ace or a king pairs the board for everybody.
    const outs = findOuts(parseCards('9h 8c'), parseCards('As Kd 2c'))
    const improving = outs.groups.flatMap((g) => g.cards).map((c) => c.rank)
    expect(improving).not.toContain(14)
    expect(improving).not.toContain(13)
    expect(improving).not.toContain(2)
    // Only the sixes and... only pairing your own nine or eight helps.
    expect(new Set(improving)).toEqual(new Set([9, 8]))
    expect(outs.count).toBe(6)
  })

  it('reports nothing to draw to once the board is complete', () => {
    const outs = findOuts(parseCards('9s 8s'), parseCards('As Ks 2h 3d 4c'))
    expect(outs.count).toBe(0)
    expect(outs.cardsToCome).toBe(0)
  })

  it('separates the flush draw from the weaker pair outs', () => {
    const outs = findOuts(parseCards('9s 8s'), parseCards('As Ks 2h'))
    expect(outs.groups.map((g) => g.makes)).toEqual(['Flush', 'Pair'])
    expect(outs.groups[1].cards).toHaveLength(6) // three nines, three eights
    expect(outs.count).toBe(15)
  })

  it('spots a draw to a full house holding a set', () => {
    const outs = findOuts(parseCards('7s 7h'), parseCards('7d Kc 2s'))
    const names = outs.groups.map((g) => g.makes)
    expect(names).toContain('Full House')
    expect(names).toContain('Four of a Kind')
    const quads = outs.groups.find((g) => g.makes === 'Four of a Kind')!
    expect(quads.cards.map(cardCode)).toEqual(['7c'])
  })
})

describe('equity against a range', () => {
  it('rates the nuts at essentially 100%', () => {
    const r = equityVsRange(parseCards('10s 9s'), parseCards('As Ks Qs Js'), 3, 0, 600, rng)
    expect(r.equity).toBeGreaterThan(0.99)
  })

  it('drops as more opponents are added', () => {
    const board = parseCards('Ah 9d 4c')
    const heads = equityVsRange(parseCards('Ks Kd'), board, 1, 0, 1200, mulberry32(3))
    const five = equityVsRange(parseCards('Ks Kd'), board, 5, 0, 1200, mulberry32(3))
    expect(heads).toBeTruthy()
    expect(heads.equity).toBeGreaterThan(five.equity + 0.1)
  })

  it('rates a hand lower against a real range than against random cards', () => {
    const random = equityVsRange(parseCards('Qh Jd'), parseCards('9s 5c 2h'), 2, 0, 2500, mulberry32(5))
    const tight = equityVsRange(parseCards('Qh Jd'), parseCards('9s 5c 2h'), 2, 9, 2500, mulberry32(5))
    expect(tight.equity).toBeLessThan(random.equity)
  })
})

describe('starting hands', () => {
  it('grades the classics the way a player would', () => {
    expect(describeStartingHand(parseCards('As Ah')).grade).toBe('Premium')
    expect(describeStartingHand(parseCards('As Ah')).label).toBe('Pocket As')
    expect(describeStartingHand(parseCards('As Ks')).grade).toBe('Premium')
    expect(describeStartingHand(parseCards('As Ks')).label).toBe('AK suited')
    expect(describeStartingHand(parseCards('9h 8c')).label).toBe('98 offsuit')
    expect(describeStartingHand(parseCards('7s 2h')).grade).toBe('Trash')
  })
})
