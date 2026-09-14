/** Helpers shared by the engine tests. */

import { Shoe, parseCards } from './cards'
import { BUY_IN_CHIPS } from './bnotw'
import { personaFromArchetype } from './persona'
import { createHand } from './hand'
import type { BombPotGame } from './bnotw'
import type { HandState, Seat, Variant } from './types'

export function makeSeats(stacks: number[]): Seat[] {
  return stacks.map((stack, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isHuman: i === 0,
    seat: i,
    stack,
    buyIns: 1,
    sittingOut: false,
    persona: personaFromArchetype(`P${i}`, 'grinder', `p${i}`),
  }))
}

export function evenSeats(count: number, stack = BUY_IN_CHIPS): Seat[] {
  return makeSeats(Array(count).fill(stack))
}

/** A shoe that deals the given cards in the order written. */
export function stackedShoe(codes: string): Shoe {
  return new Shoe(Math.random, parseCards(codes).reverse())
}

/** Clockwise seat order for a hand, starting to the button's left. */
export function dealOrder(seats: Seat[], buttonSeat: number): number[] {
  const active = seats.filter((s) => !s.sittingOut && s.stack > 0).map((s) => s.seat)
  const i = active.indexOf(buttonSeat)
  return [...active.slice(i + 1), ...active.slice(0, i + 1)]
}

export function newHand(
  seats: Seat[],
  buttonSeat: number,
  variant: Variant = 'holdem',
  bombGame: BombPotGame | null = null,
): HandState {
  return createHand({
    handNumber: 1,
    seats,
    order: dealOrder(seats, buttonSeat),
    buttonSeat,
    variant,
    bombGame,
    bombReason: null,
  })
}

/**
 * Total chips in play: every stack, plus anything still sitting in the middle.
 * Once the pots have been awarded the money is back in the stacks, so the
 * committed totals are history rather than chips and must not be counted.
 */
export function chipsInPlay(seats: Seat[], state: HandState | null): number {
  const stacks = seats.reduce((sum, s) => sum + s.stack, 0)
  const settled = !state || state.awards.length > 0
  const middle = settled
    ? 0
    : Object.values(state.players).reduce((sum, p) => sum + p.committedHand, 0)
  return stacks + middle
}
