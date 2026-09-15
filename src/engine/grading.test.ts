/**
 * Grading, severity, leaks and the trend.
 *
 * The tests that matter most here are the ones about what the numbers refuse
 * to claim: that an unpriceable mistake is still a mistake, that folding every
 * hand is not an A, and that a hundred hands of results is not a trend.
 */

import { describe, it, expect } from 'vitest'
import {
  PRICED_LEAKS, SEVERITY_BB, TREND_MINIMUM, bb, gradeDecisions, gradeHand,
  isPriced, leakReport, letterFor, scoreDecision, severityOf, trend,
} from './grading'
import { accumulate, emptyTotals, type DecisionRecord, type HandRecord } from './playerStats'
import { reviewDecision, type CoachAdvice } from './coach'
import { BIG_BLIND } from './bnotw'

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    street: 'flop', action: 'call', recommended: 'call',
    agreed: true, evLost: 0, leak: null, ...over,
  }
}

const slip = (evLost: number, leak = 'Called too light') =>
  decision({ agreed: false, recommended: 'fold', evLost, leak })

function hand(decisions: DecisionRecord[], at = 1): HandRecord {
  return {
    at, mode: 'coach', handNumber: at, bomb: false, position: 'btn',
    hole: 'As Kd', couldStraddle: true, straddled: false, vpip: true, pfr: false,
    facedRaise: false, threeBet: false, sawFlop: true, showdown: false,
    wonShowdown: false, net: 0, aggressive: 0, passive: 1,
    dexterHeld: false, dexterWon: false, decisions,
  }
}

describe('severity', () => {
  it('has nothing to say about a decision that cost nothing measurable', () => {
    expect(severityOf(0)).toBe(null)
    expect(severityOf(-100)).toBe(null)
  })

  it('bands a slip by what it actually gave up', () => {
    expect(severityOf(BIG_BLIND * 0.4)).toBe('minor')
    expect(severityOf(BIG_BLIND * SEVERITY_BB.moderate)).toBe('moderate')
    expect(severityOf(BIG_BLIND * SEVERITY_BB.major)).toBe('major')
    expect(severityOf(BIG_BLIND * 20)).toBe('major')
  })

  it('converts to big blinds, which is how mistakes get talked about', () => {
    expect(bb(BIG_BLIND * 3)).toBe(3)
  })
})

describe('which leaks carry a price', () => {
  /** Every leak the coach can record, driven rather than copied. */
  function produced(): Map<string, number[]> {
    const out = new Map<string, number[]>()
    const kinds = ['fold', 'check', 'call', 'bet', 'raise'] as const
    for (const want of kinds) {
      for (const did of kinds) {
        for (const callEV of [-900, 0, 900]) {
          for (const [wantAmount, didAmount] of [[0, 0], [600, 100]]) {
            const advice = {
              board: [],
              equity: { equity: 0.4, exact: true, runouts: 1 },
              outs: { count: 0, groups: [] },
              breakEven: 0.3,
              callEV,
              pot: 1000,
              toCall: 200,
              opponents: 2,
              madeLabel: 'Ace high',
              starting: { label: 'A-K', chen: 10, grade: 'Strong', note: '' },
              recommendation: {
                action: want, headline: 'x', reasons: [], confidence: 'clear',
                amount: wantAmount || undefined,
              },
            } as unknown as CoachAdvice
            const review = reviewDecision(advice, { kind: did, amount: didAmount || undefined })
            if (!review.leak) continue
            out.set(review.leak, [...(out.get(review.leak) ?? []), review.evLost])
          }
        }
      }
    }
    return out
  }

  it('marks exactly the leaks that ever carry an EV figure', () => {
    const real = produced()
    const everPriced = [...real.entries()]
      .filter(([, costs]) => costs.some((c) => c > 0))
      .map(([leak]) => leak)
      .sort()
    // Copied by hand this would go stale the first time a leak was reworded.
    expect(everPriced).toEqual([...PRICED_LEAKS].sort())
  })

  it('leaves the unpriced ones genuinely at zero rather than guessing', () => {
    for (const [leak, costs] of produced()) {
      if (isPriced(leak)) continue
      // A made-up number here would rank an unknowable cost against a known one.
      expect(costs.every((c) => c === 0), leak).toBe(true)
    }
  })
})

describe('grading a decision', () => {
  it('gives a full mark for matching the coach', () => {
    expect(scoreDecision(decision())).toBe(1)
  })

  it('never gives full marks for a mistake, even a free one', () => {
    // Three of the most common leaks cost nothing measurable. Scoring them 1
    // would make them invisible to every grade in the app.
    const free = decision({ agreed: false, evLost: 0, leak: 'Missed value' })
    expect(scoreDecision(free)).toBeLessThanOrEqual(0.5)
    expect(scoreDecision(free)).toBeGreaterThan(0)
  })

  it('scores worse the more it cost', () => {
    const small = scoreDecision(slip(BIG_BLIND))
    const big = scoreDecision(slip(BIG_BLIND * 4))
    expect(big).toBeLessThan(small)
    expect(small).toBeLessThan(0.5)
  })

  it('bottoms out rather than going negative on a disaster', () => {
    expect(scoreDecision(slip(BIG_BLIND * 500))).toBe(0)
  })

  it('bands into letters, best first', () => {
    expect(letterFor(1)).toBe('A')
    expect(letterFor(0)).toBe('F')
    const order = [1, 0.85, 0.7, 0.5, 0.1].map(letterFor)
    expect(order).toEqual(['A', 'B', 'C', 'D', 'F'])
  })
})

describe('grading a hand', () => {
  it('splits the grade by street', () => {
    const graded = gradeHand(hand([
      decision({ street: 'preflop' }),
      decision({ street: 'flop' }),
      { ...slip(BIG_BLIND * 5), street: 'turn' as const },
      decision({ street: 'river' }),
    ]))!
    expect(graded.byStreet.preflop?.letter).toBe('A')
    expect(graded.byStreet.turn?.letter).toBe('F')
    expect(graded.byStreet.river?.letter).toBe('A')
    // Three good streets and one bad one is not a failing hand.
    expect(graded.overall.letter).not.toBe('F')
  })

  it('leaves out a street you never acted on', () => {
    const graded = gradeHand(hand([decision({ street: 'preflop' })]))!
    expect(Object.keys(graded.byStreet)).toEqual(['preflop'])
  })

  it('refuses to grade a hand with no decisions in it', () => {
    // An average over nothing is 1, which would make folding every hand a
    // perfect session.
    expect(gradeDecisions([])).toBe(null)
    expect(gradeHand(hand([]))).toBe(null)
  })
})

describe('the leak report', () => {
  const totalsWith = (hands: HandRecord[]) => hands.reduce(accumulate, emptyTotals())

  it('ranks what it can price above what it cannot', () => {
    const totals = totalsWith([
      hand(Array.from({ length: 30 }, () => decision({
        agreed: false, evLost: 0, leak: 'Missed value',
      }))),
      hand(Array.from({ length: 3 }, () => slip(BIG_BLIND * 5))),
    ])
    const rows = leakReport(totals)
    // Thirty of one and three of the other: frequency alone would invert this.
    expect(rows[0].leak).toBe('Called too light')
    expect(rows[0].priced).toBe(true)
    expect(rows[1].leak).toBe('Missed value')
    expect(rows[1].priced).toBe(false)
  })

  it('keeps an unpriced leak rather than dropping it at zero', () => {
    const totals = totalsWith([hand([decision({
      agreed: false, evLost: 0, leak: 'Too aggressive',
    })])])
    const [row] = leakReport(totals)
    // "You bet hands you should check, forty times" is a real finding.
    expect(row.count).toBe(1)
    expect(row.evLost).toBe(0)
    expect(row.severity).toBe(null)
  })

  it('adds up what a leak has actually cost', () => {
    const totals = totalsWith([hand([slip(300), slip(500), slip(200)])])
    const [row] = leakReport(totals)
    expect(row.count).toBe(3)
    expect(row.evLost).toBe(1000)
    expect(row.share).toBeCloseTo(1)
  })

  it('bands a leak by what one instance typically costs', () => {
    const cheap = totalsWith([hand([slip(20), slip(20)])])
    const dear = totalsWith([hand([slip(BIG_BLIND * 9)])])
    expect(leakReport(cheap)[0].severity).toBe('minor')
    expect(leakReport(dear)[0].severity).toBe('major')
  })

  it('sorts unpriced leaks by how often they happen', () => {
    const totals = totalsWith([
      hand(Array.from({ length: 2 }, () => decision({ agreed: false, leak: 'Off the line' }))),
      hand(Array.from({ length: 9 }, () => decision({ agreed: false, leak: 'Missed value' }))),
    ])
    expect(leakReport(totals).map((r) => r.leak)).toEqual(['Missed value', 'Off the line'])
  })

  it('has nothing to report on a clean record', () => {
    expect(leakReport(totalsWith([hand([decision()])]))).toEqual([])
  })
})

describe('the trend', () => {
  const window = (count: number, agreed: number, at = 0) =>
    Array.from({ length: count }, (_, i) =>
      hand([decision({ agreed: i < agreed, evLost: i < agreed ? 0 : 400 })], at + i))

  it('refuses to compare until there are two full windows', () => {
    expect(trend(window(30, 30), 20)).toBe(null)
    expect(trend(window(39, 39), 20)).toBe(null)
    expect(trend(window(40, 40), 20)).not.toBe(null)
  })

  it('compares decision quality, not money', () => {
    // Hands are newest first, the way the tracker holds them.
    const recent = window(20, 18)
    const older = window(20, 8)
    const result = trend([...recent, ...older], 20)!
    expect(result.recent.accuracy).toBeCloseTo(0.9)
    expect(result.previous.accuracy).toBeCloseTo(0.4)
    expect(result.accuracyChange).toBeGreaterThan(0)
    // Improving means giving up less, so the cost change is negative.
    expect(result.costChange).toBeLessThan(0)
  })

  it('says when there is too little in the windows to mean anything', () => {
    const thin = trend([...window(20, 20), ...window(20, 10)], 20)!
    expect(thin.enough).toBe(false)

    const thick = trend(
      [...window(TREND_MINIMUM + 5, TREND_MINIMUM), ...window(TREND_MINIMUM + 5, 10)],
      TREND_MINIMUM + 5,
    )!
    expect(thick.enough).toBe(true)
  })

  it('reports no change as no change rather than as progress', () => {
    const flat = trend([...window(50, 40), ...window(50, 40)], 50)!
    expect(flat.accuracyChange).toBeCloseTo(0)
    expect(flat.costChange).toBeCloseTo(0)
  })
})
