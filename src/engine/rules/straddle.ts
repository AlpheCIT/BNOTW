/**
 * The straddle: a blind raise, posted before the cards, that buys the last word.
 *
 * A BNOTW rule, not a rule of poker, which is why it lives here. Each straddle
 * doubles the previous forced bet and takes over as the live blind — so the
 * next raise has to double *it* rather than merely top it up, and the
 * straddler acts last before the flop.
 */

import { BIG_BLIND } from '../bnotw'
import type { HandState, Seat } from '../types'
import { blindSeats } from '../core/state'

/**
 * The next straddle amount: double the largest forced bet already out there.
 * The first straddle is twice the big blind.
 */
export function nextStraddleAmount(state: HandState): number {
  const last = state.straddles[state.straddles.length - 1]
  return last ? last.amount * 2 : BIG_BLIND * 2
}

/**
 * Seats that could still put out a straddle. BNOTW allows a straddle from any
 * position, so the only constraints are that a seat straddles at most once,
 * that it is not one of the blinds, and that it can cover the amount.
 */
export function straddleCandidates(state: HandState, seats: Seat[]): number[] {
  const amount = nextStraddleAmount(state)
  const taken = new Set(state.straddles.map((s) => s.seat))
  const blinds = blindSeats(state)
  return state.order.filter(
    (seat) => !taken.has(seat) && !blinds.includes(seat) && seats[seat].stack >= amount,
  )
}

/** Which seats will post the small and big blind this hand. */

export function addStraddle(state: HandState, seats: Seat[], seat: number): void {
  if (state.phase !== 'straddles') throw new Error('Straddles are closed')
  if (!straddleCandidates(state, seats).includes(seat)) {
    throw new Error(`Seat ${seat} cannot straddle right now`)
  }
  state.straddles.push({ seat, amount: nextStraddleAmount(state) })
}
