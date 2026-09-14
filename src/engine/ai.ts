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
import { NEUTRAL_AGGRESSION, readForMany, type Reads } from './reads'
import type { Persona } from './persona'
import type { Action, HandState, Seat } from './types'

/** How a persona's skill and tendencies come out as numbers the bot uses. */
export interface BotProfile {
  /** Chen score needed to enter an unopened pot. */
  openThreshold: number
  /** 0..1 — how often they bet or raise when they like their hand. */
  aggression: number
  /** 0..1 — how often they fire with nothing. */
  bluff: number
  /** Multiplier on pot odds before calling; below 1 means chasing. */
  callTightness: number
  /** 0..1 — willingness to put the stack in. */
  gamble: number
  /** Monte Carlo trials; better players get a sharper read. */
  trials: number
  /** 0..1 — how much they adjust to the opponents in front of them. */
  adapt: number
  /** How far their read of their own hand wobbles, either way. */
  noise: number
  /** How far they overrate their own hand. This is the expensive one. */
  optimism: number
  /** 0..1 — the share of the field they actually account for. */
  fieldAwareness: number
  /** 0..1 — how much they adjust for position. */
  positionAware: number
}

/**
 * The skill ladder, indexed 0-4 for skill 1-5. Exported and mutable so the
 * calibration probe can re-measure the table with different values.
 */
export const TRIALS_BY_SKILL = [60, 110, 180, 260, 340]
export const NOISE_BY_SKILL = [0.08, 0.06, 0.04, 0.025, 0.012]
/**
 * Calibrated by duplicate-scored self-play rather than guessed. Below about
 * 0.2 the bias is too small to move money at any sample size worth running;
 * most of the damage sits at the bottom of the ladder, which is also how it
 * works in life — the gap between a novice and an average player is far wider
 * than the gap between average and expert.
 */
export const OPTIMISM_BY_SKILL = [0.3, 0.18, 0.09, 0.03, 0]
export const FIELD_BY_SKILL = [0.35, 0.5, 0.7, 0.9, 1]
export const POSITION_BY_SKILL = [0, 0.25, 0.5, 0.8, 1]

/**
 * How much a profile adjusts to who it is playing.
 *
 * Deliberately zero below skill 3 and steep above it. Reading opponents is the
 * last thing a player learns and the thing the top of the ladder had nothing
 * of: without it, skills 3, 4 and 5 all play the same fixed strategy slightly
 * more accurately, which is why 5 could not measurably beat 3.
 */
export const ADAPT_BY_SKILL = [0, 0, 0.15, 0.6, 1]

/**
 * Skill controls *accuracy*, tendencies control *taste*.
 *
 * Crucially, a weak player is not a player who decides at random — noise that
 * cuts both ways mostly cancels out and costs almost nothing. A weak player is
 * one whose errors point the same way every time: they overrate their own hand,
 * and they price a six-way pot as though only one or two opponents could beat
 * them. Those two biases are what actually moves money across the table.
 */
export function profileOf(persona: Persona): BotProfile {
  const { looseness, aggression, bluffing, chasing, gamble } = persona.tendencies
  const i = Math.max(0, Math.min(4, persona.skill - 1))
  return {
    openThreshold: 13 - (looseness / 100) * 12,
    aggression: 0.15 + (aggression / 100) * 0.8,
    bluff: (bluffing / 100) * 0.5,
    callTightness: 1.35 - (chasing / 100) * 0.8,
    gamble: gamble / 100,
    trials: TRIALS_BY_SKILL[i],
    noise: NOISE_BY_SKILL[i],
    optimism: OPTIMISM_BY_SKILL[i],
    fieldAwareness: FIELD_BY_SKILL[i],
    positionAware: POSITION_BY_SKILL[i],
    adapt: ADAPT_BY_SKILL[i],
  }
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
  /** Override the persona's simulation count, e.g. to keep phones snappy. */
  trials?: number
  /**
   * What has been seen of the other seats this session. Absent means nobody
   * has been watching, and every profile falls back to its fixed strategy.
   */
  reads?: Reads
}

/** Where a seat sits relative to the button: 0 is first to act, 1 is the button. */
function positionFactor(state: HandState, seat: number): number {
  const i = state.order.indexOf(seat)
  if (i < 0 || state.order.length < 2) return 0.5
  return i / (state.order.length - 1)
}

/** Shift a read by this player's wobble and their standing optimism. */
function misread(value: number, style: BotProfile, rng: Rng): number {
  const shifted = value + (rng() * 2 - 1) * style.noise + style.optimism
  return Math.max(0.01, Math.min(0.99, shifted))
}

export function decideAction({ state, seats, seat, rng, trials, reads }: BotContext): Action {
  const legal = legalActions(state, seats, seat)
  const p = state.players[seat]
  const style = profileOf(seats[seat].persona)
  const pot = potTotal(state)

  if (state.board.length === 0) {
    return preflopDecision(state, legal, style, pot, p.hole, positionFactor(state, seat), rng)
  }

  const opponents = Math.max(1, livePlayers(state).length - 1)
  // A beginner plays a six-way pot as though it were three-handed.
  const perceived = Math.max(1, Math.round(opponents * style.fieldAwareness))

  /**
   * What the players still in this pot have shown, weighted by how much of
   * that has actually been seen. `station` is positive against somebody who
   * folds less than usual and negative against somebody who folds more, and
   * `adapt` is what lets a profile act on it at all.
   */
  const read = readForMany(reads, livePlayers(state).map((p) => p.seat).filter((s) => s !== seat))
  const tell = read.station * style.adapt
  const stack = seats[seat].stack
  const toCall = legal.callAmount
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
  const raw = equity(p.hole, state.board, perceived, trials ?? style.trials, rng)

  // The simulation deals opponents *random* hands, but a player who is still
  // putting money in has better than a random hand. Discount the estimate
  // before pricing a call, or the bots call down with anything.
  const discounted = toCall > 0 ? raw * RANGE_DISCOUNT : raw
  const strength = misread(discounted, style, rng)
  // Optimism is what makes a weak player pay you off street by street, but
  // even a beginner thinks twice about their whole stack. The gate below uses
  // the un-inflated read so bad players bleed chips rather than shovelling
  // them in, which is both truer to life and less chaotic at the table.
  const sober = Math.max(0.01, Math.min(0.99, discounted + (rng() * 2 - 1) * style.noise))

  // --- nothing to call: check, or take a stab at it ------------------------
  if (legal.canCheck) {
    // Against players who do not fold, value-bet thinner: hands that are not
    // worth a bet against someone who folds correctly are worth one against
    // someone who calls anyway. Against a table that folds too much, tighten
    // up and take the pot with a bluff instead.
    const valueBar = 0.55 + 0.05 * Math.min(perceived, 4) - tell * 0.12
    // The same read read the other way: bluffing into somebody who never folds
    // is the purest way there is to lose money.
    const bluffChance = Math.max(0, style.bluff * (1 - tell))
    const wantsToBet =
      (strength > valueBar && rng() < style.aggression) ||
      (strength < 0.3 && rng() < bluffChance)
    if (!wantsToBet || !legal.canBet) return { kind: 'check' }

    const fraction = strength > 0.8 ? 0.7 : strength > 0.6 ? 0.55 : 0.4
    const base = Math.max(BIG_BLIND, pot * fraction)
    return { kind: 'bet', amount: sizeBet(base, strength, stack, style.gamble, legal, rng) }
  }

  // --- facing a bet --------------------------------------------------------
  // Putting a big share of the stack at risk needs a hand, not just pot odds.
  const stackRisk = toCall / Math.max(1, toCall + stack)
  // Somebody who bets at every pot is betting with less, so their bet is worth
  // calling wider. Somebody who rarely bets means it when they do.
  const betsTooMuch = (read.aggression - NEUTRAL_AGGRESSION) / NEUTRAL_AGGRESSION
  const tightness = style.callTightness
    * (1 - Math.max(-1, Math.min(1, betsTooMuch)) * read.confidence * style.adapt * 0.2)
  const priced = strength >= potOdds * tightness
  const stackBar = (0.62 + stackRisk * 0.2) * (1 - style.gamble * 0.4)
  const worthTheStack = stackRisk < 0.4 || sober > stackBar

  if (!priced || !worthTheStack) {
    // Occasionally bluff-raise instead of folding, but never for the stack.
    if (legal.canRaise && rng() < Math.max(0, style.bluff * (1 - tell)) * 0.4 && toCall < pot * 0.7) {
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
    return { kind: 'raise', amount: sizeBet(amount, sober, stack, style.gamble, legal, rng) }
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
  gamble: number,
  legal: LegalActions,
  rng: Rng,
): number {
  const base = strength > 0.9 ? 1 : strength > 0.78 ? 0.5 : 0.3
  const share = base + (1 - base) * gamble * 0.6
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
  style: BotProfile,
  pot: number,
  hole: Card[],
  position: number,
  rng: Rng,
): Action {
  // A weak player overrates a starting hand just as they overrate a flop.
  const chen = chenScore(hole) + style.optimism * 22 + (rng() * 2 - 1) * style.noise * 12
  // A straddle raises the price of the hand for everybody, so measure the bet
  // against the largest forced blind rather than always against the big blind.
  const forced = Math.max(BIG_BLIND, ...state.straddles.map((s) => s.amount))
  const units = Math.max(1, state.currentBet / forced)
  // Late position is worth playing wider; only players who notice get the edge.
  const positional = style.positionAware * (position - 0.5) * 3
  const need = style.openThreshold + Math.log2(units) * 3 - positional

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
