/**
 * The pieces every part of a hand needs: who is in it, what is in the middle,
 * and how chips get there.
 *
 * Plain functions over plain state, deliberately. `HandState` is data with no
 * methods and no closures, which is what lets it cross a `structuredClone`
 * boundary into the coach worker — and, one day, a network. A class hierarchy
 * here would read more tidily and quietly break both.
 */

import type {
  HandPlayer, HandState, JournalEntry, LogEntry, Seat,
} from '../types'

export function handPlayers(state: HandState): HandPlayer[] {
  return state.order.map((seat) => state.players[seat])
}

/** Everyone who has not folded. */
export function livePlayers(state: HandState): HandPlayer[] {
  return handPlayers(state).filter((p) => !p.folded)
}

/** Everyone who has not folded and still has chips to bet. */
export function contenders(state: HandState): HandPlayer[] {
  return handPlayers(state).filter((p) => !p.folded && !p.allIn)
}

export function orderIndex(state: HandState, seat: number): number {
  return state.order.indexOf(seat)
}

/** Walk clockwise from `afterSeat`, returning seats in order (excluding it). */
export function seatsAfter(state: HandState, afterSeat: number): number[] {
  const start = orderIndex(state, afterSeat)
  const out: number[] = []
  for (let i = 1; i <= state.order.length; i++) {
    out.push(state.order[(start + i) % state.order.length])
  }
  return out
}

export function log(state: HandState, text: string, tone: LogEntry['tone'] = 'normal') {
  state.log.push({ id: state.log.length, street: state.street, text, tone })
}

/** Record a chip movement in the structured history. Call it after the commit. */
export function record(
  state: HandState,
  seat: number,
  kind: JournalEntry['kind'],
  amount: number,
  extra: Partial<JournalEntry> = {},
) {
  state.journal.push({
    street: state.street,
    seat,
    kind,
    amount,
    to: state.players[seat]?.committedRound ?? 0,
    pot: potTotal(state),
    ...extra,
  })
}

export function name(seats: Seat[], seat: number): string {
  return seats[seat]?.name ?? `Seat ${seat + 1}`
}

/** Move chips from a stack into the pot. Returns the amount actually moved. */
export function commit(seats: Seat[], p: HandPlayer, toTotal: number): number {
  const seatObj = seats[p.seat]
  const delta = Math.max(0, Math.min(toTotal - p.committedRound, seatObj.stack))
  seatObj.stack -= delta
  p.committedRound += delta
  p.committedHand += delta
  if (seatObj.stack === 0) p.allIn = true
  return delta
}

export function potTotal(state: HandState): number {
  return handPlayers(state).reduce((sum, p) => sum + p.committedHand, 0)
}

/**
 * Who posts the small and the big blind, in that order.
 *
 * Heads-up the button *is* the small blind, which is why this walks the order
 * rather than assuming the two seats to the button's left.
 */
export function blindSeats(state: HandState): number[] {
  const after = seatsAfter(state, state.buttonSeat)
  // Heads-up: the button is the small blind.
  if (state.order.length === 2) return [state.buttonSeat, after[0]]
  return [after[0], after[1]]
}
