/**
 * Splitting the middle.
 *
 * Side pots are built from what each player *committed*, not from who is still
 * in: a player all-in for less can only win the part of the pot they matched,
 * however much everyone else puts in afterwards. Getting this wrong is the
 * classic way a poker engine loses chips, which is why the soak test asserts
 * conservation rather than trusting it.
 */

import { CHIP_INCREMENT } from '../bnotw'
import type { HandState, Pot } from '../types'
import { handPlayers, seatsAfter } from './state'

/** Split the money into a main pot and any side pots. */
export function buildPots(state: HandState): Pot[] {
  const players = handPlayers(state).filter((p) => p.committedHand > 0)
  if (players.length === 0) return []

  const levels = [...new Set(players.map((p) => p.committedHand))].sort((a, b) => a - b)
  const pots: Pot[] = []
  let previous = 0

  for (const level of levels) {
    let amount = 0
    for (const p of players) {
      amount += Math.min(p.committedHand, level) - Math.min(p.committedHand, previous)
    }
    const eligible = players.filter((p) => !p.folded && p.committedHand >= level).map((p) => p.seat)
    previous = level
    if (amount === 0) continue

    const last = pots[pots.length - 1]
    // Fold dead levels and identical-eligibility levels into the pot below them.
    if (last && (eligible.length === 0 || sameSeats(last.eligible, eligible))) {
      last.amount += amount
    } else {
      pots.push({ amount, eligible, label: '' })
    }
  }

  pots.forEach((pot, i) => {
    pot.label = i === 0 ? 'Main pot' : `Side pot ${i}`
  })
  return pots
}

function sameSeats(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

/**
 * Hand an awarded pot to its winners, odd chip included.
 *
 * Winners are ordered clockwise from the button so the indivisible chip goes
 * to the first of them on the button's left, which is how it is done live.
 */
export function splitPot(state: HandState, amount: number, winners: number[]): [number, number][] {
  if (winners.length === 1) return [[winners[0], amount]]

  const units = Math.floor(amount / CHIP_INCREMENT)
  const each = Math.floor(units / winners.length) * CHIP_INCREMENT
  let remainder = amount - each * winners.length

  // Order winners clockwise from the button so the odd chip goes to the
  // first of them to the button's left, as in a live game.
  const clockwise = seatsAfter(state, state.buttonSeat).filter((s) => winners.includes(s))
  const result: [number, number][] = clockwise.map((seat) => [seat, each])

  let i = 0
  while (remainder > 0) {
    const step = Math.min(CHIP_INCREMENT, remainder)
    result[i % result.length][1] += step
    remainder -= step
    i++
  }
  return result
}
