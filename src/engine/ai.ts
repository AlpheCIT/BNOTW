/**
 * Computer opponents.
 *
 * Post-flop decisions come from a Monte Carlo equity estimate: deal the rest
 * of the board and random hands to the opponents a few hundred times and see
 * how often this hand wins. Pre-flop uses a Chen-style strength score, which
 * is far better than simulating against random hands that early.
 *
 * Each bot has a style that shifts how much equity it needs to continue and
 * how often it fires without a hand.
 */

import type { Card, Rank, Rng } from './cards'
import { makeDeck } from './cards'
import { evaluate } from './handEval'
import { BIG_BLIND, CHIP_INCREMENT, NAMED_BETS, toChipIncrement } from './bnotw'
import { legalActions, potTotal, livePlayers, type LegalActions } from './hand'
import type { Action, BotStyle, HandState, Seat } from './types'

interface StyleProfile {
  /** Multiplier on the equity a bot needs before it will call. */
  callTightness: number
  /** How often it bets or raises when it has the goods. */
  aggression: number
  /** How often it fires with nothing. */
  bluff: number
  /** Pre-flop Chen score needed to enter an unraised pot. */
  openThreshold: number
}

const STYLES: Record<BotStyle, StyleProfile> = {
  rock: { callTightness: 1.25, aggression: 0.45, bluff: 0.04, openThreshold: 9 },
  grinder: { callTightness: 1.1, aggression: 0.6, bluff: 0.1, openThreshold: 7.5 },
  regular: { callTightness: 1.0, aggression: 0.7, bluff: 0.15, openThreshold: 6.5 },
  loose: { callTightness: 0.85, aggression: 0.75, bluff: 0.22, openThreshold: 4.5 },
  maniac: { callTightness: 0.7, aggression: 0.9, bluff: 0.38, openThreshold: 2.5 },
}

/**
 * Chen formula: a well-known pre-flop starting-hand score. Higher is better;
 * roughly -1.5 (7-2 offsuit) up to 20 (pocket aces).
 */
export function chenScore(hole: Card[]): number {
  if (hole.length < 2) return 0
  // With three cards (Crazy Pineapple) score the best pair of them.
  if (hole.length > 2) {
    let best = -Infinity
    for (let i = 0; i < hole.length; i++)
      for (let j = i + 1; j < hole.length; j++)
        best = Math.max(best, chenScore([hole[i], hole[j]]))
    return best
  }

  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank)
  const points = (r: Rank) =>
    r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2

  let score = points(high.rank)
  if (high.rank === low.rank) {
    score = Math.max(5, score * 2) // pairs
  } else {
    if (high.suit === low.suit) score += 2
    const gap = high.rank - low.rank - 1
    score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5
    // Both cards below a Q and no more than one gap: straight bonus.
    if (gap <= 1 && high.rank < 12) score += 1
  }
  return Math.ceil(score)
}

/**
 * Win probability estimate for `hole` against `opponents` random hands on the
 * current board. Chops count as a fractional win.
 */
export function equity(
  hole: Card[],
  board: Card[],
  opponents: number,
  trials: number,
  rng: Rng,
): number {
  if (opponents < 1) return 1
  const known = new Set([...hole, ...board].map((c) => `${c.rank}${c.suit}`))
  const stub = makeDeck().filter((c) => !known.has(`${c.rank}${c.suit}`))
  const needBoard = 5 - board.length
  const needed = needBoard + opponents * 2
  if (stub.length < needed) return 0.5

  let score = 0
  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates: only shuffle as many cards as the trial consumes.
    for (let i = 0; i < needed; i++) {
      const j = i + Math.floor(rng() * (stub.length - i))
      ;[stub[i], stub[j]] = [stub[j], stub[i]]
    }
    const fullBoard = [...board, ...stub.slice(0, needBoard)]
    const mine = evaluate([...hole, ...fullBoard]).score

    let better = 0
    let ties = 0
    for (let o = 0; o < opponents; o++) {
      const offset = needBoard + o * 2
      const theirs = evaluate([stub[offset], stub[offset + 1], ...fullBoard]).score
      if (theirs > mine) { better++; break }
      if (theirs === mine) ties++
    }
    if (better === 0) score += ties === 0 ? 1 : 1 / (ties + 1)
  }
  return score / trials
}

/** Pull a bet toward a Bob-aloo or Dave-aloo when it lands close by. */
function snapToNamedBet(amount: number, legal: LegalActions, rng: Rng): number {
  if (rng() > 0.35) return amount
  for (const bet of NAMED_BETS) {
    const target = bet.amount
    if (target < legal.minRaiseTo || target > legal.maxRaiseTo) continue
    if (Math.abs(target - amount) <= amount * 0.35) return target
  }
  return amount
}

function clampRaise(amount: number, legal: LegalActions): number {
  const rounded = Math.max(CHIP_INCREMENT, toChipIncrement(amount))
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, rounded))
}

export interface BotContext {
  state: HandState
  seats: Seat[]
  seat: number
  rng: Rng
  /** Simulation count; lower it to keep the UI snappy on phones. */
  trials?: number
}

export function decideAction({ state, seats, seat, rng, trials = 220 }: BotContext): Action {
  const legal = legalActions(state, seats, seat)
  const p = state.players[seat]
  const style = STYLES[seats[seat].style] ?? STYLES.regular
  const pot = potTotal(state)

  if (state.board.length === 0) return preflopDecision(state, legal, style, pot, p.hole, rng)

  const opponents = Math.max(1, livePlayers(state).length - 1)
  const stack = seats[seat].stack
  const toCall = legal.callAmount
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
  const raw = equity(p.hole, state.board, opponents, trials, rng)

  // The simulation deals opponents *random* hands, but a player who is still
  // putting money in has better than a random hand. Discount the estimate
  // before pricing a call, or the bots call down with anything.
  const strength = toCall > 0 ? raw * RANGE_DISCOUNT : raw

  // --- nothing to call: check, or take a stab at it ------------------------
  if (legal.canCheck) {
    const valueBar = 0.55 + 0.05 * Math.min(opponents, 4)
    const wantsToBet =
      (strength > valueBar && rng() < style.aggression) ||
      (strength < 0.3 && rng() < style.bluff)
    if (!wantsToBet || !legal.canBet) return { kind: 'check' }

    const fraction = strength > 0.8 ? 0.7 : strength > 0.6 ? 0.55 : 0.4
    const base = Math.max(BIG_BLIND, pot * fraction)
    return { kind: 'bet', amount: sizeBet(base, strength, stack, legal, rng) }
  }

  // --- facing a bet --------------------------------------------------------
  // Putting a big share of the stack at risk needs a hand, not just pot odds.
  const stackRisk = toCall / Math.max(1, toCall + stack)
  const priced = strength >= potOdds * style.callTightness
  const worthTheStack = stackRisk < 0.4 || strength > 0.62 + stackRisk * 0.2

  if (!priced || !worthTheStack) {
    // Occasionally bluff-raise instead of folding, but never for the stack.
    if (legal.canRaise && rng() < style.bluff * 0.4 && toCall < pot * 0.7) {
      const amount = clampRaise(state.currentBet + Math.max(BIG_BLIND, pot * 0.6), legal)
      if (amount < legal.maxRaiseTo) {
        return { kind: 'raise', amount: snapToNamedBet(amount, legal, rng) }
      }
    }
    return { kind: 'fold' }
  }

  // Re-raising a big bet takes a genuinely big hand, not merely a good one;
  // without this the table just shoves every pot.
  const facingBigBet = toCall > pot * 0.6
  const raiseBar = facingBigBet ? 0.82 : 0.66 + (1 - style.aggression) * 0.1
  if (strength > raiseBar && legal.canRaise && rng() < style.aggression) {
    const fraction = strength > 0.88 ? 1.0 : 0.6
    const amount = state.currentBet + Math.max(BIG_BLIND, pot * fraction)
    return { kind: 'raise', amount: sizeBet(amount, strength, stack, legal, rng) }
  }

  return { kind: 'call' }
}

/**
 * How much a Monte Carlo estimate against random hands is shaded down once
 * somebody has bet into us. Tuned so the table plays loose-but-sane rather
 * than getting it all in every hand.
 */
const RANGE_DISCOUNT = 0.72

/** Round a bet to chips, and keep a deep stack off the table without a hand. */
function sizeBet(
  target: number,
  strength: number,
  stack: number,
  legal: LegalActions,
  rng: Rng,
): number {
  const share = strength > 0.9 ? 1 : strength > 0.78 ? 0.5 : 0.3
  const cap = legal.maxRaiseTo - stack * (1 - share)
  return snapToNamedBet(clampRaise(Math.min(target, cap), legal), legal, rng)
}

/**
 * Pre-flop play is priced in big blinds rather than pot odds: the Chen score a
 * bot needs climbs with the size of the bet in front of it, so a table full of
 * bots does not get all the money in with a middling hand every hand.
 */
function preflopDecision(
  state: HandState,
  legal: LegalActions,
  style: StyleProfile,
  pot: number,
  hole: Card[],
  rng: Rng,
): Action {
  const chen = chenScore(hole)
  // A straddle raises the price of the hand for everybody, so measure the bet
  // against the largest forced blind rather than always against the big blind.
  const forced = Math.max(BIG_BLIND, ...state.straddles.map((s) => s.amount))
  const units = Math.max(1, state.currentBet / forced)
  const need = style.openThreshold + Math.log2(units) * 3

  if (legal.canCheck) {
    // In the blind with nothing to call: raise with a real hand, else see a flop.
    const wantsToRaise = chen >= need + 4 && rng() < style.aggression
    if (!wantsToRaise || !legal.canBet && !legal.canRaise) return { kind: 'check' }
    const amount = clampRaise(state.currentBet + Math.max(BIG_BLIND, pot * 0.75), legal)
    return { kind: legal.canBet ? 'bet' : 'raise', amount: snapToNamedBet(amount, legal, rng) }
  }

  if (chen < need) {
    if (legal.canRaise && rng() < style.bluff * 0.25 && units < 2) {
      const amount = clampRaise(state.currentBet * 3, legal)
      if (amount < legal.maxRaiseTo) return { kind: 'raise', amount }
    }
    return { kind: 'fold' }
  }

  if (chen >= need + 5 && legal.canRaise && rng() < style.aggression) {
    const amount = clampRaise(state.currentBet * 3 + pot * 0.25, legal)
    return { kind: 'raise', amount: snapToNamedBet(amount, legal, rng) }
  }

  return { kind: 'call' }
}

/** Crazy Pineapple: pitch whichever card leaves the strongest two. */
export function decideDiscard(state: HandState, seat: number, rng: Rng): number {
  const hole = state.players[seat].hole
  let bestIndex = 0
  let bestScore = -Infinity
  for (let i = 0; i < hole.length; i++) {
    const kept = hole.filter((_, j) => j !== i)
    const score = equity(kept, state.board, 2, 90, rng)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }
  return bestIndex
}
