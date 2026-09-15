/**
 * How the hand would have finished, after you folded.
 *
 * You fold, the hand carries on, and as far as you are concerned it stops
 * existing. "Would I have hit that?" is one of the most natural questions a
 * learning player asks and nothing in the app answered it.
 *
 * ### Why this is dangerous, and what is done about it
 *
 * Showing near-misses is how you train results-oriented thinking, which is
 * precisely the habit the rating was built to avoid. Folding a hand that would
 * have won is usually still the right fold. So everything here is written to
 * be *checkable* rather than encouraging:
 *
 * - It reports what your hand would have **been**, not what you would have
 *   **won**. The two are different and the difference is the whole lesson.
 * - It carries the equity you had at the moment you folded, so the one runout
 *   always appears next to the probability it came from.
 * - `wouldHaveWon` means "held the best hand at the river", never "would have
 *   taken the pot". Taking the pot requires the betting to have gone the same
 *   way, and it would not have: with you still in, the others face different
 *   prices and different players, and some of the folds that happened would
 *   not have happened. That caveat is not a footnote, it is the reason this
 *   number is named the way it is.
 *
 * ### What it cannot do
 *
 * If the hand ended before the river there is no runout to show, and inventing
 * one would be worse than showing nothing — it would be a different hand.
 * Those cases return `unknown` with the reason, and the UI says so.
 *
 * ### One thing it deliberately does not handle
 *
 * There is no "you never pitched a card" case for Crazy Pineapple, and there
 * should not be. The discard phase blocks acting entirely — `applyAction`
 * throws during it and `pendingDiscards` has to empty before betting opens —
 * so a folded player has always already discarded and holds exactly two cards.
 * A guess at which card you would have kept was written here first, and it was
 * dead code dressed up as care. Checked by test, so if the engine ever lets a
 * three-card holding reach a fold, that test fails rather than this quietly
 * scoring the best of three.
 *
 * Coach mode only, for the same reason X-ray is: at a real table you do not
 * get to see this.
 */

import { cardCode, type Card } from './cards'
import { describeHand, evaluate } from './handEval'
import { livePlayers } from './hand'
import type { HandState, Seat } from './types'

/** Why nothing can be shown. */
export type WhatIfUnknown =
  /** You did not fold — there is nothing counterfactual about it. */
  | 'still-in'
  /** The hand ended before five cards came out. */
  | 'no-river'
  /** Nobody was left to compare against. */
  | 'no-opponents'

export interface WhatIfHand {
  seat: number
  name: string
  hand: string
  /** Chips this seat won across every pot. */
  won: number
}

export interface WhatIf {
  /** The board that actually came, as card codes. */
  board: string
  /** Your cards, as they would have been at the river. */
  hole: string
  /** What you would have held. */
  madeLabel: string
  /**
   * You held the best hand at the river among the players still in.
   *
   * Not "you would have won the pot". See the note at the top of this file.
   */
  wouldHaveWon: boolean
  /** The best hand among the players still in, and whose it was. */
  best: WhatIfHand | null
  /** Everyone still in at the end, strongest first. */
  showdown: WhatIfHand[]
  /** What the pot was worth, in cents. */
  pot: number
}

export type WhatIfResult = WhatIf | { unknown: WhatIfUnknown }

/** True when the result is an answer rather than a reason there is none. */
export function isWhatIf(result: WhatIfResult | null): result is WhatIf {
  return result !== null && !('unknown' in result)
}

/** The strongest five-card hand a holding makes, given the board. */
function madeWith(hole: Card[], board: Card[]) {
  const cards = [...hole, ...board]
  if (cards.length < 5) return null
  return evaluate(cards)
}

/**
 * What would have happened, had you stayed.
 *
 * Call it on a finished hand. Returns a reason rather than an answer whenever
 * the honest answer is that there isn't one.
 */
export function whatIf(state: HandState, seats: Seat[], heroSeat: number): WhatIfResult {
  const hero = state.players[heroSeat]
  if (!hero || !hero.folded) return { unknown: 'still-in' }
  // Five cards or nothing. A flop is not a finished hand, and guessing the
  // turn and river would be answering a question nobody asked.
  if (state.board.length < 5) return { unknown: 'no-river' }

  const others = livePlayers(state).filter((p) => p.seat !== heroSeat)
  if (others.length === 0) return { unknown: 'no-opponents' }

  const heroValue = madeWith(hero.hole, state.board)
  if (!heroValue) return { unknown: 'no-river' }

  const won = (seat: number) =>
    state.awards.filter((a) => a.seat === seat).reduce((sum, a) => sum + a.amount, 0)
  const nameOf = (seat: number) => seats[seat]?.name ?? `Seat ${seat + 1}`

  const showdown: WhatIfHand[] = others
    .map((p) => ({ player: p, value: madeWith(p.hole, state.board) }))
    .filter((row): row is { player: typeof others[number]; value: NonNullable<ReturnType<typeof madeWith>> } => row.value !== null)
    .sort((a, b) => b.value.score - a.value.score)
    .map((row) => ({
      seat: row.player.seat,
      name: nameOf(row.player.seat),
      hand: describeHand(row.value),
      won: won(row.player.seat),
    }))

  const bestOther = others
    .map((p) => madeWith(p.hole, state.board))
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .reduce<number>((best, v) => Math.max(best, v.score), -1)

  return {
    board: state.board.map(cardCode).join(' '),
    hole: hero.hole.map(cardCode).join(' '),
    madeLabel: describeHand(heroValue),
    // Ties count as held-the-best: you would have chopped, not lost.
    wouldHaveWon: heroValue.score >= bestOther,
    best: showdown[0] ?? null,
    showdown,
    pot: state.awards.reduce((sum, a) => sum + a.amount, 0),
  }
}
