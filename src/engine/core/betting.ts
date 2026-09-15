/**
 * A betting round: who acts, what they may do, and what it costs.
 *
 * Pure poker. Nothing here knows about straddles, bomb pots or the Dexter —
 * the one place the house rules leaked in was the log line naming a bet
 * "Bob-aloo", and that is now passed in rather than imported. Keeping this
 * module free of BNOTW is what makes a plain Hold'em table possible later, and
 * what stops a change to the house rules breaking the rules of poker.
 */

import { BIG_BLIND, money } from '../bnotw'
import type { Action, HandState, Seat } from '../types'
import {
  commit, contenders, handPlayers, livePlayers, log, name, record, seatsAfter,
} from './state'

export function openBettingRound(state: HandState): void {
  for (const p of handPlayers(state)) {
    p.committedRound = 0
    p.hasActed = false
    p.canRaise = true
    p.lastAction = null
  }
  state.currentBet = 0
  state.lastRaiseSize = BIG_BLIND
  state.phase = 'acting'
  state.actingSeat = findNextToAct(state, state.buttonSeat)
  if (state.actingSeat === null) closeBettingRound(state)
}

/**
 * Is the current betting round finished? It is once every player who can still
 * act has acted since the last raise and has matched the current bet.
 */
export function roundComplete(state: HandState): boolean {
  if (livePlayers(state).length <= 1) return true
  const able = contenders(state)
  if (able.length === 0) return true
  if (able.length === 1) return able[0].committedRound >= state.currentBet
  return able.every((p) => p.hasActed && p.committedRound === state.currentBet)
}

export function findNextToAct(state: HandState, afterSeat: number): number | null {
  if (roundComplete(state)) return null
  for (const seat of seatsAfter(state, afterSeat)) {
    const p = state.players[seat]
    if (p.folded || p.allIn) continue
    if (!p.hasActed || p.committedRound < state.currentBet) return seat
  }
  return null
}

export function closeBettingRound(state: HandState): void {
  state.actingSeat = null
  state.phase = 'street'
}

export interface LegalActions {
  seat: number
  canFold: boolean
  canCheck: boolean
  /** Extra chips needed to call; 0 when checking is free. */
  callAmount: number
  callIsAllIn: boolean
  /** True when no one has bet yet this street. */
  canBet: boolean
  canRaise: boolean
  /** Total this player would be at after a minimum bet/raise. */
  minRaiseTo: number
  /** Total this player would be at if they shoved. */
  maxRaiseTo: number
  /** True when the only legal raise is an under-sized all-in. */
  raiseIsAllInOnly: boolean
}

export function legalActions(state: HandState, seats: Seat[], seat: number): LegalActions {
  const p = state.players[seat]
  const stack = seats[seat].stack
  const owed = state.currentBet - p.committedRound
  const maxRaiseTo = p.committedRound + stack
  const facingBet = owed > 0

  const minRaiseTo = facingBet
    ? state.currentBet + state.lastRaiseSize
    : Math.max(state.currentBet + state.lastRaiseSize, BIG_BLIND)

  // You can always shove; you just may not be able to make a *full* raise.
  const hasRaiseRoom = maxRaiseTo > state.currentBet
  const allowedToRaise = p.canRaise && hasRaiseRoom

  return {
    seat,
    canFold: facingBet,
    canCheck: !facingBet,
    callAmount: Math.min(owed, stack),
    callIsAllIn: facingBet && owed >= stack,
    canBet: !facingBet && allowedToRaise,
    canRaise: facingBet && allowedToRaise,
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
    raiseIsAllInOnly: allowedToRaise && maxRaiseTo < minRaiseTo,
  }
}

export function applyAction(
  state: HandState,
  seats: Seat[],
  seat: number,
  action: Action,
  /**
   * How a bet is named in the log.
   *
   * This exists because "Bob-aloo ($1.75)" is a BNOTW joke, not a poker rule,
   * and betting should not have to import the house rules to write a log line.
   * `hand.ts` binds the table's own names; the default is the plain amount.
   */
  describeBet: (cents: number) => { label: string; house: boolean } =
    (cents) => ({ label: money(cents), house: false }),
): void {
  if (state.phase !== 'acting') throw new Error(`Cannot act during phase "${state.phase}"`)
  if (state.actingSeat !== seat) throw new Error(`It is not seat ${seat}'s turn`)

  const p = state.players[seat]
  const legal = legalActions(state, seats, seat)
  const who = name(seats, seat)
  const before = p.committedRound

  switch (action.kind) {
    case 'fold': {
      p.folded = true
      p.hasActed = true
      p.lastAction = 'Fold'
      log(state, `${who} folds`)
      break
    }
    case 'check': {
      if (!legal.canCheck) throw new Error(`${who} cannot check facing a bet`)
      p.hasActed = true
      p.lastAction = 'Check'
      log(state, `${who} checks`)
      break
    }
    case 'call': {
      if (legal.callAmount <= 0) throw new Error(`${who} has nothing to call`)
      const paid = commit(seats, p, state.currentBet)
      p.hasActed = true
      p.lastAction = p.allIn ? `Call ${money(paid)} (all in)` : `Call ${money(paid)}`
      log(state, `${who} calls ${money(paid)}${p.allIn ? ' and is all in' : ''}`)
      break
    }
    case 'bet':
    case 'raise': {
      const target = action.amount ?? 0
      if (!legal.canBet && !legal.canRaise) throw new Error(`${who} cannot raise`)
      if (target > legal.maxRaiseTo) throw new Error(`${who} cannot cover ${money(target)}`)
      if (target <= state.currentBet) throw new Error('Raise must exceed the current bet')
      if (target < legal.minRaiseTo && target !== legal.maxRaiseTo) {
        throw new Error(`Minimum is ${money(legal.minRaiseTo)}`)
      }
      // An all-in for less than a full raise is legal, but it does not reopen
      // the betting for players who have already acted this round.
      const isFullRaise = target - state.currentBet >= state.lastRaiseSize

      const increment = target - state.currentBet
      const previousBet = state.currentBet
      commit(seats, p, target)
      state.currentBet = p.committedRound

      if (isFullRaise) {
        state.lastRaiseSize = increment
        for (const other of contenders(state)) {
          if (other.seat === seat) continue
          other.hasActed = false
          other.canRaise = true
        }
      } else {
        for (const other of contenders(state)) {
          if (other.seat === seat) continue
          if (other.hasActed) other.canRaise = false
          else other.canRaise = true
        }
      }

      p.hasActed = true
      const named = describeBet(p.committedRound)
      const verb = previousBet === 0 ? 'bets' : 'raises to'
      p.lastAction = `${previousBet === 0 ? 'Bet' : 'Raise'} ${money(p.committedRound)}`
      log(
        state,
        `${who} ${verb} ${named.label}${p.allIn ? ' and is all in' : ''}`,
        named.house ? 'bnotw' : 'normal',
      )
      break
    }
  }

  record(state, seat, action.kind, p.committedRound - before, { allIn: p.allIn })

  if (livePlayers(state).length <= 1) {
    closeBettingRound(state)
    return
  }

  const next = findNextToAct(state, seat)
  if (next === null) closeBettingRound(state)
  else state.actingSeat = next
}
