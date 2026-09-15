/**
 * Bomb pots: everybody antes, the flop is already out, nobody chose to be here.
 *
 * Two BNOTW rules in one file, because they are the same rule seen from both
 * ends. `dealBombPot` runs the hand that *is* one; `noteSuitedFlop` spots the
 * monotone flop that makes the *next* hand one.
 *
 * Keeping the trigger out of `core/streets.ts` matters more than it looks: the
 * order a board is dealt in is poker, and what this table does about a flop of
 * three hearts is not. Drill mode found that out the hard way — it was dealing
 * practice spots into bomb pots because the trigger fired inside the core.
 */

import { BIG_BLIND, BOMB_POT_GAMES, money } from '../bnotw'
import { cardCode, type Card, type Shoe } from '../cards'
import type { HandState, Seat } from '../types'
import { commit, log, record } from '../core/state'
import { openBettingRound } from '../core/betting'

/** A flop of three cards in one suit. The trigger for the next bomb pot. */
export function isMonotone(board: Card[]): boolean {
  return board.length >= 3 && board.slice(0, 3).every((c) => c.suit === board[0].suit)
}

/**
 * Arm the next hand if this flop was monotone.
 *
 * Called by `hand.ts` after a street is dealt rather than from inside the
 * dealing itself, so a caller that wants plain poker simply does not call it.
 */
export function noteSuitedFlop(state: HandState): void {
  if (state.isBombPot || !isMonotone(state.board)) return
  state.suitedFlopTriggered = true
  log(state, 'All three flop cards are the same suit — next hand is a BOMB POT!', 'bomb')
}

export function dealBombPot(state: HandState, seats: Seat[], shoe: Shoe): void {
  const game = BOMB_POT_GAMES[state.bombGame!]
  log(state, `Everyone antes ${money(game.ante)} — no pre-flop betting`, 'bomb')

  for (const seat of state.order) {
    const p = state.players[seat]
    const paid = commit(seats, p, game.ante)
    record(state, seat, 'ante', paid, { allIn: p.allIn })
  }
  for (const seat of state.order) {
    state.players[seat].hole = shoe.drawMany(game.holeCards)
  }

  // Antes are dead money: they belong to the pot, not to this street's bet.
  for (const seat of state.order) {
    state.players[seat].committedRound = 0
  }
  state.currentBet = 0
  state.lastRaiseSize = BIG_BLIND

  state.street = 'flop'
  state.board = shoe.drawMany(3)
  log(state, `Flop: ${state.board.map(cardCode).join(' ')}`, 'bomb')

  if (game.discardAfterFlop) {
    state.phase = 'discard'
    state.pendingDiscards = [...state.order]
  } else {
    openBettingRound(state)
  }
}

/** Crazy Pineapple: pitch one of the three hole cards after the flop. */
export function applyDiscard(state: HandState, seat: number, cardIndex: number): void {
  if (state.phase !== 'discard') throw new Error('Not a discard phase')
  if (!state.pendingDiscards.includes(seat)) throw new Error(`Seat ${seat} has no discard due`)
  const p = state.players[seat]
  if (cardIndex < 0 || cardIndex >= p.hole.length) throw new Error('Bad discard index')

  p.discarded = p.hole.splice(cardIndex, 1)[0]
  record(state, seat, 'discard', 0, { card: cardCode(p.discarded) })
  state.pendingDiscards = state.pendingDiscards.filter((s) => s !== seat)

  if (state.pendingDiscards.length === 0) {
    log(state, 'Everyone pitches a card. Betting is open.', 'bomb')
    openBettingRound(state)
  }
}
