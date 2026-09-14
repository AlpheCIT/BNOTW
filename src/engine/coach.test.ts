import { describe, it, expect } from 'vitest'
import { Shoe, mulberry32, parseCards, cardCode } from './cards'
import { applyAction, dealHand, livePlayers } from './hand'
import { evenSeats, newHand } from './testkit'
import {
  advise, describeStartingHand, equityVsRange, findOuts, opponentRanges, showdownEquity,
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

describe('what the coach claims pre-flop', () => {
  /**
   * The spot from #16: the recommendation is a call, and the raw EV of that
   * call is negative because pre-flop equity ignores the three streets still
   * to come. The coach must not offer the price as the reason.
   */
  function preflopCallWithNegativeEv() {
    for (let seed = 1; seed <= 400; seed++) {
      const seats = evenSeats(6)
      const hand = newHand(seats, seed % 6)
      dealHand(hand, seats, new Shoe(mulberry32(seed)))
      const seat = hand.actingSeat
      if (seat === null) continue
      const advice = advise(hand, seats, seat, mulberry32(seed + 7), 400)
      if (advice.recommendation.action === 'call' && advice.callEV < 0) return advice
    }
    throw new Error('no such spot found — the fixture assumption has changed')
  }

  it('does not offer the immediate price as the reason for a call it cannot pay', () => {
    const advice = preflopCallWithNegativeEv()
    const reasons = advice.recommendation.reasons.join(' ')

    // It may state the break-even price — that is a true fact about the pot.
    expect(reasons).toMatch(/break even/i)
    // What it must not do is claim the hand is worth that price, while its own
    // EV figure says the call loses money.
    expect(reasons).not.toMatch(/worth playing for that price/i)
    // It should say where the value actually comes from instead.
    expect(reasons).toMatch(/after the flop/i)
  })

  it('still computes the EV, which the post-flop panel needs', () => {
    const advice = preflopCallWithNegativeEv()
    expect(Number.isFinite(advice.callEV)).toBe(true)
    expect(advice.callEV).toBeLessThan(0)
  })
})

describe('the range opponents are credited with', () => {
  /** A hand where seat 1 raised from early position and seat 3 called late. */
  function raisedPot() {
    const seats = evenSeats(6)
    const hand = newHand(seats, 5)
    dealHand(hand, seats, new Shoe(mulberry32(3)))
    applyAction(hand, seats, hand.actingSeat!, { kind: 'raise', amount: 200 })
    while (hand.actingSeat !== null && hand.phase === 'acting') {
      const seat = hand.actingSeat
      if (seat === 0) break
      applyAction(hand, seats, seat, { kind: 'call' })
    }
    return { hand, seats }
  }

  it('gives every live opponent its own floor rather than one for the table', () => {
    const { hand } = raisedPot()
    const ranges = opponentRanges(hand, 0)
    expect(ranges.length).toBe(livePlayers(hand).length - 1)
    expect(new Set(ranges).size).toBeGreaterThan(1)
  })

  it('credits nobody with a range before anyone has acted', () => {
    const seats = evenSeats(6)
    const hand = newHand(seats, 5)
    dealHand(hand, seats, new Shoe(mulberry32(11)))

    // Blinds are posted, not chosen. Crediting the table with hands worth
    // playing here would invent information nobody has given away.
    expect(opponentRanges(hand, 0).every((r) => r === 0)).toBe(true)
  })

  it('credits an early-position caller with more than a late one', () => {
    const { hand } = raisedPot()
    const live = livePlayers(hand).map((p) => p.seat)
    const opponents = hand.order.filter((s) => s !== 0 && live.includes(s))
    const ranges = opponentRanges(hand, 0)

    // Among seats that did the same thing, position is the only difference
    // left, and it must run the right way.
    const callers = opponents
      .map((seat, i) => ({ seat, floor: ranges[i], i }))
      .filter(({ seat }) => hand.journal.some((e) => e.seat === seat && e.kind === 'call'))
    expect(callers.length).toBeGreaterThan(1)
    expect(callers[0].floor).toBeGreaterThan(callers.at(-1)!.floor)
  })

  it('credits a raiser with more than a caller', () => {
    const { hand } = raisedPot()
    const raiser = hand.journal.find((e) => e.kind === 'raise')!.seat
    const caller = hand.journal.find((e) => e.kind === 'call')!.seat
    const live = livePlayers(hand).map((p) => p.seat)
    const opponents = hand.order.filter((s) => s !== 0 && live.includes(s))
    const ranges = opponentRanges(hand, 0)

    const at = (seat: number) => ranges[opponents.indexOf(seat)]
    expect(at(raiser)).toBeGreaterThan(at(caller))
  })

  it('never exceeds what the Chen scale can produce', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const seats = evenSeats(6)
      const hand = newHand(seats, seed % 6)
      dealHand(hand, seats, new Shoe(mulberry32(seed)))
      for (const floor of opponentRanges(hand, 0)) {
        expect(floor, `seed ${seed}`).toBeGreaterThanOrEqual(0)
        expect(floor, `seed ${seed}`).toBeLessThanOrEqual(12)
      }
    }
  })
})

describe('sampling opponents from a range', () => {
  const hole = parseCards('Ah Kh')

  it('actually lowers equity as the floor rises', () => {
    // The old sampler re-dealt the whole table until everyone cleared the
    // floor, which five-handed succeeded 0.6% of the time at a floor of 6 —
    // so the floor made almost no difference to the answer. It must now.
    const at = (floor: number) =>
      equityVsRange(hole, [], 5, floor, 1200, mulberry32(7)).equity

    const loose = at(0)
    const mid = at(6)
    const tight = at(10)
    expect(mid).toBeLessThan(loose - 0.02)
    expect(tight).toBeLessThan(mid - 0.02)
  })

  it('takes a floor per opponent', () => {
    const oneTight = equityVsRange(hole, [], 5, [11, 0, 0, 0, 0], 1200, mulberry32(7)).equity
    const allLoose = equityVsRange(hole, [], 5, 0, 1200, mulberry32(7)).equity
    expect(oneTight).toBeLessThan(allLoose)
  })

  it('still answers when the floor is higher than any hand can reach', () => {
    const r = equityVsRange(hole, [], 5, 99, 400, mulberry32(7))
    expect(r.equity).toBeGreaterThan(0)
    expect(r.equity).toBeLessThan(1)
    expect(r.runouts).toBe(400)
  })

  it('deals every opponent a distinct hand', () => {
    // A clash would quietly duplicate a card and make the pot easier to win.
    const r = equityVsRange(hole, parseCards('2c 7d 9s'), 5, 8, 300, mulberry32(3))
    expect(r.equity).toBeGreaterThan(0)
    expect(r.win + r.tie).toBeLessThanOrEqual(1.000001)
  })
})
