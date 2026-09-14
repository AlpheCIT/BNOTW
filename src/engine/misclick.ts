/**
 * Catching the taps you did not mean.
 *
 * Folding aces because your thumb landed a centimetre low is the single most
 * infuriating thing a poker app can do to you, and unlike a bad call it
 * teaches you nothing. The rule here is that a confirmation must be rare
 * enough to stay meaningful: one that fires on every fold is one you learn to
 * tap through, and then it protects nothing.
 *
 * So this only speaks up where the action is either strictly dominated or
 * expensive enough that a second of your time is cheap by comparison.
 */

import { money } from './bnotw'
import { describeStartingHand } from './coach'
import { bestHand, type LegalActions } from './hand'
import { HandCategory } from './handEval'
import type { Action, HandState, Seat } from './types'

/** Chen score at or above which folding pre-flop is worth a second look. */
export const STRONG_CHEN = 9

export interface Guard {
  /** The headline on the confirmation. */
  title: string
  /** Why this particular tap is being questioned. */
  detail: string
  /** What the confirm button says. */
  confirm: string
}

export interface GuardOptions {
  /** Off entirely, for anyone who finds it patronising. */
  enabled?: boolean
  /** Pre-flop Chen score that counts as too good to fold by accident. */
  strongChen?: number
}

/**
 * Whether this action deserves a second tap. Null means let it through.
 *
 * Takes the same arguments the action itself is applied with, so it can never
 * disagree with the engine about what is legal.
 */
export function guardFor(
  hand: HandState,
  seats: Seat[],
  seat: number,
  action: Action,
  legal: LegalActions,
  options: GuardOptions = {},
): Guard | null {
  if (options.enabled === false) return null
  const player = hand.players[seat]
  if (!player) return null

  if (action.kind === 'fold') {
    // Nothing here about folding when checking is free: `legalActions` sets
    // canFold and canCheck from the same `facingBet`, so they are mutually
    // exclusive and the engine has already made that impossible. A guard for
    // it would be dead code carrying a confident comment, which is worse than
    // no code at all.
    const strong = strongHolding(hand, seat, options.strongChen ?? STRONG_CHEN)
    if (strong) {
      return {
        title: `Fold ${strong}?`,
        detail: `Costs ${money(legal.callAmount)} to see it through.`,
        confirm: 'Fold anyway',
      }
    }
    return null
  }

  // Putting the last of your chips in is the other action you cannot take back.
  // `maxRaiseTo` is already what this seat would be at having shoved, so
  // reaching it is the definition of all-in and needs no arithmetic here.
  const allIn = action.kind === 'call'
    ? legal.callIsAllIn
    : (action.kind === 'bet' || action.kind === 'raise')
      && action.amount !== undefined
      && action.amount >= legal.maxRaiseTo

  if (allIn) {
    // The stack lives on the seat, not the hand: the hand only tracks what has
    // gone in so far.
    const behind = seats[seat]?.stack ?? 0
    return {
      title: 'All in?',
      detail: behind > 0
        ? `That is your whole stack — ${money(behind)} behind.`
        : 'That is your whole stack.',
      confirm: 'All in',
    }
  }

  return null
}

/**
 * A holding good enough that folding it by accident would sting, described in
 * the words the confirmation should use. Null when there is nothing to protect.
 */
function strongHolding(hand: HandState, seat: number, strongChen: number): string | null {
  const player = hand.players[seat]
  if (hand.board.length === 0) {
    if (player.hole.length < 2) return null
    const starting = describeStartingHand(player.hole)
    return starting.chen >= strongChen ? starting.label : null
  }

  const made = bestHand(hand, seat)
  // Two pair is the line because one pair folds all the time and is no
  // surprise; two pair and up, a fold is either a read or a mistake.
  if (!made || made.category < HandCategory.TwoPair) return null
  return NAMES[made.category] ?? null
}

const NAMES: Partial<Record<HandCategory, string>> = {
  [HandCategory.TwoPair]: 'two pair',
  [HandCategory.Trips]: 'three of a kind',
  [HandCategory.Straight]: 'a straight',
  [HandCategory.Flush]: 'a flush',
  [HandCategory.FullHouse]: 'a full house',
  [HandCategory.Quads]: 'four of a kind',
  [HandCategory.StraightFlush]: 'a straight flush',
}
