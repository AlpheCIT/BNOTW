// @vitest-environment jsdom
/**
 * The leak report, the trend, and the per-hand grade.
 *
 * All three are places where a confident-looking number would be easy and
 * wrong, so most of what is tested is the hedging: an unpriceable leak that is
 * neither dropped nor priced at zero, a trend that says when it does not have
 * enough behind it, and a grade that refuses to call a folded hand perfect.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatsView } from './StatsView'
import { accumulate, emptyTotals, type DecisionRecord, type HandRecord } from '../engine/playerStats'
import { BIG_BLIND } from '../engine/bnotw'
import type { TrackerApi } from './useTracker'

afterEach(cleanup)

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    street: 'flop', action: 'call', recommended: 'call',
    agreed: true, evLost: 0, leak: null, ...over,
  }
}

function hand(decisions: DecisionRecord[], at = 1): HandRecord {
  return {
    at, mode: 'table', handNumber: at, bomb: false, position: 'btn',
    hole: 'As Kd', couldStraddle: true, straddled: false, vpip: true, pfr: false,
    facedRaise: false, threeBet: false, sawFlop: true, showdown: false,
    wonShowdown: false, net: 0, aggressive: 0, passive: 1,
    dexterHeld: false, dexterWon: false, decisions,
  }
}

function show(hands: HandRecord[]) {
  const tracker: TrackerApi = {
    totals: hands.reduce(accumulate, emptyTotals()),
    recent: hands,
    hydrated: true,
    setNote: () => {},
    recordDecision: () => {},
    completeHand: () => {},
    deleteHands: () => {},
    reset: () => {},
  }
  render(<StatsView tracker={tracker} />)
}

function panel(heading: string): HTMLElement | undefined {
  return [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('h2')?.textContent === heading) as HTMLElement | undefined
}

const many = (n: number, d: DecisionRecord, at = 1) =>
  Array.from({ length: n }, (_, i) => hand([d], at + i))

const priced = (cents: number) =>
  decision({ agreed: false, recommended: 'fold', evLost: cents, leak: 'Called too light' })
const unpriced = decision({ agreed: false, recommended: 'bet', evLost: 0, leak: 'Missed value' })

describe('the leak report', () => {
  it('puts what it can price above what it cannot, however often each happens', () => {
    show([...many(30, unpriced), ...many(3, priced(BIG_BLIND * 5), 100)])
    const rows = [...panel('Your Biggest Leaks')!.querySelectorAll('.leakrow b')]
      .map((n) => n.textContent)
    // Ten times as many of the other. Frequency alone would invert this.
    expect(rows[0]).toBe('Called too light')
  })

  it('says plainly when a cost could not be measured', () => {
    show(many(5, unpriced))
    expect(panel('Your Biggest Leaks')!.textContent).toMatch(/cost not measurable/i)
  })

  it('explains that not measurable is not the same as free', () => {
    show(many(5, unpriced))
    // Without this the reader concludes those leaks do not matter.
    expect(panel('Your Biggest Leaks')!.textContent).toMatch(/does not mean free/i)
  })

  it('shows what a priced leak actually cost, in money and big blinds', () => {
    show(many(4, priced(BIG_BLIND * 2)))
    const text = panel('Your Biggest Leaks')!.textContent ?? ''
    expect(text).toMatch(/4 times/)
    expect(text).toMatch(/big blinds/)
  })

  it('bands a leak by severity only when there is a price behind it', () => {
    show(many(3, priced(BIG_BLIND * 9)))
    expect(panel('Your Biggest Leaks')!.querySelector('.tag.sev-major')).not.toBe(null)

    cleanup()
    show(many(3, unpriced))
    expect(panel('Your Biggest Leaks')!.querySelector('[class*="sev-"]')).toBe(null)
  })

  it('draws a share bar only for leaks that have a share', () => {
    show([...many(3, priced(BIG_BLIND * 2)), ...many(3, unpriced, 100)])
    // A bar of length zero beside an unpriced leak reads as "costs nothing".
    expect(panel('Your Biggest Leaks')!.querySelectorAll('.leakbar')).toHaveLength(1)
  })

  it('is absent entirely on a clean record', () => {
    show(many(5, decision()))
    expect(panel('Your Biggest Leaks')).toBe(undefined)
  })
})

describe('the trend', () => {
  const run = (n: number, agreed: number, at: number) =>
    Array.from({ length: n }, (_, i) =>
      hand([decision({ agreed: i < agreed, evLost: i < agreed ? 0 : 400 })], at + i))

  it('does not appear until there are two full windows', () => {
    show(run(150, 150, 1))
    expect(panel('Are You Improving?')).toBe(undefined)
  })

  it('compares decision quality rather than winnings', () => {
    show([...run(100, 90, 1000), ...run(100, 40, 1)])
    const text = panel('Are You Improving?')!.textContent ?? ''
    expect(text).toMatch(/not on what you won/i)
    expect(text).toMatch(/90/)
    expect(text).toMatch(/40/)
  })

  it('names the direction once there is enough behind it', () => {
    show([...run(100, 90, 1000), ...run(100, 40, 1)])
    expect(panel('Are You Improving?')!.textContent).toMatch(/more often than you were/i)
  })

  it('says when the windows are too thin to mean anything', () => {
    // Two full windows of hands, but barely any decisions inside them.
    const thin = [
      ...Array.from({ length: 100 }, (_, i) => hand(i < 5 ? [decision()] : [], 1000 + i)),
      ...Array.from({ length: 100 }, (_, i) => hand(i < 5 ? [decision()] : [], i)),
    ]
    show(thin)
    expect(panel('Are You Improving?')!.textContent).toMatch(/not enough yet/i)
  })
})

describe('grading a hand in the list', () => {
  it('grades a hand you played well an A', () => {
    show([hand([decision(), decision()])])
    expect(screen.getByTitle(/2 decisions in this hand/).textContent).toBe('A')
  })

  it('grades an expensive mistake an F', () => {
    show([hand([priced(BIG_BLIND * 20)])])
    expect(screen.getByTitle(/1 decision in this hand/).textContent).toBe('F')
  })

  it('refuses to grade a hand with no decisions in it', () => {
    show([hand([])])
    // An average over nothing is a perfect score, which would make folding
    // every hand the best-graded way to play.
    expect(document.querySelector('.grade')).toBe(null)
    const row = panel('Recent Hands')!.querySelector('tbody tr')!
    expect([...row.querySelectorAll('td')][2].textContent).toBe('—')
  })
})
