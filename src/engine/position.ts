/**
 * Where you were sitting, named once.
 *
 * This logic existed three times — in the coach's reasoning, in the table's
 * heading, and as a `button` / `other` flag on the hand record — which is two
 * copies too many for something that is about to be written into permanent
 * history. Everything now comes from `positionOf`.
 *
 * ### The record used to throw this away
 *
 * `HandRecord.position` was `'button' | 'other'`, so "how do I play from under
 * the gun" was not a question the history could answer — not because the sums
 * were hard but because the information was discarded at the moment it was
 * free. Every hand played before this change is permanently unanalysable by
 * position, which is the reason this landed ahead of larger work.
 *
 * ### The short-handed bug this fixes
 *
 * The old versions tested the seat's *index* before testing the blinds:
 *
 *     if (i === n - 1) return 'on the button'
 *     if (i === n - 2) return 'in the cut-off'
 *     if (seat === state.smallBlindSeat) ...
 *
 * At a full table that is right. Three-handed it is not — `n - 2` is the big
 * blind, and heads-up it is the big blind again — so the coach was telling
 * short-handed players they were in the cut-off when they were in the blind,
 * and adjusting its pre-flop bar accordingly. Blinds are now decided by the
 * seat they actually are, and position by index only for the seats in between.
 */

import type { HandState } from './types'

export type Position = 'ep' | 'mp' | 'co' | 'btn' | 'sb' | 'bb'

/** Table order, earliest to act pre-flop last, the way a tracker lists them. */
export const POSITIONS: Position[] = ['btn', 'co', 'mp', 'ep', 'bb', 'sb']

/** Short labels, for a column heading. */
export const POSITION_SHORT: Record<Position, string> = {
  btn: 'BTN',
  co: 'CO',
  mp: 'MP',
  ep: 'EP',
  bb: 'BB',
  sb: 'SB',
}

/** The words the coach uses, which read as part of a sentence. */
export const POSITION_LABEL: Record<Position, string> = {
  btn: 'on the button',
  co: 'in the cut-off',
  mp: 'in middle position',
  ep: 'in early position',
  bb: 'in the big blind',
  sb: 'in the small blind',
}

/** Late position: last to act after the flop, where a marginal hand is worth more. */
export function isLate(position: Position): boolean {
  return position === 'btn' || position === 'co'
}

/**
 * Which position a seat is in for this hand.
 *
 * Blinds first, because a seat that posted a blind *is* that position however
 * few players are left. Only the seats between the big blind and the button
 * are decided by where they sit, and there is no cut-off at all when nobody is
 * sitting there.
 *
 * A bomb pot posts no blinds, so everybody is placed by seat — which is right,
 * since position after the flop is the only thing position means in a hand
 * with no pre-flop round.
 */
export function positionOf(state: HandState, seat: number): Position {
  const i = state.order.indexOf(seat)
  if (i < 0) return 'ep'
  if (seat === state.buttonSeat) return 'btn'
  if (seat === state.smallBlindSeat) return 'sb'
  if (seat === state.bigBlindSeat) return 'bb'

  const n = state.order.length
  if (i === n - 2) return 'co'
  return i <= Math.floor(n / 3) ? 'ep' : 'mp'
}

/** The coach's phrasing for a seat, straight from the hand. */
export function positionLabelFor(state: HandState | null, seat: number): string {
  if (!state) return 'in this seat'
  return POSITION_LABEL[positionOf(state, seat)]
}

/**
 * Read a stored position back, including the two values that predate this.
 *
 * Records written before positions were kept say `button` or `other`. The
 * first is recoverable; the second is genuinely unknown and is reported as
 * such rather than being guessed into a bucket it would then distort.
 */
export function storedPosition(value: string): Position | null {
  if ((POSITIONS as string[]).includes(value)) return value as Position
  if (value === 'button') return 'btn'
  return null
}
