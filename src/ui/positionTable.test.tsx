// @vitest-environment jsdom
/**
 * The position table.
 *
 * What is guarded here is mostly restraint: a positional win rate is a sixth
 * of an already small sample, so the screen has to say that rather than print
 * six confident-looking numbers.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatsView } from './StatsView'
import { accumulate, emptyTotals, POSITION_SAMPLE, type HandRecord } from '../engine/playerStats'
import type { TrackerApi } from './useTracker'

afterEach(cleanup)

function hand(position: string, net: number): HandRecord {
  return {
    at: 1, mode: 'table', handNumber: 1, bomb: false, position,
    hole: 'As Kd', couldStraddle: true, straddled: false, vpip: true, pfr: false,
    facedRaise: false, threeBet: false, sawFlop: true, showdown: false,
    wonShowdown: false, net, aggressive: 1, passive: 0,
    dexterHeld: false, dexterWon: false,
    decisions: [{
      street: 'flop', action: 'call', recommended: 'call',
      agreed: true, evLost: 0, leak: null,
    }],
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

/** The position panel's own table, found by its heading. */
function positionRows(): string[][] {
  const panel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('h2')?.textContent === 'By Position')
  if (!panel) throw new Error('no position panel')
  return [...panel.querySelectorAll('tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''))
}

const many = (position: string, count: number, net: number) =>
  Array.from({ length: count }, () => hand(position, net))

describe('showing the seats', () => {
  it('lists only the seats actually played, in table order', () => {
    show([...many('bb', 5, -100), ...many('btn', 5, 200)])
    expect(positionRows().map((r) => r[0])).toEqual(['BTN', 'BB'])
  })

  it('prints a confidence band beside every win rate', () => {
    show(many('btn', 40, 200))
    // A bare bb/100 column invites a conclusion the sample cannot support.
    expect(positionRows()[0][2]).toMatch(/±/)
  })

  it('greys a win rate built on too few hands', () => {
    show(many('btn', POSITION_SAMPLE - 1, 200))
    const panel = [...document.querySelectorAll('.panel')]
      .find((p) => p.querySelector('h2')?.textContent === 'By Position')!
    const cell = panel.querySelectorAll('tbody td')[2]
    expect(cell.className).toMatch(/faint/)
    expect(cell.className).not.toMatch(/\bpos\b/)
  })

  it('colours one that has earned it', () => {
    show(many('btn', POSITION_SAMPLE + 10, 200))
    const panel = [...document.querySelectorAll('.panel')]
      .find((p) => p.querySelector('h2')?.textContent === 'By Position')!
    expect(panel.querySelectorAll('tbody td')[2].className).toMatch(/\bpos\b/)
  })

  it('shows a dash rather than a rate it cannot support', () => {
    show(many('sb', 3, -100))
    const [, , , vpip, pfr, accuracy] = positionRows()[0]
    expect([vpip, pfr, accuracy]).toEqual(['—', '—', '—'])
  })
})

describe('hands from before positions were kept', () => {
  it('says how many cannot be placed rather than hiding them', () => {
    show([...many('other', 12, 100), ...many('btn', 5, 100)])
    const panel = [...document.querySelectorAll('.panel')]
      .find((p) => p.querySelector('h2')?.textContent === 'By Position')!
    // The row count and the hand count disagree, and the screen has to own it.
    expect(panel.textContent).toMatch(/12 earlier hands are not in this table/)
  })

  it('explains the empty table when nothing can be placed at all', () => {
    show(many('other', 20, 100))
    expect(screen.getByText(/Nothing to place yet/)).toBeTruthy()
    expect(document.body.textContent).toMatch(/earlier 20 hands cannot be placed/)
  })

  it('still counts those hands in the totals above', () => {
    show(many('other', 20, 100))
    // They are missing from one table, not from your record.
    const panel = [...document.querySelectorAll('.panel')]
      .find((p) => p.querySelector('h2')?.textContent === 'Recent Hands')
    expect(panel?.textContent).toMatch(/20 hands/)
  })
})
