/**
 * Coach mode: work out what the right play is, and be able to explain why.
 *
 * Nothing here guesses. Every number is either counted exactly or simulated,
 * and every recommendation states the reasoning that produced it, so the point
 * is not to be told what to do — it is to see the arithmetic you should have
 * been doing yourself.
 */

import type { Card, Rank, Rng } from './cards'
import { makeDeck, rankLabel } from './cards'
import { CATEGORY_NAMES, describeHand, evaluate, HandCategory, type HandValue } from './handEval'
import { BIG_BLIND, money } from './bnotw'
import { chenScore } from './ai'
import { isLate, positionLabelFor, positionOf } from './position'
import { bestHand, legalActions, livePlayers, potTotal, type LegalActions } from './hand'
import { bluffReport, defenceReport, type BluffReport, type DefenceReport } from './frequency'
import { voice, type CoachVoice } from './voices'
import type { Action, ActionKind, HandState, Seat, Street } from './types'

// ---------------------------------------------------------------------------
// Equity
// ---------------------------------------------------------------------------

export interface EquityResult {
  /** Share of the pot this hand expects, counting a chop as a fraction. */
  equity: number
  win: number
  tie: number
  /** True when every runout was counted rather than sampled. */
  exact: boolean
  runouts: number
}

function key(card: Card): string {
  return `${card.rank}${card.suit}`
}

function unseenCards(known: Card[]): Card[] {
  const seen = new Set(known.map(key))
  return makeDeck().filter((c) => !seen.has(key(c)))
}

function* choose<T>(items: T[], k: number): Generator<T[]> {
  const n = items.length
  if (k === 0) { yield []; return }
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield idx.map((i) => items[i])
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

function countCombos(n: number, k: number): number {
  let out = 1
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1)
  return Math.round(out)
}

/**
 * Exact equity for a set of *known* hands — the number a broadcast puts on
 * screen once the cards are on their backs. Enumerates every runout when that
 * is cheap, and samples when it is not.
 */
export function showdownEquity(
  hands: Card[][],
  board: Card[],
  rng: Rng,
  sampleTrials = 4000,
): EquityResult[] {
  const need = 5 - board.length
  const stub = unseenCards([...board, ...hands.flat()])
  const results: EquityResult[] = hands.map(() => ({ equity: 0, win: 0, tie: 0, exact: true, runouts: 0 }))

  const combos = countCombos(stub.length, need)
  const enumerate = combos <= 6000

  const score = (runout: Card[]) => {
    const full = [...board, ...runout]
    const scores = hands.map((h) => evaluate([...h, ...full]).score)
    const best = Math.max(...scores)
    const winners = scores.filter((s) => s === best).length
    for (let i = 0; i < hands.length; i++) {
      if (scores[i] !== best) continue
      if (winners === 1) { results[i].win++; results[i].equity += 1 }
      else { results[i].tie++; results[i].equity += 1 / winners }
    }
  }

  let runouts = 0
  if (enumerate) {
    for (const runout of choose(stub, need)) { score(runout); runouts++ }
  } else {
    const pool = [...stub]
    for (let t = 0; t < sampleTrials; t++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rng() * (pool.length - i))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      score(pool.slice(0, need))
      runouts++
    }
  }

  for (const r of results) {
    r.equity /= runouts
    r.win /= runouts
    r.tie /= runouts
    r.exact = enumerate
    r.runouts = runouts
  }
  return results
}

/**
 * Equity for one hand against opponents whose cards are unknown.
 *
 * Opponents are dealt from a *range* rather than uniformly at random: a player
 * still putting money in does not hold a random two cards, and pricing a call
 * against random hands is the single most common way to talk yourself into a
 * bad call. `floors` is the weakest starting hand each opponent is credited
 * with, on the Chen scale — one number to apply to everyone, or one per
 * opponent.
 *
 * ### Why each opponent is sampled separately
 *
 * The obvious way to do this is to deal everyone at once and re-deal when
 * somebody falls short. That fails badly multiway, and silently. Measured over
 * all 1,326 starting combinations: a Chen floor of 6 accepts 25.5% of hands, so
 * five opponents clear it together 0.108% of the time, and six re-deals find a
 * legal set **0.6%** of the time. The other 99.4% of trials gave up and used a
 * random deal — so the number reported as "equity against a range" was, at a
 * full table, equity against random hands, which is the exact error the range
 * model exists to prevent.
 *
 * Sampling each opponent on its own turns that product back into a per-player
 * acceptance rate. To keep it exact rather than merely better, the legal pairs
 * are enumerated once per call and drawn from directly, so a hand that meets
 * the floor is found first time instead of stumbled upon.
 */
export function equityVsRange(
  hole: Card[],
  board: Card[],
  opponents: number,
  floors: number | number[],
  trials: number,
  rng: Rng,
): EquityResult {
  const stub = unseenCards([...hole, ...board])
  const need = 5 - board.length
  const draw = need + opponents * 2
  if (opponents < 1 || stub.length < draw) {
    return { equity: 1, win: 1, tie: 0, exact: false, runouts: 0 }
  }

  const perOpponent = Array.from(
    { length: opponents },
    (_, i) => (Array.isArray(floors) ? floors[i] ?? floors[floors.length - 1] ?? 0 : floors),
  )

  // Every pair of unseen cards, scored once. 1,081 of them at most, against
  // hundreds of trials each drawing several hands — cheap by comparison.
  const pairs: { a: number; b: number; chen: number }[] = []
  for (let a = 0; a < stub.length; a++) {
    for (let b = a + 1; b < stub.length; b++) {
      pairs.push({ a, b, chen: chenScore([stub[a], stub[b]]) })
    }
  }
  // One list of legal pairs per distinct floor, shared by opponents that agree.
  const legal = new Map<number, typeof pairs>()
  for (const floor of new Set(perOpponent)) {
    const allowed = floor > 0 ? pairs.filter((p) => p.chen >= floor) : pairs
    // A floor nothing can meet would leave nothing to draw from; fall back to
    // the whole deck rather than returning a number built on no samples.
    legal.set(floor, allowed.length > 0 ? allowed : pairs)
  }

  const used = new Uint8Array(stub.length)
  let equity = 0
  let win = 0
  let tie = 0

  for (let t = 0; t < trials; t++) {
    used.fill(0)

    // The board first, so every opponent is dealt around the same runout.
    const runout: Card[] = []
    for (let i = 0; i < need; i++) {
      let at = Math.floor(rng() * stub.length)
      while (used[at]) at = (at + 1) % stub.length
      used[at] = 1
      runout.push(stub[at])
    }

    const opponentHands: Card[][] = []
    for (let o = 0; o < opponents; o++) {
      const allowed = legal.get(perOpponent[o])!
      let picked: { a: number; b: number } | null = null
      // Only a dozen or so of the ~47 cards are spoken for, so a clash is
      // uncommon and a handful of draws settles it.
      for (let attempt = 0; attempt < 16 && !picked; attempt++) {
        const candidate = allowed[Math.floor(rng() * allowed.length)]
        if (!used[candidate.a] && !used[candidate.b]) picked = candidate
      }
      // Exhausted: walk the list for the first pair that fits. Slower, but it
      // keeps the sample inside the range instead of abandoning it.
      if (!picked) picked = allowed.find((p) => !used[p.a] && !used[p.b]) ?? null
      if (!picked) {
        // Nothing in range is left at all. Take any two cards rather than
        // dropping an opponent and quietly making the pot smaller.
        const free: number[] = []
        for (let i = 0; i < stub.length && free.length < 2; i++) if (!used[i]) free.push(i)
        if (free.length < 2) break
        picked = { a: free[0], b: free[1] }
      }
      used[picked.a] = 1
      used[picked.b] = 1
      opponentHands.push([stub[picked.a], stub[picked.b]])
    }

    const full = [...board, ...runout]
    const mine = evaluate([...hole, ...full]).score
    let best = mine
    let ties = 0
    for (const hand of opponentHands) {
      const theirs = evaluate([...hand, ...full]).score
      if (theirs > best) { best = theirs; ties = 0 }
      else if (theirs === mine && mine === best) ties++
    }
    if (best === mine) {
      if (ties === 0) { win++; equity += 1 }
      else { tie++; equity += 1 / (ties + 1) }
    }
  }

  return { equity: equity / trials, win: win / trials, tie: tie / trials, exact: false, runouts: trials }
}

// ---------------------------------------------------------------------------
// Outs
// ---------------------------------------------------------------------------

export interface OutGroup {
  /** What these cards make, e.g. "Flush". */
  makes: string
  cards: Card[]
  /** Chance one of *these* cards lands by the river. */
  byRiver: number
}

export interface OutsReport {
  groups: OutGroup[]
  count: number
  /** Chance at least one out lands by the river. */
  byRiver: number
  cardsToCome: number
}

/** Odds at least one of `outs` cards arrives, given `unknown` cards unseen. */
function chanceByRiver(outs: number, unknown: number, cardsToCome: number): number {
  if (outs <= 0 || cardsToCome <= 0) return 0
  let miss = 1
  for (let i = 0; i < cardsToCome; i++) miss *= (unknown - outs - i) / (unknown - i)
  return 1 - Math.max(0, miss)
}

/**
 * Cards that would land on the board with nothing to spare — ranks the board
 * does not already hold, in a suit that cannot complete a flush. Used to work
 * out what the board would be worth to a player holding nothing.
 */
function blanks(board: Card[], exclude: Card[], howMany: number): Card[] {
  const dead = new Set([...board, ...exclude].map(key))
  const ranks = new Set(board.map((c) => c.rank))
  const suits = new Map<string, number>()
  for (const c of board) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1)

  const pool = makeDeck().filter((c) => !dead.has(key(c)))
  const harmless = pool.filter((c) => !ranks.has(c.rank) && (suits.get(c.suit) ?? 0) < 3)
  const chosen = (harmless.length >= howMany ? harmless : pool).slice()
  chosen.sort((a, b) => a.rank - b.rank)
  return chosen.slice(0, howMany)
}

/**
 * Cards that would genuinely improve *your* hand.
 *
 * A card only counts if it lifts you into a better category than the board
 * would hand to somebody holding two blanks — otherwise a card that pairs the
 * board reads as an out, when in fact it helps everyone at the table equally.
 *
 * This counts improvement, not victory: a card can improve your hand and still
 * leave you behind. The equity figure is the answer to "am I winning"; this is
 * the answer to "what am I drawing to".
 */
export function findOuts(hole: Card[], board: Card[]): OutsReport {
  const cardsToCome = 5 - board.length
  if (board.length < 3 || cardsToCome === 0) {
    return { groups: [], count: 0, byRiver: 0, cardsToCome }
  }

  const current = evaluate([...hole, ...board])
  const unseen = unseenCards([...hole, ...board])
  const byCategory = new Map<HandCategory, Card[]>()

  for (const card of unseen) {
    const mine = evaluate([...hole, ...board, card])
    if (mine.category <= current.category) continue

    // What the same card is worth to a hand that contributes nothing.
    const withBoard = [...board, card]
    const padding = blanks(withBoard, hole, Math.max(0, 5 - withBoard.length))
    const boardAlone = evaluate([...withBoard, ...padding])
    if (mine.category <= boardAlone.category) continue

    const list = byCategory.get(mine.category) ?? []
    list.push(card)
    byCategory.set(mine.category, list)
  }

  const unknown = unseen.length
  const groups: OutGroup[] = [...byCategory.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([category, cards]) => ({
      makes: CATEGORY_NAMES[category],
      cards,
      byRiver: chanceByRiver(cards.length, unknown, cardsToCome),
    }))

  const count = groups.reduce((sum, g) => sum + g.cards.length, 0)
  return { groups, count, byRiver: chanceByRiver(count, unknown, cardsToCome), cardsToCome }
}

// ---------------------------------------------------------------------------
// Starting hands
// ---------------------------------------------------------------------------

export interface StartingHand {
  label: string
  chen: number
  /** Where the Chen score puts it. */
  grade: string
  note: string
}

export function describeStartingHand(hole: Card[]): StartingHand {
  const chen = chenScore(hole)
  const sorted = [...hole].sort((a, b) => b.rank - a.rank)
  const suited = sorted.length === 2 && sorted[0].suit === sorted[1].suit
  const pair = sorted.length === 2 && sorted[0].rank === sorted[1].rank
  const label = pair
    ? `Pocket ${rankLabel(sorted[0].rank as Rank)}s`
    : sorted.map((c) => rankLabel(c.rank as Rank)).join('') + (suited ? ' suited' : ' offsuit')

  const grade =
    chen >= 12 ? 'Premium' :
    chen >= 9 ? 'Strong' :
    chen >= 7 ? 'Playable' :
    chen >= 5 ? 'Marginal' : 'Trash'

  const note =
    chen >= 12 ? 'Raise from anywhere, and be happy to play a big pot.'
    : chen >= 9 ? 'Open from most positions; fold it to serious pressure out of position.'
    : chen >= 7 ? 'Fine to open in late position. Out of position it is a trap.'
    : chen >= 5 ? 'Playable cheap and in position. It will not win a big pot without help.'
    : 'Not a hand. Fold it unless the price is free.'

  return { label, chen, grade, note }
}

// ---------------------------------------------------------------------------
// The recommendation
// ---------------------------------------------------------------------------

export interface Recommendation {
  action: ActionKind
  /** Total to make it, for bet and raise. */
  amount?: number
  headline: string
  reasons: string[]
  /** How close the call was: a clear spot, or one that could go either way. */
  confidence: 'clear' | 'close'
}

export interface CoachAdvice {
  street: Street
  seat: number
  opponents: number
  hole: Card[]
  board: Card[]
  starting: StartingHand
  made: HandValue | null
  madeLabel: string | null
  outs: OutsReport
  equity: EquityResult
  /** The weakest starting hand the opponents are being credited with. */
  assumedRange: number
  pot: number
  toCall: number
  /** Equity needed to break even on the call. */
  breakEven: number
  /** Expected value of calling, in cents. */
  callEV: number
  /**
   * Facing a bet: how often it needs you to fold, and how much of your range
   * has to continue to take that away. Null when there is nothing to call.
   */
  defence: DefenceReport | null
  /**
   * Who made it, so the panel can say whether the floor is worth respecting
   * against *them*. Null whenever nobody has bet.
   */
  bettor: number | null
  /**
   * Betting yourself: how many bluffs a pot-sized bet here could carry. Null
   * unless betting is actually on the table.
   */
  bluffing: BluffReport | null
  legal: LegalActions
  recommendation: Recommendation
}

/**
 * How strong a hand the players still in are credited with, one floor each.
 *
 * Three things move it, and the reason for each is worth stating because all
 * of this is judgement rather than solved:
 *
 * - **What it costs.** The more somebody has put in, the better the hand they
 *   are likely to hold. This is the whole of the old model.
 * - **Where they are.** A raise from under the gun is a far stronger range than
 *   the same raise on the button, because the button raises to steal and early
 *   position cannot afford to.
 * - **What they did.** Someone who raised is not the same as someone who
 *   called, who is not the same as the big blind who got here for free.
 *
 * Returned in `state.order` — earliest to act first — for the live opponents,
 * hero excluded. Plainly a
 * heuristic: it will be confidently wrong in some spots, and it is still much
 * closer than crediting everybody with the same hand.
 */
export function opponentRanges(state: HandState, heroSeat: number): number[] {
  const forced = Math.max(BIG_BLIND, ...state.straddles.map((s) => s.amount))
  const units = Math.max(1, state.currentBet / forced)
  // The old scalar, kept as the starting point: it was the part that worked.
  const base = state.board.length === 0
    ? Math.min(11, Math.log2(units) * 4)
    : (units > 1 ? 6 : 4)

  // Walked in `state.order` — earliest to act first — so the position term
  // below and the documented return order are the same thing.
  const live = new Set(livePlayers(state).map((p) => p.seat))
  const opponents = state.order.filter((seat) => seat !== heroSeat && live.has(seat))

  return opponents.map((seat) => {
    let floor = base

    // Position, as a fraction of the way round to the button. Worth about two
    // Chen points end to end, the same weight position gets in the pre-flop
    // advice itself.
    const index = state.order.indexOf(seat)
    if (index >= 0 && state.order.length > 1) {
      const lateness = index / (state.order.length - 1)
      floor += 1 - lateness * 2
    }

    floor += aggressionAdjustment(state, seat)

    // Clamped to what the Chen scale can express: a floor above the best
    // possible hand would leave nothing to deal.
    return Math.max(0, Math.min(12, floor))
  })
}

/** What this seat's own actions say about the hand behind them. */
function aggressionAdjustment(state: HandState, seat: number): number {
  let raised = false
  let bet = false
  let called = false
  let voluntary = false

  for (const entry of state.journal) {
    if (entry.seat !== seat) continue
    switch (entry.kind) {
      case 'raise': raised = true; voluntary = true; break
      case 'bet': bet = true; voluntary = true; break
      case 'call': called = true; voluntary = true; break
      case 'straddle': voluntary = true; break
      default: break
    }
  }

  if (raised) return 3
  if (bet) return 2
  if (called) return 0
  // Still in without ever choosing to be: the big blind seeing a flop for
  // free holds nothing in particular, and crediting it with a range is the
  // fastest way to talk yourself out of a bet you should make.
  return voluntary ? 0 : -2
}

export function advise(
  state: HandState,
  seats: Seat[],
  seat: number,
  rng: Rng,
  trials = 2200,
  /** Whose read this is. Omitted, it is the house's — the straight numbers. */
  speaker: CoachVoice = voice('house'),
): CoachAdvice {
  const player = state.players[seat]
  const legal = legalActions(state, seats, seat)
  const opponents = Math.max(1, livePlayers(state).length - 1)
  const pot = potTotal(state)
  const toCall = legal.callAmount
  const ranges = opponentRanges(state, seat)

  const equity = equityVsRange(player.hole, state.board, opponents, ranges, trials, rng)
  const outs = findOuts(player.hole, state.board)
  const made = state.board.length >= 3 ? bestHand(state, seat) : null
  const starting = describeStartingHand(player.hole)

  const breakEven = toCall > 0 ? toCall / (pot + toCall) : 0
  const callEV = toCall > 0 ? equity.equity * pot - (1 - equity.equity) * toCall : 0

  /*
   * The frequency numbers, which are about the range rather than the hand.
   *
   * Only one of the two can apply: you are either facing a bet or you are
   * considering making one. Both are null when neither is true — checked
   * round, nothing to call, nothing legal to bet — and the panel renders
   * nothing rather than a row of zeroes.
   *
   * `defenders` is everybody still in except the one who bet, which is the
   * same count as `opponents` for a different reason: that one excludes you
   * instead. Worth stating, because the two coming apart later would be a
   * silent change of meaning.
   */
  const risk = aggressorRisk(state)
  const defence = toCall > 0 && risk > 0
    ? defenceReport(Math.max(0, pot - risk), risk, opponents)
    : null
  const bettor = defence ? aggressorSeat(state) : null
  // Quoted for a pot-sized bet, or a shove where the stack cannot reach one.
  // `maxRaiseTo` is a total to arrive at, so what is actually being risked is
  // the part not already in front of the player.
  const canAfford = Math.max(0, legal.maxRaiseTo - player.committedRound)
  const bluffing = toCall === 0 && legal.canBet && canAfford > 0
    ? bluffReport(pot, Math.min(pot, canAfford), state.street)
    : null

  const recommendation = state.board.length === 0
    ? preflopAdvice(state, legal, starting, seat, pot, toCall, breakEven, equity.equity, speaker)
    : postflopAdvice(legal, made, outs, equity.equity, breakEven, callEV, pot, opponents, speaker)

  return {
    street: state.street,
    seat,
    opponents,
    hole: [...player.hole],
    board: [...state.board],
    starting,
    made,
    madeLabel: made ? describeHand(made) : null,
    outs,
    equity,
    assumedRange: ranges.length > 0
      ? ranges.reduce((sum, r) => sum + r, 0) / ranges.length
      : 0,
    pot,
    toCall,
    breakEven,
    callEV,
    defence,
    bettor,
    bluffing,
    legal,
    recommendation,
  }
}

/**
 * Whoever the current bet belongs to — the one live player matching it.
 *
 * Null in a round nobody has bet in. Used to look up a read on the player who
 * actually made the bet, rather than on the table in general.
 */
export function aggressorSeat(state: HandState): number | null {
  const at = livePlayers(state).find((p) => p.committedRound === state.currentBet)
  return state.currentBet > 0 && at ? at.seat : null
}

/**
 * What the aggressor actually put at risk to make the price what it is.
 *
 * Not the same as what it costs you to call, and the difference is the whole
 * reason this is a function. Somebody raising $10 to $40 with you already in
 * for $10 risked $30, not $40 — and the pot they win if everybody folds is the
 * pot as it stood before those $30 went in. Using the call amount instead
 * would quietly overstate the bet on every raise, which is exactly the spot
 * where a player most needs the number to be right.
 *
 * Found as the gap between the current bet and the next-highest amount anybody
 * live has in for this round, which is the level they raised over. For a plain
 * bet into an unopened round that second level is zero, and it comes out as
 * the bet itself.
 */
export function aggressorRisk(state: HandState): number {
  const live = livePlayers(state)
  const levels = live.map((p) => p.committedRound).sort((a, b) => b - a)
  const under = levels.length > 1 ? levels[1] : 0
  return Math.max(0, state.currentBet - under)
}

/** Includes the preposition, so it reads properly in a sentence. */
/** Kept as a local name; the logic lives in `position.ts` now. */
function positionName(state: HandState, seat: number): string {
  return positionLabelFor(state, seat)
}

function preflopAdvice(
  state: HandState,
  legal: LegalActions,
  starting: StartingHand,
  seat: number,
  pot: number,
  toCall: number,
  breakEven: number,
  equity: number,
  speaker: CoachVoice,
): Recommendation {
  const where = positionName(state, seat)
  const seatPosition = positionOf(state, seat)
  const late = isLate(seatPosition)
  const forced = Math.max(BIG_BLIND, ...state.straddles.map((s) => s.amount))
  const raised = state.currentBet > forced
  /*
   * The grade leads and the number supports it, rather than the other way
   * around. "Scores 10 on the Chen scale" was the first thing said on every
   * pre-flop hand, which put a piece of jargon nobody had introduced at the
   * top of the argument — and made a pre-flop shorthand read like the whole
   * case. The information is identical; the emphasis is not.
   */
  const reasons: string[] = [
    `${starting.label} is a ${starting.grade.toLowerCase()} starting hand (Chen ${starting.chen}).`,
    `You are ${where}.`,
  ]
  if (state.straddles.length > 0) {
    reasons.push(`A straddle makes this a ${money(forced)} game for this hand, so everything is priced off that.`)
  }

  /*
   * Position is worth about two Chen points, and the coach's own taste is
   * worth a couple more either way. This is where two voices genuinely part
   * company: the same hand in the same seat is a call to one and a fold to
   * another, and that disagreement is the thing worth showing.
   */
  const need = (raised ? 10 : 6.5)
    - (late ? 2 : 0)
    + (seatPosition === 'ep' ? 1 : 0)
    + speaker.entryShift

  if (legal.canCheck) {
    if (starting.chen >= need + 4 && legal.canBet) {
      const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, state.currentBet * 3))
      reasons.push('Nobody has raised and this hand is too good to let everyone in cheaply.')
      reasons.push(speaker.says.aggressive)
      return { action: 'bet', amount, headline: `Raise to ${money(amount)}`, reasons, confidence: 'clear' }
    }
    reasons.push('Checking is free and this hand does not want to build a pot yet.')
    return { action: 'check', headline: 'Check', reasons, confidence: 'clear' }
  }

  if (starting.chen >= need + 5 && legal.canRaise) {
    const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, state.currentBet * 3))
    reasons.push('Strong enough to raise for value rather than flat call.')
    reasons.push(speaker.says.aggressive)
    return { action: 'raise', amount, headline: `Raise to ${money(amount)}`, reasons, confidence: 'clear' }
  }

  if (starting.chen >= need) {
    reasons.push(
      `Calling ${money(toCall)} into ${money(pot)} needs ${pct(breakEven)} to break even ` +
      'right now — but a hand like this is played for what it can make after the flop, ' +
      'not for its share of the pot this second.',
    )
    reasons.push(speaker.says.loose)
    return {
      action: 'call',
      headline: `Call ${money(toCall)}`,
      reasons,
      confidence: starting.chen < need + 1.5 ? 'close' : 'clear',
    }
  }

  reasons.push(
    `It needs about ${need.toFixed(1)} to continue for ${money(toCall)} ${where}, ` +
    `and it is ${starting.chen}.`,
  )
  if (equity > breakEven) {
    reasons.push(
      `Raw equity looks playable at ${pct(equity)}, but that is against hands that will outplay ` +
      'this one after the flop. Folding now costs nothing.',
    )
  }
  reasons.push(speaker.says.tight)
  return { action: 'fold', headline: 'Fold', reasons, confidence: starting.chen > need - 1.5 ? 'close' : 'clear' }
}

function postflopAdvice(
  legal: LegalActions,
  made: HandValue | null,
  outs: OutsReport,
  equity: number,
  breakEven: number,
  callEV: number,
  pot: number,
  opponents: number,
  speaker: CoachVoice,
): Recommendation {
  const reasons: string[] = []
  if (made) reasons.push(`You have ${describeHand(made)}.`)
  reasons.push(`You win this pot about ${pct(equity)} of the time against ${opponents} opponent${opponents === 1 ? '' : 's'}.`)
  if (outs.count > 0) {
    reasons.push(
      `${outs.count} card${outs.count === 1 ? '' : 's'} improve you — ` +
      `${pct(outs.byRiver)} to get there by the river.`,
    )
  }

  const strong = made ? made.category >= HandCategory.Trips : false
  const bigDraw = outs.count >= 8 && outs.cardsToCome > 0

  // --- checked to us -------------------------------------------------------
  if (legal.canCheck) {
    // An aggressive voice bets thinner and bigger; a patient one waits for more.
    const valueBar = 0.5 + 0.06 * Math.min(opponents, 4) - (speaker.aggression - 0.5) * 0.12
    if (equity > valueBar && legal.canBet) {
      const amount = Math.min(
        legal.maxRaiseTo,
        Math.max(legal.minRaiseTo, Math.round(pot * speaker.sizing)),
      )
      reasons.push(`Ahead of this many players, so bet for value — about ${money(amount)} into ${money(pot)}.`)
      reasons.push(speaker.says.aggressive)
      return { action: 'bet', amount, headline: `Bet ${money(amount)}`, reasons, confidence: 'clear' }
    }
    if (bigDraw && opponents <= 2 && legal.canBet) {
      const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(pot * 0.5)))
      reasons.push('A big draw plays well as a semi-bluff: you can win now, and you have a hand if called.')
      return { action: 'bet', amount, headline: `Bet ${money(amount)}`, reasons, confidence: 'close' }
    }
    reasons.push('Not enough to bet for value and not enough of a draw to bluff. Take the free card.')
    reasons.push(speaker.says.passive)
    return { action: 'check', headline: 'Check', reasons, confidence: 'clear' }
  }

  // --- facing a bet --------------------------------------------------------
  reasons.push(
    `Calling ${money(legal.callAmount)} into ${money(pot)} needs ${pct(breakEven)} to break even. ` +
    `You have ${pct(equity)}.`,
  )
  reasons.push(
    callEV >= 0
      ? `That makes the call worth about ${money(Math.round(callEV))} every time you make it.`
      : `That call loses about ${money(Math.round(-callEV))} every time you make it.`,
  )

  const margin = equity - breakEven

  if (equity > 0.72 && legal.canRaise && strong) {
    const amount = Math.min(
      legal.maxRaiseTo,
      Math.max(legal.minRaiseTo, Math.round(pot * Math.max(0.6, speaker.sizing))),
    )
    reasons.push('Well ahead — raise and charge the draws rather than just calling.')
    reasons.push(speaker.says.aggressive)
    return { action: 'raise', amount, headline: `Raise to ${money(amount)}`, reasons, confidence: 'clear' }
  }

  if (margin > 0.03) {
    return {
      action: 'call',
      headline: `Call ${money(legal.callAmount)}`,
      reasons,
      confidence: margin < 0.07 ? 'close' : 'clear',
    }
  }

  if (margin > -0.03 && bigDraw) {
    reasons.push('Marginal on price alone, but a draw this big picks up value on later streets.')
    return { action: 'call', headline: `Call ${money(legal.callAmount)}`, reasons, confidence: 'close' }
  }

  reasons.push('The price is worse than the hand. Let it go.')
  return { action: 'fold', headline: 'Fold', reasons, confidence: margin > -0.06 ? 'close' : 'clear' }
}

export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Reviewing what was actually done
// ---------------------------------------------------------------------------

export interface DecisionReview {
  agreed: boolean
  /** Cents of expected value given up. Zero when the play was fine. */
  evLost: number
  leak: string | null
  message: string
  tone: 'ok' | 'off'
}

/** Bet and raise are the same decision wearing different names. */
function family(kind: Action['kind']): 'passive' | 'aggressive' | 'fold' {
  if (kind === 'fold') return 'fold'
  if (kind === 'bet' || kind === 'raise') return 'aggressive'
  return 'passive'
}

/**
 * How far a bet has to miss the coach's size before it is worth mentioning.
 *
 * Wide on purpose. The coach's sizing is a heuristic — three times the bet
 * pre-flop, a fraction of the pot after it — not a solved number, so treating
 * every deviation as a mistake would be claiming an accuracy it does not have.
 * Under half or over double is the range where the size is doing something
 * different from what the line intended, whoever is right about the exact
 * figure.
 */
const SIZING_TOLERANCE = 2

export function reviewDecision(advice: CoachAdvice, action: Action): DecisionReview {
  const want = advice.recommendation
  const agreed = action.kind === want.action

  if (agreed) {
    /*
     * Right action, wrong size.
     *
     * Until this existed, raising to the minimum when the coach wanted three
     * times the pot scored as a perfect match — the review only ever compared
     * the *kind* of action, so the most recognisable thing about how somebody
     * bets was the one thing that went unmarked.
     *
     * It stays `agreed`, because the decision was right and only the size was
     * not, and it carries no cost: what a different size would have won
     * depends on what the opponents would have done with it, which the engine
     * does not know. Counted, named, and honestly unpriced.
     */
    const wanted = want.amount ?? 0
    const put = action.amount ?? 0
    if (wanted > 0 && put > 0 && (put * SIZING_TOLERANCE < wanted || put > wanted * SIZING_TOLERANCE)) {
      const bigger = put > wanted
      return {
        agreed: true,
        evLost: 0,
        leak: 'Bet sizing',
        message:
          `${want.headline} was right, but ${money(put)} is ${bigger ? 'far more' : 'far less'} ` +
          `than the ${money(wanted)} the line was built on — ` +
          (bigger
            ? 'a bet that big only gets called by hands that beat you.'
            : 'a bet that small gives the field a price to draw at.'),
        tone: 'off',
      }
    }

    return {
      agreed: true,
      evLost: 0,
      leak: null,
      message: `${want.headline} — that is the play.`,
      tone: 'ok',
    }
  }

  const preflop = advice.board.length === 0

  // The two mistakes that actually cost money are calling a price you should
  // have passed on, and folding one you should have taken.
  if (want.action === 'fold' && action.kind === 'call') {
    const lost = Math.round(-advice.callEV)
    // Pre-flop the coach folds on hand quality, not on price: a hand can be
    // getting the right immediate odds and still be one you do not want to
    // play out of position. Saying it "costs $0.00" would be nonsense.
    if (lost <= 0) {
      return {
        agreed: false,
        evLost: 0,
        leak: 'Loose call',
        message: preflop
          ? `${advice.starting.label} is priced fine at ${pct(advice.breakEven)}, but it is a ` +
            'hand that keeps costing money after the flop. The fold is about the hand, not the odds.'
          : `The immediate price is fine, but the coach would still pass here — ` +
            'this hand does not want to keep paying on later streets.',
        tone: 'off',
      }
    }
    return {
      agreed: false,
      evLost: lost,
      leak: 'Called too light',
      message:
        `You called ${money(advice.toCall)} with ${pct(advice.equity.equity)} equity, ` +
        `needing ${pct(advice.breakEven)}. That call costs about ${money(lost)} a time.`,
      tone: 'off',
    }
  }

  if ((want.action === 'call' || want.action === 'raise') && action.kind === 'fold') {
    const lost = Math.round(advice.callEV)
    if (lost <= 0) {
      return {
        agreed: false,
        evLost: 0,
        leak: 'Folded a playable hand',
        message: `${want.headline} was the play — this hand is worth continuing with here.`,
        tone: 'off',
      }
    }
    return {
      agreed: false,
      evLost: lost,
      leak: 'Folded a good price',
      message:
        `You folded with ${pct(advice.equity.equity)} equity needing only ` +
        `${pct(advice.breakEven)}. That fold gives up about ${money(lost)}.`,
      tone: 'off',
    }
  }

  const wanted = family(want.action)
  const played = family(action.kind)

  if (wanted === 'aggressive' && played === 'passive') {
    return {
      agreed: false,
      evLost: 0,
      leak: 'Missed value',
      message: `${want.headline} was the play — checking or calling here leaves money on the table.`,
      tone: 'off',
    }
  }

  if (wanted === 'passive' && played === 'aggressive') {
    return {
      agreed: false,
      evLost: 0,
      leak: 'Too aggressive',
      message: `${want.headline} was the play. Betting here only gets called by hands that beat you.`,
      tone: 'off',
    }
  }

  return {
    agreed: false,
    evLost: 0,
    leak: 'Off the line',
    message: `The recommendation was ${want.headline.toLowerCase()}.`,
    tone: 'off',
  }
}

