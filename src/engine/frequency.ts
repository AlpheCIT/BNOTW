/**
 * What the price demands of you, whatever your cards are.
 *
 * Every other number the coach shows is about *this* hand: your equity, your
 * outs, what you have made. These are about your whole range, and they are the
 * closest thing in the app to what people mean by GTO — not because a solver
 * produced them, but because they fall out of the arithmetic of a bet with no
 * assumptions about anybody's cards at all.
 *
 * Two questions, one for each side of a bet:
 *
 * - **Facing one.** If you fold too often, a bluff wins immediately often
 *   enough to print money with any two cards. `alpha` is how often is too
 *   often; `defenceFrequency` is the share of your range that has to continue
 *   to take that away.
 * - **Making one.** A bet of a given size gives the caller a price, and that
 *   price is exactly how many bluffs the bet can carry before calling becomes
 *   free money. `bluffShare` and `valuePerBluff` are that ratio.
 *
 * ### What these are not
 *
 * They are a floor, not a target, and the difference is the whole lesson for a
 * home game. Defending exactly the minimum is right against somebody who
 * bluffs enough to punish you for folding more. Against somebody who never
 * bluffs, folding far more than the floor is the *profitable* mistake, and the
 * floor is actively bad advice. `defenceAdvice` is where that judgement lives,
 * and it is labelled as judgement.
 *
 * The bluff ratios are exact on the river and a guide before it. Earlier, a
 * bluff is not a pure bluff — it can improve — and there are streets still to
 * come, so the honest ratio is wider than the arithmetic here gives. The
 * report says which street it is talking about rather than pretending the
 * distinction away.
 *
 * All amounts are integer cents, like everywhere else in the engine.
 */

import type { Street } from './types'

/**
 * How often the aggressor needs everyone to fold for a pure bluff to break
 * even, given what they risked and what was in the middle before they did.
 *
 * Risking `r` to win `p`: the bluff makes `p` when it works and loses `r` when
 * it does not, so it breaks even at `r / (p + r)`.
 *
 * Returns 0 when there is nothing at risk, which is the honest answer: a check
 * cannot be a bluff that needs folds.
 */
export function alpha(potBefore: number, risk: number): number {
  if (risk <= 0) return 0
  const total = potBefore + risk
  if (total <= 0) return 0
  return Math.min(1, risk / total)
}

/**
 * The share of your range that has to keep playing — the minimum defence
 * frequency. The complement of `alpha`, and nothing more than that.
 */
export function defenceFrequency(potBefore: number, risk: number): number {
  if (risk <= 0) return 1
  return 1 - alpha(potBefore, risk)
}

/**
 * The same floor when more than one player can do the defending.
 *
 * A bluff only wins immediately if *everybody* folds, so with `defenders`
 * players each folding independently at rate `f`, it gets there `f ** n` of
 * the time. Setting that equal to `alpha` and solving gives each player's
 * share — which is less than the heads-up number, and should be: the load is
 * shared, and a player who defends the full heads-up figure three-handed is
 * defending far too wide.
 *
 * Exact, but it assumes the defenders are interchangeable. They are not: the
 * one closing the action can defend wider than the one with two players still
 * behind. Treat it as the shape of the adjustment rather than the number.
 */
export function defenceShare(potBefore: number, risk: number, defenders: number): number {
  const n = Math.max(1, Math.floor(defenders))
  if (n === 1) return defenceFrequency(potBefore, risk)
  const a = alpha(potBefore, risk)
  if (a <= 0) return 1
  return 1 - a ** (1 / n)
}

/**
 * The share of a betting range that can be bluffs while a call still breaks
 * even — so the caller is indifferent and cannot exploit you either way.
 *
 * A caller putting in `b` to win `p + b` needs `b / (p + 2b)`, and that same
 * fraction is how much of the betting range can be air.
 */
export function bluffShare(potBefore: number, bet: number): number {
  if (bet <= 0) return 0
  const denominator = potBefore + 2 * bet
  if (denominator <= 0) return 0
  return Math.min(1, bet / denominator)
}

/**
 * Value hands per bluff at this size — 2 means "two value bets for every
 * bluff". Infinity when nothing is being bet, since a check carries no bluffs.
 */
export function valuePerBluff(potBefore: number, bet: number): number {
  const share = bluffShare(potBefore, bet)
  if (share <= 0) return Infinity
  return (1 - share) / share
}

/** Facing a bet: the floor, and how much of it is yours to hold. */
export interface DefenceReport {
  /** The pot as it stood before they bet or raised. */
  potBefore: number
  /** What they put at risk to do it — the bet, or the raise on top. */
  risk: number
  /** How often they need you to fold for a bluff to break even. */
  alpha: number
  /** The share of your range that has to continue, heads-up. */
  defence: number
  /** How many players can share the defending. */
  defenders: number
  /** Your share of it, once the load is split. */
  share: number
}

export function defenceReport(
  potBefore: number,
  risk: number,
  defenders = 1,
): DefenceReport {
  return {
    potBefore,
    risk,
    alpha: alpha(potBefore, risk),
    defence: defenceFrequency(potBefore, risk),
    defenders: Math.max(1, Math.floor(defenders)),
    share: defenceShare(potBefore, risk, defenders),
  }
}

/** Betting yourself: how much air this size can carry. */
export interface BluffReport {
  potBefore: number
  bet: number
  /** Share of the betting range that can be bluffs. */
  bluffs: number
  /** Value hands per bluff. */
  perBluff: number
  /** Exact on the river; a floor before it, because a bluff can still improve. */
  exact: boolean
}

export function bluffReport(potBefore: number, bet: number, street: Street): BluffReport {
  return {
    potBefore,
    bet,
    bluffs: bluffShare(potBefore, bet),
    perBluff: valuePerBluff(potBefore, bet),
    exact: street === 'river',
  }
}

/**
 * Whether the floor is worth respecting against *this* player.
 *
 * The arithmetic above is exact and says nothing about anybody. The floor only
 * costs you something when the player betting into you actually bluffs — take
 * it literally against somebody who never does and you will call off a stack
 * being theoretically sound.
 *
 * So this is the one part of the module that is judgement rather than
 * arithmetic, and it is kept separate for that reason. The only evidence
 * available is how often they have taken the aggressive option when they had
 * one, which is not a bluffing frequency and must not be dressed up as one: a
 * player can bet often and always have it. It is a signal about the shape of
 * their betting range and nothing more.
 */
export type DefenceVerdict = 'unknown' | 'binds' | 'overfolds-fine'

/**
 * How much evidence before saying anything at all. Judgement, chosen to match
 * `reads.READ_CONFIDENCE_AT` rather than fitted to anything.
 */
export const VERDICT_CONFIDENCE = 0.5

/**
 * Aggression below this counts as somebody whose bets mean what they say.
 * `reads.NEUTRAL_AGGRESSION` is 0.3, and this sits meaningfully under it so
 * that an ordinary player does not read as a nit. Judgement, not measurement.
 */
export const PASSIVE_AGGRESSION = 0.18

export function defenceAdvice(read: { aggression: number; confidence: number }): DefenceVerdict {
  if (read.confidence < VERDICT_CONFIDENCE) return 'unknown'
  return read.aggression < PASSIVE_AGGRESSION ? 'overfolds-fine' : 'binds'
}
