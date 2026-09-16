// @vitest-environment jsdom
/**
 * The end-of-hand recap.
 *
 * It exists because the coach panel only ever held one verdict: each decision
 * overwrote the last, so in a four-decision hand three were gone by the time
 * the hand ended. "I can't see the feedback from the hand" was an accurate
 * description of something working exactly as written.
 *
 * So the test that matters most is that every decision survives.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { HandRecap } from './HandRecap'
import { BIG_BLIND } from '../engine/bnotw'
import type { DecisionRecord, HandRecord } from '../engine/playerStats'

afterEach(cleanup)

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    street: 'flop', action: 'call', recommended: 'call',
    agreed: true, evLost: 0, leak: null, ...over,
  }
}

function hand(decisions: DecisionRecord[], over: Partial<HandRecord> = {}): HandRecord {
  return {
    at: 1, mode: 'coach', handNumber: 7, bomb: false, position: 'btn',
    hole: 'As Kd', couldStraddle: true, straddled: false, vpip: true, pfr: false,
    facedRaise: false, threeBet: false, sawFlop: true, showdown: false,
    wonShowdown: false, net: 0, aggressive: 0, passive: 1,
    dexterHeld: false, dexterWon: false, decisions, ...over,
  }
}

const FOUR = [
  decision({ street: 'preflop', action: 'call', recommended: 'fold', agreed: false, evLost: 50, leak: 'Called too light' }),
  decision({ street: 'flop', action: 'call', recommended: 'fold', agreed: false, evLost: 131, leak: 'Called too light' }),
  decision({ street: 'turn', action: 'check', recommended: 'bet', agreed: false, evLost: 0, leak: 'Missed value' }),
  decision({ street: 'river', action: 'check', recommended: 'check', agreed: true }),
]

describe('every decision survives', () => {
  it('shows one row per decision, not just the last', () => {
    render(<HandRecap hand={hand(FOUR)} />)
    // The whole point: four decisions, four rows.
    expect(document.querySelectorAll('.recap-row')).toHaveLength(4)
  })

  it('names the street each one was on', () => {
    render(<HandRecap hand={hand(FOUR)} />)
    const streets = [...document.querySelectorAll('.recap-street')].map((n) => n.textContent)
    expect(streets).toEqual(['Pre-flop', 'Flop', 'Turn', 'River'])
  })

  it('reads in play order rather than worst first', () => {
    // Given out of order, as a record trimmed or re-read might be.
    const shuffled = [FOUR[3], FOUR[1], FOUR[0], FOUR[2]]
    render(<HandRecap hand={hand(shuffled)} />)
    const streets = [...document.querySelectorAll('.recap-street')].map((n) => n.textContent)
    expect(streets).toEqual(['Pre-flop', 'Flop', 'Turn', 'River'])
  })
})

describe('what each row says', () => {
  it('says what you did and what was wanted', () => {
    render(<HandRecap hand={hand([FOUR[0]])} />)
    const row = document.querySelector('.recap-row')!.textContent ?? ''
    expect(row).toMatch(/You called/)
    expect(row).toMatch(/would have folded/)
  })

  it('says so plainly when you got it right', () => {
    render(<HandRecap hand={hand([FOUR[3]])} />)
    const row = document.querySelector('.recap-row')!
    expect(row.textContent).toMatch(/that was the play/)
    expect(row.className).toMatch(/\bok\b/)
  })

  it('marks a mistake without shouting about it', () => {
    render(<HandRecap hand={hand([FOUR[0]])} />)
    expect(document.querySelector('.recap-row')!.className).toMatch(/\boff\b/)
  })

  it('names the leak, so the row is searchable later', () => {
    render(<HandRecap hand={hand(FOUR)} />)
    expect(screen.getAllByText('Called too light')).toHaveLength(2)
    expect(screen.getByText('Missed value')).toBeTruthy()
  })

  it('shows a dash rather than a zero for a cost it cannot measure', () => {
    render(<HandRecap hand={hand([FOUR[2]])} />)
    // Missed value is a real mistake with no price on it. "$0.00" would read
    // as free.
    expect(document.querySelector('.recap-cost')!.textContent).toContain('—')
  })

  it('bands an expensive mistake by severity', () => {
    const costly = decision({ agreed: false, recommended: 'fold', evLost: BIG_BLIND * 9, leak: 'Called too light' })
    render(<HandRecap hand={hand([costly])} />)
    expect(document.querySelector('.tag.sev-major')).not.toBe(null)
  })
})

describe('the hand as a whole', () => {
  it('adds up what the hand gave away', () => {
    render(<HandRecap hand={hand(FOUR)} />)
    expect(document.querySelector('.recap-foot')!.textContent).toMatch(/\$1\.81/)
    expect(document.querySelector('.recap-foot')!.textContent).toMatch(/4 decisions/)
  })

  it('says nothing was given up rather than showing a zero', () => {
    render(<HandRecap hand={hand([FOUR[3]])} />)
    expect(document.querySelector('.recap-foot')!.textContent)
      .toMatch(/Nothing measurably given up/)
  })

  it('grades the hand', () => {
    render(<HandRecap hand={hand(FOUR)} />)
    expect(document.querySelector('.grade')).not.toBe(null)
  })

  it('offers the replay only when the hand kept one', () => {
    render(<HandRecap hand={hand(FOUR)} />)
    expect(screen.queryByText('Replay it')).toBe(null)

    cleanup()
    let replayed = false
    render(<HandRecap hand={hand(FOUR)} onReplay={() => { replayed = true }} />)
    fireEvent.click(screen.getByText('Replay it'))
    expect(replayed).toBe(true)
  })

  it('has something honest to say about a hand you never acted in', () => {
    render(<HandRecap hand={hand([])} />)
    // A grade over no decisions would be an A, which folding every hand would
    // then farm.
    expect(document.querySelector('.grade')).toBe(null)
    expect(document.body.textContent).toMatch(/never put to a decision/)
  })
})
