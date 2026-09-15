/**
 * The Dexter: a bounty for winning with 7-2, named for Dexter Manley's number.
 *
 * The most BNOTW thing in the app and the least like poker, which is exactly
 * why it is its own file. It rides on top of a settled hand — `core/showdown`
 * awards the pots, and only then is the bounty looked for — so a rule about
 * who pays whom afterwards can never change who won.
 *
 * The qualification is deliberately strict: 7-2 in the hole, a board that
 * reached the river, and a *sole* winner of the whole hand. A chop never
 * counts.
 */

import { DEXTER_RANKS, dexterPayPerPlayer, money } from '../bnotw'
import { cardCode, type Card } from '../cards'
import type { HandState, Phase, Seat } from '../types'
import { log, name } from '../core/state'

export interface DexterCandidate {
  seat: number
  hole: Card[]
  dexterNumber: number
  perPlayer: number
  total: number
  payers: number[]
}

/**
 * Award the pots. `tableSeats` is every seat at the table (not just this hand)
 * because a Dexter is paid by everyone in the game, not only the hand.
 */

/**
 * Did somebody just win a Dexter? Requires 7-2 in the hole, a board that got
 * to the river, and a sole winner of the whole hand. A chop never counts.
 */
export function findDexter(
  state: HandState,
  seats: Seat[],
  options: { dexterCount: number; tableSeats: number[] },
): DexterCandidate | null {
  if (state.board.length < 5) return null
  if (state.awards.some((a) => a.split)) return null

  const winners = new Set(state.awards.map((a) => a.seat))
  if (winners.size !== 1) return null

  const seat = [...winners][0]
  const hole = state.players[seat].hole
  if (!isDexterHand(hole)) return null
  if (seats[seat].sittingOut) return null

  const dexterNumber = options.dexterCount + 1
  const payers = options.tableSeats.filter((s) => s !== seat)
  const perPlayer = dexterPayPerPlayer(dexterNumber)

  return { seat, hole: [...hole], dexterNumber, perPlayer, total: perPlayer * payers.length, payers }
}

/** Exactly a 7 and a 2, any suits. */
export function isDexterHand(hole: Card[]): boolean {
  if (hole.length !== 2) return false
  const ranks = hole.map((c) => c.rank).sort((a, b) => b - a)
  return ranks[0] === DEXTER_RANKS[0] && ranks[1] === DEXTER_RANKS[1]
}

/**
 * The 7-2 winner either shows and collects, or mucks and waives the bonus.
 * Returns the claim if it was collected.
 */
export function settleDexter(state: HandState, seats: Seat[], show: boolean): DexterCandidate | null {
  const claim = state.pendingDexter
  state.pendingDexter = null
  state.phase = 'showdown'
  state.complete = true
  if (!claim) return null

  if (!show) {
    log(state, `${name(seats, claim.seat)} mucks and lets the Dexter go`, 'normal')
    return null
  }

  state.players[claim.seat].revealed = true

  // A short stack can only pay what it has in front of it.
  let collected = 0
  for (const payer of claim.payers) {
    const paid = Math.min(claim.perPlayer, seats[payer].stack)
    seats[payer].stack -= paid
    collected += paid
  }
  claim.total = collected
  seats[claim.seat].stack += collected
  state.dexter = claim

  const ordinal = ['', '1st', '2nd', '3rd'][claim.dexterNumber] ?? `${claim.dexterNumber}th`
  log(
    state,
    `DEXTER! ${name(seats, claim.seat)} shows ${claim.hole.map(cardCode).join(' ')} — ` +
      `${ordinal} of the night, everyone else pays ${money(claim.perPlayer)} ` +
      `(${money(claim.total)} total)`,
    'dexter',
  )
  return claim
}

export type { Phase }
