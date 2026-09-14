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
import { bestHand, legalActions, livePlayers, potTotal, type LegalActions } from './hand'
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
 * Opponents are dealt from a *range* rather than uniformly at random: a
 * player still putting money in does not hold a random two cards, and pricing
 * a call against random hands is the single most common way to talk yourself
 * into a bad call. `minChen` is the weakest starting hand the opponents are
 * assumed to hold.
 */
export function equityVsRange(
  hole: Card[],
  board: Card[],
  opponents: number,
  minChen: number,
  trials: number,
  rng: Rng,
): EquityResult {
  const stub = unseenCards([...hole, ...board])
  const need = 5 - board.length
  const draw = need + opponents * 2
  if (opponents < 1 || stub.length < draw) {
    return { equity: 1, win: 1, tie: 0, exact: false, runouts: 0 }
  }

  let equity = 0
  let win = 0
  let tie = 0

  for (let t = 0; t < trials; t++) {
    // Shuffle enough of the stub for this trial, re-drawing opponent hands
    // that fall outside the assumed range (with a cap, so this always ends).
    let attempts = 0
    let ok = false
    let opponentHands: Card[][] = []
    while (!ok && attempts < 6) {
      attempts++
      for (let i = 0; i < draw; i++) {
        const j = i + Math.floor(rng() * (stub.length - i))
        ;[stub[i], stub[j]] = [stub[j], stub[i]]
      }
      opponentHands = []
      ok = true
      for (let o = 0; o < opponents; o++) {
        const at = need + o * 2
        const hand = [stub[at], stub[at + 1]]
        if (minChen > 0 && chenScore(hand) < minChen) ok = false
        opponentHands.push(hand)
      }
    }

    const full = [...board, ...stub.slice(0, need)]
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
  legal: LegalActions
  recommendation: Recommendation
}

/**
 * How strong a hand the players still in are credited with. The more it costs
 * to keep playing, the better the hands that are still out there.
 */
function assumedRange(state: HandState): number {
  const forced = Math.max(BIG_BLIND, ...state.straddles.map((s) => s.amount))
  const units = Math.max(1, state.currentBet / forced)
  if (state.board.length === 0) return Math.min(11, Math.log2(units) * 4)
  // Post-flop, anyone still in started with something they liked.
  return units > 1 ? 6 : 4
}

export function advise(
  state: HandState,
  seats: Seat[],
  seat: number,
  rng: Rng,
  trials = 2200,
): CoachAdvice {
  const player = state.players[seat]
  const legal = legalActions(state, seats, seat)
  const opponents = Math.max(1, livePlayers(state).length - 1)
  const pot = potTotal(state)
  const toCall = legal.callAmount
  const range = assumedRange(state)

  const equity = equityVsRange(player.hole, state.board, opponents, range, trials, rng)
  const outs = findOuts(player.hole, state.board)
  const made = state.board.length >= 3 ? bestHand(state, seat) : null
  const starting = describeStartingHand(player.hole)

  const breakEven = toCall > 0 ? toCall / (pot + toCall) : 0
  const callEV = toCall > 0 ? equity.equity * pot - (1 - equity.equity) * toCall : 0

  const recommendation = state.board.length === 0
    ? preflopAdvice(state, legal, starting, seat, pot, toCall, breakEven, equity.equity)
    : postflopAdvice(legal, made, outs, equity.equity, breakEven, callEV, pot, opponents)

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
    assumedRange: range,
    pot,
    toCall,
    breakEven,
    callEV,
    legal,
    recommendation,
  }
}

/** Includes the preposition, so it reads properly in a sentence. */
function positionName(state: HandState, seat: number): string {
  const i = state.order.indexOf(seat)
  const n = state.order.length
  if (i === n - 1) return 'on the button'
  if (i === n - 2) return 'in the cut-off'
  if (seat === state.smallBlindSeat) return 'in the small blind'
  if (seat === state.bigBlindSeat) return 'in the big blind'
  if (i <= Math.floor(n / 3)) return 'in early position'
  return 'in middle position'
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
): Recommendation {
  const where = positionName(state, seat)
  const late = where === 'on the button' || where === 'in the cut-off'
  const forced = Math.max(BIG_BLIND, ...state.straddles.map((s) => s.amount))
  const raised = state.currentBet > forced
  const reasons: string[] = [
    `${starting.label} scores ${starting.chen} on the Chen scale — ${starting.grade.toLowerCase()}.`,
    `You are ${where}.`,
  ]
  if (state.straddles.length > 0) {
    reasons.push(`A straddle makes this a ${money(forced)} game for this hand, so everything is priced off that.`)
  }

  // Position is worth about two Chen points.
  const need = (raised ? 10 : 6.5) - (late ? 2 : 0) + (where === 'in early position' ? 1 : 0)

  if (legal.canCheck) {
    if (starting.chen >= need + 4 && legal.canBet) {
      const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, state.currentBet * 3))
      reasons.push('Nobody has raised and this hand is too good to let everyone in cheaply.')
      return { action: 'bet', amount, headline: `Raise to ${money(amount)}`, reasons, confidence: 'clear' }
    }
    reasons.push('Checking is free and this hand does not want to build a pot yet.')
    return { action: 'check', headline: 'Check', reasons, confidence: 'clear' }
  }

  if (starting.chen >= need + 5 && legal.canRaise) {
    const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, state.currentBet * 3))
    reasons.push('Strong enough to raise for value rather than flat call.')
    return { action: 'raise', amount, headline: `Raise to ${money(amount)}`, reasons, confidence: 'clear' }
  }

  if (starting.chen >= need) {
    reasons.push(
      `Calling ${money(toCall)} into ${money(pot)} needs ${pct(breakEven)} to break even; ` +
      `this hand is worth playing for that price.`,
    )
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
    const valueBar = 0.5 + 0.06 * Math.min(opponents, 4)
    if (equity > valueBar && legal.canBet) {
      const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(pot * 0.6)))
      reasons.push(`Ahead of this many players, so bet for value — about ${money(amount)} into ${money(pot)}.`)
      return { action: 'bet', amount, headline: `Bet ${money(amount)}`, reasons, confidence: 'clear' }
    }
    if (bigDraw && opponents <= 2 && legal.canBet) {
      const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(pot * 0.5)))
      reasons.push('A big draw plays well as a semi-bluff: you can win now, and you have a hand if called.')
      return { action: 'bet', amount, headline: `Bet ${money(amount)}`, reasons, confidence: 'close' }
    }
    reasons.push('Not enough to bet for value and not enough of a draw to bluff. Take the free card.')
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
    const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(pot * 0.75)))
    reasons.push('Well ahead — raise and charge the draws rather than just calling.')
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

export function reviewDecision(advice: CoachAdvice, action: Action): DecisionReview {
  const want = advice.recommendation
  const agreed = action.kind === want.action

  if (agreed) {
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

