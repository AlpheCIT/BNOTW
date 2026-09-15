/**
 * Moving the hand along: burn, deal, and decide whether anyone may bet.
 *
 * Deliberately knows nothing about what a particular flop *means* to this
 * table. A monotone flop setting up the next bomb pot is a BNOTW rule, and it
 * lives in `rules/bombPot.ts` where `hand.ts` applies it after the street is
 * dealt — so the order of a hand of poker and the house's reaction to it are
 * two separate things that can change independently.
 */

import { cardCode, type Shoe } from '../cards'
import type { HandState, Street } from '../types'
import { contenders, handPlayers, livePlayers, log } from './state'
import { openBettingRound } from './betting'

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown']

export function isRunout(state: HandState): boolean {
  return livePlayers(state).length > 1 && contenders(state).length <= 1
}

/**
 * Deal the next street (or move to showdown). Call this when `phase === 'street'`.
 * Returns the street that was dealt, or 'showdown'.
 */
export function advanceStreet(state: HandState, shoe: Shoe): Street {
  if (state.phase !== 'street') throw new Error(`Cannot advance during phase "${state.phase}"`)

  if (livePlayers(state).length <= 1) {
    state.street = 'showdown'
    state.phase = 'showdown'
    return 'showdown'
  }

  const next = STREET_ORDER[STREET_ORDER.indexOf(state.street) + 1]
  state.street = next

  if (next === 'showdown') {
    state.phase = 'showdown'
    return next
  }

  shoe.draw() // burn card
  if (next === 'flop') {
    state.board = shoe.drawMany(3)
    log(state, `Flop: ${state.board.map(cardCode).join(' ')}`)
  } else {
    state.board.push(shoe.draw())
    log(state, `${next === 'turn' ? 'Turn' : 'River'}: ${cardCode(state.board[state.board.length - 1])}`)
  }

  if (isRunout(state)) {
    // Nobody can bet; keep dealing until the board is out.
    state.phase = 'street'
    for (const p of handPlayers(state)) p.lastAction = null
  } else {
    openBettingRound(state)
  }
  return next
}
