/**
 * Who wins, and what they are handed.
 *
 * Pure poker: the best five cards take each pot they were eligible for, chops
 * split down to the chip. The Dexter bounty is not here — it is a BNOTW rule
 * that rides on top of a settled hand, so it lives in `rules/dexter.ts` and
 * `hand.ts` applies it after the pots are awarded. Sequencing it that way also
 * means the bounty can never change who won.
 */

import { describeHand, evaluate, type HandValue } from '../handEval'
import { money } from '../bnotw'
import type { HandState, PotAward, Seat } from '../types'
import { livePlayers, log, name } from './state'
import { buildPots, splitPot } from './pots'

/** Best hand for a seat given the current board. */
export function bestHand(state: HandState, seat: number): HandValue | null {
  const p = state.players[seat]
  const cards = [...p.hole, ...state.board]
  if (cards.length < 5) return null
  return evaluate(cards)
}

export function awardPots(state: HandState, seats: Seat[]): void {
  state.pots = buildPots(state)
  const live = livePlayers(state)
  const awards: PotAward[] = []

  // Reveal rules: at a real showdown everyone still in turns their hand over.
  const isShowdown = live.length > 1
  if (isShowdown) for (const p of live) p.revealed = true

  for (const [index, pot] of state.pots.entries()) {
    const eligible = pot.eligible.filter((seat) => !state.players[seat].folded)
    if (eligible.length === 0) continue

    let winners: number[]
    let handValue: HandValue | null = null

    if (eligible.length === 1) {
      winners = eligible
      handValue = bestHand(state, eligible[0])
    } else {
      const scored = eligible.map((seat) => ({ seat, value: bestHand(state, seat)! }))
      const best = Math.max(...scored.map((s) => s.value.score))
      winners = scored.filter((s) => s.value.score === best).map((s) => s.seat)
      handValue = scored.find((s) => s.value.score === best)!.value
    }

    for (const [seat, amount] of splitPot(state, pot.amount, winners)) {
      seats[seat].stack += amount
      awards.push({
        potIndex: index,
        potLabel: pot.label,
        seat,
        amount,
        hand: winners.length > 1 || isShowdown ? handValue : null,
        split: winners.length > 1,
      })
    }
  }

  state.awards = awards

  for (const award of awards) {
    const who = name(seats, award.seat)
    const suffix = award.hand && (isShowdown || award.split)
      ? ` with ${describeHand(award.hand)}`
      : ''
    log(
      state,
      `${who} wins ${money(award.amount)}${state.pots.length > 1 ? ` (${award.potLabel})` : ''}${suffix}`,
      'win',
    )
  }

  // The hand is over as far as poker is concerned. Anything the house wants
  // to do on top of that — a bounty, a running tally — happens afterwards, so
  // it can never change who won.
  state.phase = 'showdown'
  state.complete = true
}
