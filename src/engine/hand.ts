/**
 * One hand of poker, start to finish — and the BNOTW rules layered on top.
 *
 * This file used to *be* the engine. It is now the place the pieces are wired
 * together, which is the point: the rules of poker live under `core/` and this
 * table's own rules live under `rules/`, and nothing in `core/` imports
 * anything from `rules/`. That direction is checked by a test rather than
 * trusted, because it is the kind of thing that erodes one convenient import
 * at a time.
 *
 * Why it matters here specifically: the house rules are genuinely strange.
 * Bomb pots deal the flop before anyone acts, straddles move who speaks last,
 * and the Dexter pays a bounty for winning with the worst hand in poker.
 * Letting any of that settle into the betting or the showdown would mean the
 * rules of poker could not be read, tested or reused without them.
 *
 * Everything the rest of the app imported from here still comes from here, so
 * the split changed no callers.
 *
 * State is mutated in place. The table layer owns the `Seat[]` array (stacks
 * live there, because they outlive a hand) and passes it into every call.
 */

import { cardCode, type Shoe } from './cards'
import {
  BIG_BLIND, BOMB_POT_GAMES, SMALL_BLIND, namedBetFor, money, type BombPotGame,
} from './bnotw'
import type {
  Action, HandPlayer, HandState, Phase, Seat, Street, Variant,
} from './types'
import { blindSeats, commit, log, name, record } from './core/state'
import { findNextToAct, closeBettingRound, openBettingRound } from './core/betting'
import { applyAction as coreApplyAction } from './core/betting'
import { advanceStreet as coreAdvanceStreet } from './core/streets'
import { awardPots } from './core/showdown'
import { findDexter } from './rules/dexter'
import { noteSuitedFlop } from './rules/bombPot'
import { dealBombPot } from './rules/bombPot'

// ---------------------------------------------------------------------------
// What the rest of the app imports from here
// ---------------------------------------------------------------------------

export {
  handPlayers, livePlayers, contenders, potTotal,
} from './core/state'
export { legalActions, roundComplete, type LegalActions } from './core/betting'
export { isRunout } from './core/streets'
export { buildPots } from './core/pots'
export { bestHand } from './core/showdown'
export { nextStraddleAmount, straddleCandidates, addStraddle } from './rules/straddle'
export { isMonotone } from './rules/bombPot'
export { isDexterHand, settleDexter, type DexterCandidate } from './rules/dexter'
export type { Phase }

// ---------------------------------------------------------------------------
// Setting up a hand
// ---------------------------------------------------------------------------

export interface HandSetup {
  handNumber: number
  seats: Seat[]
  /** Seats dealt into this hand, clockwise starting left of the button. */
  order: number[]
  buttonSeat: number
  variant: Variant
  bombGame: BombPotGame | null
  bombReason: string | null
}

export function createHand(setup: HandSetup): HandState {
  const players: Record<number, HandPlayer> = {}
  for (const seat of setup.order) {
    players[seat] = {
      seat,
      hole: [],
      discarded: null,
      folded: false,
      allIn: false,
      hasActed: false,
      canRaise: true,
      committedRound: 0,
      committedHand: 0,
      startingStack: setup.seats[seat].stack,
      lastAction: null,
      revealed: false,
      straddle: 0,
    }
  }

  const isBomb = setup.variant !== 'holdem'

  const state: HandState = {
    handNumber: setup.handNumber,
    variant: setup.variant,
    isBombPot: isBomb,
    bombGame: setup.bombGame,
    bombReason: setup.bombReason,
    buttonSeat: setup.buttonSeat,
    smallBlindSeat: null,
    bigBlindSeat: null,
    street: 'preflop',
    // Bomb pots have no pre-flop action, so there is no straddle window.
    phase: isBomb ? 'street' : 'straddles',
    board: [],
    players,
    order: setup.order,
    currentBet: 0,
    lastRaiseSize: BIG_BLIND,
    actingSeat: null,
    pendingDiscards: [],
    straddles: [],
    lastBlindSeat: null,
    pots: [],
    awards: [],
    pendingDexter: null,
    dexter: null,
    suitedFlopTriggered: false,
    log: [],
    journal: [],
    complete: false,
  }

  state.log.push({
    id: 0,
    street: 'setup',
    text: isBomb
      ? `Hand #${setup.handNumber} — BOMB POT (${BOMB_POT_GAMES[setup.bombGame!].name})${setup.bombReason ? ` · ${setup.bombReason}` : ''}`
      : `Hand #${setup.handNumber} — $0.25/$0.50 No-Limit Hold'em`,
    tone: isBomb ? 'bomb' : 'normal',
  })

  return state
}

/**
 * The next straddle amount: double the largest forced bet already out there.
 * The first straddle is twice the big blind.
 */

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

/** Deal the hand this table is actually playing. */
export function dealHand(state: HandState, seats: Seat[], shoe: Shoe): void {
  if (state.isBombPot) dealBombPot(state, seats, shoe)
  else dealHoldem(state, seats, shoe)
}

function dealHoldem(state: HandState, seats: Seat[], shoe: Shoe): void {
  const [sbSeat, bbSeat] = blindSeats(state)
  state.smallBlindSeat = sbSeat
  state.bigBlindSeat = bbSeat

  const sb = state.players[sbSeat]
  const bb = state.players[bbSeat]
  const sbPaid = commit(seats, sb, SMALL_BLIND)
  record(state, sbSeat, 'blind', sbPaid, { allIn: sb.allIn })
  const bbPaid = commit(seats, bb, BIG_BLIND)
  record(state, bbSeat, 'blind', bbPaid, { allIn: bb.allIn })
  log(state, `${name(seats, sbSeat)} posts the small blind ${money(sb.committedRound)}`)
  log(state, `${name(seats, bbSeat)} posts the big blind ${money(bb.committedRound)}`)

  state.currentBet = bb.committedRound
  state.lastRaiseSize = BIG_BLIND
  state.lastBlindSeat = bbSeat

  // Straddles are ordered the way they were declared; each one doubles the
  // previous forced bet and takes over as the last live blind.
  for (const straddle of state.straddles) {
    const p = state.players[straddle.seat]
    const paid = commit(seats, p, straddle.amount)
    p.straddle = p.committedRound
    record(state, straddle.seat, 'straddle', paid, { allIn: p.allIn })
    const label = state.straddles.indexOf(straddle) === 0 ? 'straddles' : 're-straddles'
    log(state, `${name(seats, straddle.seat)} ${label} ${money(p.committedRound)}`, 'bnotw')
    if (p.committedRound > state.currentBet) {
      state.currentBet = p.committedRound
      // A straddle is a live blind: it plays as the big blind for this hand,
      // so the next raise has to double it rather than merely top it up.
      state.lastRaiseSize = p.committedRound
      state.lastBlindSeat = straddle.seat
    }
  }

  for (const seat of state.order) {
    state.players[seat].hole = shoe.drawMany(2)
  }

  // Everyone who posted has money out but has not yet acted, so the last live
  // blind still gets its option when the action comes back around.
  state.phase = 'acting'
  state.actingSeat = findNextToAct(state, state.lastBlindSeat!)
  if (state.actingSeat === null) closeBettingRound(state)
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

// ---------------------------------------------------------------------------
// Acting, with the house's own names on the bets
// ---------------------------------------------------------------------------

/**
 * Take an action, logging a named bet as the table would say it out loud.
 *
 * `core/betting` does not know what a Bob-aloo is and should not: the naming
 * is a joke this table shares, not a rule of poker. It is bound here.
 */
export function applyAction(
  state: HandState,
  seats: Seat[],
  seat: number,
  action: Action,
): void {
  coreApplyAction(state, seats, seat, action, (cents) => {
    const named = namedBetFor(cents)
    return named
      ? { label: `${named.name} (${money(cents)})`, house: true }
      : { label: money(cents), house: false }
  })
}

// ---------------------------------------------------------------------------
// Streets, and what this table makes of them
// ---------------------------------------------------------------------------

/**
 * Deal the next street, then let the house rules react to it.
 *
 * The reaction happens after, never during. A monotone flop arming the next
 * bomb pot is something BNOTW does about a board; dealing the board is poker.
 */
export function advanceStreet(state: HandState, shoe: Shoe): Street {
  const street = coreAdvanceStreet(state, shoe)
  if (street === 'flop') noteSuitedFlop(state)
  return street
}

// ---------------------------------------------------------------------------
// Showdown, then the bounty
// ---------------------------------------------------------------------------

/**
 * Award the pots, then look for a Dexter.
 *
 * In that order, deliberately. The bounty is money that changes hands after a
 * hand is settled, and sequencing it this way makes it impossible for a house
 * rule to affect who actually won the pot.
 *
 * `tableSeats` is every seat in the game rather than only this hand, because a
 * Dexter is paid by everyone at the table whether or not they were in it.
 */
export function resolveShowdown(
  state: HandState,
  seats: Seat[],
  options: { dexterCount: number; tableSeats: number[] },
): void {
  awardPots(state, seats)

  const dexter = findDexter(state, seats, options)
  if (dexter) {
    state.pendingDexter = dexter
    state.phase = 'dexterShow'
    state.complete = false
  }
}
