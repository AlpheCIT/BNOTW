// @vitest-environment jsdom
/**
 * The frequency layer on screen.
 *
 * Two things are worth guarding and neither is the arithmetic, which
 * `frequency.test.ts` already pins down:
 *
 * - it stays off until it is switched on, like every other layer;
 * - the half that keeps it honest — that a floor is only worth holding against
 *   somebody who bluffs — actually reaches the screen. A panel that showed the
 *   number and dropped the caveat would be worse than no panel, because it
 *   would have people calling off stacks against the one man at the table who
 *   has never bluffed in his life.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CoachPanel } from './CoachPanel'
import { advise } from '../engine/coach'
import { applyAction, dealHand } from '../engine/hand'
import { Shoe, mulberry32 } from '../engine/cards'
import { evenSeats, newHand, setHoleCards } from '../engine/testkit'
import { BIG_BLIND } from '../engine/bnotw'
import type { Read } from '../engine/reads'
import type { LayerId } from '../engine/layers'

afterEach(cleanup)

const ALL: LayerId[] = ['price', 'hand', 'player', 'frequency', 'table']

/** A real spot with a real raise in front of the hero. Nothing stubbed. */
function facingARaise(hole = 'Ah Kh') {
  const seats = evenSeats(6)
  const hand = newHand(seats, 3)
  dealHand(hand, seats, new Shoe(mulberry32(11)))
  if (hand.phase === 'straddles') hand.phase = 'acting'
  applyAction(hand, seats, hand.actingSeat!, { kind: 'raise', amount: BIG_BLIND * 3 })
  const seat = hand.actingSeat!
  setHoleCards(hand, { [seat]: hole })
  return { advice: advise(hand, seats, seat, mulberry32(3), 300), hand }
}

function read(over: Partial<Read> = {}): Read {
  return { foldRate: 0.4, aggression: 0.3, confidence: 1, station: 0, ...over }
}

function renderWith(layers: LayerId[], reads: { seat: number; name: string; read: Read }[] = []) {
  const { advice } = facingARaise()
  render(
    <CoachPanel
      advice={advice} review={null} layers={layers} position="on the button" reads={reads}
    />,
  )
  return advice
}

describe('staying out of the way until it is asked for', () => {
  it('shows nothing at all with the earlier layers on', () => {
    renderWith(['price', 'hand', 'player'])
    expect(screen.queryByText('The frequency')).toBe(null)
    expect(document.querySelector('.freq-rows')).toBe(null)
  })

  it('appears once it is switched on', () => {
    renderWith(ALL)
    expect(screen.getByText('The frequency')).toBeTruthy()
    expect(document.querySelector('.freq-rows')).not.toBe(null)
  })
})

describe('what it puts on screen facing a bet', () => {
  it('names both sides of the price — what they risked and what they can win', () => {
    const advice = renderWith(ALL)
    const panel = document.querySelector('.layer-panel:has(.freq-rows)')!
    expect(panel.textContent).toMatch(/breaks even if you fold/i)
    expect(advice.defence).not.toBeNull()
  })

  it('shows the share of the range that has to continue', () => {
    renderWith(ALL)
    const rows = [...document.querySelectorAll('.freq-row')].map((n) => n.textContent ?? '')
    expect(rows.some((r) => /of your range has to go on/i.test(r))).toBe(true)
  })

  it('splits the load when several players can do the defending', () => {
    renderWith(ALL)
    const rows = [...document.querySelectorAll('.freq-row')].map((n) => n.textContent ?? '')
    expect(rows.some((r) => /your share of it/i.test(r))).toBe(true)
  })

  it('says outright that it does not know your cards', () => {
    renderWith(ALL)
    const panel = document.querySelector('.layer-panel:has(.freq-rows)')!
    expect(panel.textContent).toMatch(/nothing here knows your cards/i)
  })
})

describe('the half that stops it being a number to obey', () => {
  it('admits it cannot say anything about a player nobody has watched', () => {
    const { advice } = facingARaise()
    render(
      <CoachPanel
        advice={advice} review={null} layers={ALL} position="on the button"
        reads={[{ seat: advice.bettor!, name: 'Dave', read: read({ confidence: 0 }) }]}
      />,
    )
    const verdict = document.querySelector('.freq-verdict')!
    expect(verdict.className).toMatch(/unknown/)
    expect(verdict.textContent).toMatch(/not enough hands on them/i)
  })

  it('tells you to hold the floor against somebody who bets plenty', () => {
    const { advice } = facingARaise()
    render(
      <CoachPanel
        advice={advice} review={null} layers={ALL} position="on the button"
        reads={[{ seat: advice.bettor!, name: 'Dave', read: read({ aggression: 0.55 }) }]}
      />,
    )
    const verdict = document.querySelector('.freq-verdict')!
    expect(verdict.className).toMatch(/binds/)
    expect(verdict.textContent).toMatch(/Dave/)
    expect(verdict.textContent).toMatch(/worth holding/i)
  })

  /*
   * The one that matters for a home game. Most of the crew do not bluff
   * anywhere near enough to make the floor bite, and a coach that told them to
   * defend it anyway would be teaching them to pay off the tightest player at
   * the table.
   */
  it('lets you fold well past the floor against somebody who never bets', () => {
    const { advice } = facingARaise()
    render(
      <CoachPanel
        advice={advice} review={null} layers={ALL} position="on the button"
        reads={[{ seat: advice.bettor!, name: 'Brett', read: read({ aggression: 0.03 }) }]}
      />,
    )
    const verdict = document.querySelector('.freq-verdict')!
    expect(verdict.className).toMatch(/overfolds-fine/)
    expect(verdict.textContent).toMatch(/Brett/)
    expect(verdict.textContent).toMatch(/folding more than the floor is the profitable mistake/i)
  })

  it('does not put a read on the wrong player’s name', () => {
    const { advice } = facingARaise()
    const notTheBettor = advice.bettor === 0 ? 1 : 0
    render(
      <CoachPanel
        advice={advice} review={null} layers={ALL} position="on the button"
        reads={[{ seat: notTheBettor, name: 'Wrongun', read: read({ aggression: 0.9 }) }]}
      />,
    )
    const verdict = document.querySelector('.freq-verdict')!
    expect(verdict.textContent).not.toMatch(/Wrongun/)
    expect(verdict.className).toMatch(/unknown/)
  })
})
