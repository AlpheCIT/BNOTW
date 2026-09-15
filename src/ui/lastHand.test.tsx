// @vitest-environment jsdom
/**
 * The hand that just happened, one tap away.
 *
 * Replay already existed, but only from My Game and only for hands that kept
 * one — so the moment you most want to look at a hand, straight after playing
 * it, was the moment it was hardest to reach.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act as reactAct, fireEvent } from '@testing-library/react'
import { TableView } from './TableView'
import { testGame } from './testTable'
import { buildReplay } from '../engine/replay'
import { advanceStreet, applyAction, dealHand, resolveShowdown } from '../engine/hand'
import { cardCode, makeDeck } from '../engine/cards'
import { evenSeats, newHand, setHoleCards, stackedShoe } from '../engine/testkit'
import { accumulate, emptyTotals, type HandRecord, type PlayMode } from '../engine/playerStats'
import type { TrackerApi } from './useTracker'

afterEach(cleanup)

/** A genuinely finished hand, flattened the way the tracker flattens one. */
function finishedReplay() {
  const seats = evenSeats(3)
  const hand = newHand(seats, 2)
  dealHand(hand, seats, stackedShoe('2c 3c 4c 5c 6c 7c'))
  setHoleCards(hand, { 0: 'Ah Kh', 1: '7c 2d', 2: '9s 8s' })

  applyAction(hand, seats, 2, { kind: 'call' })
  applyAction(hand, seats, 0, { kind: 'fold' })
  applyAction(hand, seats, 1, { kind: 'check' })

  const board = ['Qh', 'Jh', '10h', '4c', '3d']
  const taken = new Set([...board, 'Ah', 'Kh', '7c', '2d', '9s', '8s'])
  const burn = makeDeck().map(cardCode).filter((c) => !taken.has(c)).slice(0, 3)
  const shoe = stackedShoe(
    `${burn[0]} ${board.slice(0, 3).join(' ')} ${burn[1]} ${board[3]} ${burn[2]} ${board[4]}`,
  )
  let guard = 0
  while (hand.phase !== 'showdown' && guard++ < 24) {
    if (hand.phase === 'street') advanceStreet(hand, shoe)
    else if (hand.phase === 'acting') applyAction(hand, seats, hand.actingSeat!, { kind: 'check' })
    else break
  }
  resolveShowdown(hand, seats, { dexterCount: 0, tableSeats: [0, 1, 2] })
  return buildReplay(hand, seats, 0)
}

function record(mode: PlayMode, at: number): HandRecord {
  return {
    at, mode, handNumber: 7, bomb: false, position: 'other', hole: 'Ah Kh',
    couldStraddle: true, straddled: false, vpip: false, pfr: false, facedRaise: false,
    threeBet: false, sawFlop: false, showdown: false, wonShowdown: false, net: -50,
    aggressive: 0, passive: 0, dexterHeld: false, dexterWon: false,
    decisions: [], replay: finishedReplay(),
  }
}

function tracker(hands: HandRecord[]): TrackerApi {
  return {
    totals: hands.reduce(accumulate, emptyTotals()),
    recent: [...hands].sort((a, b) => b.at - a.at),
    hydrated: true,
    setNote: () => {},
    recordDecision: () => {},
    completeHand: () => {},
    deleteHands: () => {},
    reset: () => {},
  }
}

async function settle() {
  await reactAct(async () => { vi.advanceTimersByTime(400) })
}

function renderTable(hands: HandRecord[], mode: PlayMode = 'table') {
  render(
    <TableView
      game={testGame(5, 'any')}
      onCashOut={() => {}}
      tracker={tracker(hands)}
      mode={mode}
    />,
  )
}

describe('the last hand', () => {
  it('is not offered before there is one', () => {
    renderTable([])
    expect(screen.queryByText('Last hand')).toBe(null)
  })

  it('opens the replay of the hand just played', () => {
    renderTable([record('table', 1000)])
    fireEvent.click(screen.getByText('Last hand'))

    const replay = document.querySelector('.dialog.replay')
    expect(replay).not.toBe(null)
    // The replay carries the hand number the engine gave it, which is what
    // the record stores alongside it.
    expect(replay!.textContent).toMatch(/Hand #1\b/)
  })

  it('closes again', () => {
    renderTable([record('table', 1000)])
    fireEvent.click(screen.getByText('Last hand'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.dialog.replay')).toBe(null)
  })

  it('shows this mode’s last hand, not the other mode’s', () => {
    // Coaching and the table keep separate records on purpose; a coach-mode
    // hand appearing at the table would be a hand that never happened there.
    renderTable([record('coach', 5000), record('table', 1000)], 'table')
    fireEvent.click(screen.getByText('Last hand'))
    expect(document.querySelector('.dialog.replay')).not.toBe(null)
  })

  it('is not offered at the table when only coach hands exist', () => {
    renderTable([record('coach', 5000)], 'table')
    expect(screen.queryByText('Last hand')).toBe(null)
  })

  it('is offered in coach mode too, not only at the table', () => {
    renderTable([record('coach', 5000)], 'coach')
    expect(screen.queryByText('Last hand')).not.toBe(null)
  })

  it('skips a hand that kept no replay', () => {
    const { replay: _dropped, ...noReplay } = record('table', 1000)
    renderTable([noReplay as HandRecord])
    expect(screen.queryByText('Last hand')).toBe(null)
  })
})

describe('the action bar still works around it', () => {
  it('does not steal the decision buttons', async () => {
    vi.useFakeTimers()
    renderTable([record('table', 1000)])
    await settle()
    // The control sits in the status bar, not over the thing you act with.
    expect(document.querySelectorAll('.action-buttons .btn').length).toBeGreaterThan(0)
  })
})
