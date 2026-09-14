import { describe, it, expect } from 'vitest'
import {
  accumulate, diagnose, emptyTotals, rating, ratingBand, tendencies, winRate,
  PROVISIONAL_DECISIONS, RATING_BASE,
  type HandRecord, type PlayerTotals,
} from './playerStats'
import { BIG_BLIND } from './bnotw'

function hand(patch: Partial<HandRecord> = {}): HandRecord {
  return {
    at: 1_700_000_000_000,
    mode: 'table',
    handNumber: 1,
    bomb: false,
    position: 'other',
    hole: 'As Kh',
    couldStraddle: true,
    straddled: false,
    vpip: false,
    pfr: false,
    facedRaise: false,
    threeBet: false,
    sawFlop: false,
    showdown: false,
    wonShowdown: false,
    net: 0,
    aggressive: 0,
    passive: 0,
    dexterHeld: false,
    dexterWon: false,
    decisions: [],
    ...patch,
  }
}

function pile(records: HandRecord[]): PlayerTotals {
  return records.reduce(accumulate, emptyTotals())
}

/** n hands, of which `played` had money put in voluntarily. */
function spread(n: number, patch: (i: number) => Partial<HandRecord>): PlayerTotals {
  return pile(Array.from({ length: n }, (_, i) => hand({ handNumber: i + 1, ...patch(i) })))
}

describe('accumulating hands', () => {
  it('counts a hand exactly once across every counter it touches', () => {
    const totals = pile([
      hand({ vpip: true, pfr: true, sawFlop: true, showdown: true, wonShowdown: true, net: 500 }),
    ])
    expect(totals.hands).toBe(1)
    expect(totals.preflopHands).toBe(1)
    expect(totals.vpip).toBe(1)
    expect(totals.pfr).toBe(1)
    expect(totals.sawFlop).toBe(1)
    expect(totals.showdowns).toBe(1)
    expect(totals.showdownWins).toBe(1)
    expect(totals.handsWon).toBe(1)
    expect(totals.net).toBe(500)
  })

  it('leaves a bomb pot out of the pre-flop denominators', () => {
    // There is no pre-flop decision in a bomb pot, so counting it would drag
    // every pre-flop percentage down for no reason.
    const totals = pile([hand({ bomb: true, net: -300 }), hand({ vpip: true })])
    expect(totals.hands).toBe(2)
    expect(totals.preflopHands).toBe(1)
    expect(totals.bombHands).toBe(1)
    expect(totals.bombNet).toBe(-300)
    expect(tendencies(pile(Array(40).fill(hand({ vpip: true }))))
      .find((t) => t.key === 'vpip')!.value).toBe(1)
  })

  it('keeps table and coach hands apart while totalling both', () => {
    const totals = pile([hand({ mode: 'table' }), hand({ mode: 'coach' }), hand({ mode: 'coach' })])
    expect(totals.handsByMode).toEqual({ table: 1, coach: 2 })
    expect(totals.hands).toBe(3)
  })

  it('adds up decisions, leaks and EV given up', () => {
    const totals = pile([
      hand({
        decisions: [
          { street: 'preflop', action: 'call', recommended: 'fold', agreed: false, evLost: 120, leak: 'Called too light' },
          { street: 'flop', action: 'fold', recommended: 'fold', agreed: true, evLost: 0, leak: null },
        ],
      }),
    ])
    expect(totals.decisions).toBe(2)
    expect(totals.agreed).toBe(1)
    expect(totals.evLost).toBe(120)
    expect(totals.leaks).toEqual({ 'Called too light': 1 })
    expect(totals.byStreet.preflop).toEqual({ decisions: 1, agreed: 0, evLost: 120 })
  })
})

describe('tendencies', () => {
  it('holds a stat back until there is enough of a sample', () => {
    const thin = spread(10, () => ({ vpip: true }))
    expect(tendencies(thin).find((t) => t.key === 'vpip')!.value).toBeNull()
    const thick = spread(40, () => ({ vpip: true }))
    expect(tendencies(thick).find((t) => t.key === 'vpip')!.value).toBe(1)
  })

  it('computes VPIP and pre-flop raise over hands dealt', () => {
    const totals = spread(100, (i) => ({ vpip: i < 30, pfr: i < 12 }))
    const stats = tendencies(totals)
    expect(stats.find((t) => t.key === 'vpip')!.value).toBeCloseTo(0.3, 5)
    expect(stats.find((t) => t.key === 'pfr')!.value).toBeCloseTo(0.12, 5)
  })

  it('computes 3-bet only over the hands that faced a raise', () => {
    const totals = spread(100, (i) => ({ facedRaise: i < 40, threeBet: i < 6 }))
    expect(tendencies(totals).find((t) => t.key === 'threeBet')!.value).toBeCloseTo(6 / 40, 5)
  })

  it('computes aggression as bets and raises per call', () => {
    const totals = spread(50, () => ({ aggressive: 3, passive: 2 }))
    expect(tendencies(totals).find((t) => t.key === 'af')!.value).toBeCloseTo(1.5, 5)
  })

  it('measures showdowns against flops seen, and wins against showdowns', () => {
    const totals = spread(100, (i) => ({
      sawFlop: i < 50,
      showdown: i < 20,
      wonShowdown: i < 9,
    }))
    const stats = tendencies(totals)
    expect(stats.find((t) => t.key === 'wtsd')!.value).toBeCloseTo(0.4, 5)
    expect(stats.find((t) => t.key === 'wsd')!.value).toBeCloseTo(0.45, 5)
  })
})

describe('what to work on', () => {
  it('calls out a player who plays everything', () => {
    const notes = diagnose(spread(100, (i) => ({ vpip: i < 70, pfr: i < 10 })))
    expect(notes.some((n) => n.tone === 'bad' && /a lot of weak holdings/.test(n.text))).toBe(true)
  })

  it('calls out limping', () => {
    const notes = diagnose(spread(100, (i) => ({ vpip: i < 30, pfr: i < 5 })))
    expect(notes.some((n) => /limping/.test(n.text))).toBe(true)
  })

  it('calls out a calling station', () => {
    const notes = diagnose(spread(60, () => ({ aggressive: 1, passive: 5 })))
    expect(notes.some((n) => /calling station/.test(n.text))).toBe(true)
  })

  it('calls out paying people off at showdown', () => {
    const notes = diagnose(spread(100, (i) => ({
      sawFlop: true, showdown: i < 50, wonShowdown: i < 15,
    })))
    expect(notes.some((n) => /paying people off/.test(n.text))).toBe(true)
  })

  it('has nothing bad to say about a sensible player', () => {
    const notes = diagnose(spread(100, (i) => ({
      vpip: i < 26, pfr: i < 20, sawFlop: i < 26, showdown: i < 7, wonShowdown: i < 4,
      aggressive: 2, passive: 1,
    })))
    expect(notes.some((n) => n.tone === 'bad')).toBe(false)
  })
})

describe('the rating', () => {
  it('sits at the base when nothing is given up', () => {
    const totals = spread(200, () => ({
      decisions: [{ street: 'preflop', action: 'fold', recommended: 'fold', agreed: true, evLost: 0, leak: null }],
    }))
    const score = rating(totals)
    expect(score.value).toBe(RATING_BASE)
    expect(score.agreement).toBe(1)
    expect(score.provisional).toBe(false)
  })

  it('falls as expected value is given up', () => {
    const leaky = spread(200, () => ({
      decisions: [{ street: 'flop', action: 'call', recommended: 'fold', agreed: false, evLost: 100, leak: 'Called too light' }],
    }))
    const score = rating(leaky)
    // $1.00 given up per hand is two big blinds, so 200 bb per 100 hands.
    expect(score.evLossPer100).toBeCloseTo((100 / BIG_BLIND) * 100, 5)
    expect(score.value).toBeLessThan(RATING_BASE)
  })

  it('says so while it is still guessing', () => {
    const thin = spread(10, () => ({
      decisions: [{ street: 'flop', action: 'call', recommended: 'call', agreed: true, evLost: 0, leak: null }],
    }))
    expect(rating(thin).provisional).toBe(true)
    expect(rating(thin).decisions).toBeLessThan(PROVISIONAL_DECISIONS)
  })

  it('narrows the confidence band as decisions pile up', () => {
    const noisy = (n: number) => spread(n, (i) => ({
      decisions: [{
        street: 'flop', action: 'call', recommended: 'fold', agreed: false,
        evLost: i % 2 === 0 ? 200 : 0, leak: 'Called too light',
      }],
    }))
    const few = rating(noisy(40))
    const many = rating(noisy(400))
    expect(many.margin).toBeLessThan(few.margin)
    // Same average mistake, so the rating itself should barely move.
    expect(Math.abs(many.value - few.value)).toBeLessThan(10)
  })

  it('ranks a careful player above a loose one', () => {
    const careful = spread(200, (i) => ({
      decisions: [{ street: 'flop', action: 'fold', recommended: 'fold', agreed: i > 10, evLost: i > 10 ? 0 : 40, leak: null }],
    }))
    const loose = spread(200, () => ({
      decisions: [{ street: 'flop', action: 'call', recommended: 'fold', agreed: false, evLost: 150, leak: 'Called too light' }],
    }))
    expect(rating(careful).value).toBeGreaterThan(rating(loose).value)
  })
})

describe('the calibration anchors', () => {
  /**
   * These EV-index figures were measured by playing each bot skill level
   * against a fixed field with every decision scored by the coach. The test
   * does not re-measure them — that takes about ten minutes, and lives behind
   * `npm run calibrate`. What it does is hold the rating constants to the
   * scale those measurements set, so a casual tweak cannot quietly turn the
   * rating into a number that means nothing.
   */
  const MEASURED: [string, number, number][] = [
    ['skill 1', 214.8, 1049],
    ['skill 2', 68.3, 1357],
    ['skill 3', 26.5, 1444],
    ['skill 4', 30.6, 1436],
    ['skill 5', 9.3, 1481],
  ]

  /** Build totals that give up exactly `evIndex` big blinds per 100 hands. */
  function atEvIndex(evIndex: number): PlayerTotals {
    const hands = 400
    const perHand = Math.round((evIndex / 100) * BIG_BLIND)
    return spread(hands, () => ({
      decisions: [{
        street: 'flop', action: 'call', recommended: 'fold',
        agreed: false, evLost: perHand, leak: 'Called too light',
      }],
    }))
  }

  it.each(MEASURED)('places %s at about %d EV index on the rating scale', (_label, ev, expected) => {
    expect(rating(atEvIndex(ev)).value).toBeCloseTo(expected, -1)
  })

  it('keeps the beginner-to-solid gap near the 400 points chess uses', () => {
    const gap = rating(atEvIndex(26.5)).value - rating(atEvIndex(214.8)).value
    expect(gap).toBeGreaterThan(350)
    expect(gap).toBeLessThan(450)
  })

  it('bands every measured profile the way the docs claim', () => {
    expect(ratingBand(rating(atEvIndex(214.8)).value)).toBe('Paying for lessons')
    expect(ratingBand(rating(atEvIndex(68.3)).value)).toBe('Coming along')
    expect(ratingBand(rating(atEvIndex(26.5)).value)).toBe('Solid')
    expect(ratingBand(rating(atEvIndex(9.3)).value)).toBe('Playing the line')
  })
})

describe('results, with the honesty attached', () => {
  it('reports the win rate in big blinds per hundred', () => {
    const totals = spread(100, () => ({ net: 50 }))
    expect(winRate(totals).bbPer100).toBeCloseTo(100, 5) // 1bb a hand
  })

  it('puts a confidence band on it that shrinks with more hands', () => {
    const swingy = (n: number) => spread(n, (i) => ({ net: i % 2 === 0 ? 2000 : -2000 }))
    const short = winRate(swingy(100))
    const long = winRate(swingy(2000))
    expect(long.margin).toBeLessThan(short.margin)
    expect(short.margin).toBeGreaterThan(0)
  })

  it('says how many hands it would take to actually know', () => {
    const totals = spread(200, (i) => ({ net: i % 2 === 0 ? 1500 : -1500 }))
    const rate = winRate(totals)
    // Swings this big need a very large sample before the number means much.
    expect(rate.handsForConfidence).toBeGreaterThan(10_000)
  })

  it('is honest about a sample of one', () => {
    expect(winRate(spread(1, () => ({ net: 4000 }))).margin).toBe(Infinity)
  })
})
