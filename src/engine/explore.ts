/**
 * What if I had raised instead?
 *
 * The most useful thing left to build and the easiest to build badly. Re-run
 * the hand once with a different action and you get a single outcome out of a
 * distribution — and "you would have won $40" is the most memorable thing that
 * could go on the screen and the least true. A feature that showed that would
 * teach results-oriented thinking, which is the exact habit the rating exists
 * to avoid.
 *
 * So every alternative is played out many times with a fresh runout each time,
 * and what comes back is a distribution with a confidence band. The band is
 * not decoration: at a hundred trials it is routinely wider than the gap
 * between two lines, which is the honest answer to most of these questions.
 *
 * ### What is held fixed, and why it matters
 *
 * Everyone's hole cards stay as they were dealt. That makes this "given this
 * exact deal, what would raising have done" — not "is raising right in spots
 * like this". The first is the question somebody asks about a hand they just
 * played; the second needs the opponents' cards varied across a range and is a
 * different feature. The UI has to say which one it is answering, because the
 * two have different lessons and only one of them is on screen.
 *
 * Board cards already dealt at the decision point stay too. Everything after
 * is re-dealt per trial, which is what produces the spread.
 *
 * ### The opponents re-decide
 *
 * They must. A raise that the original callers would have folded to only shows
 * up if the bots get to answer it. The consequence is that this measures "what
 * happens against these players, playing as they do" rather than against the
 * line they actually took — right, but worth stating.
 *
 * ### The compromise, measured rather than assumed
 *
 * The bots run their own Monte Carlo on every decision, so an exploration
 * samples the future inside a function that is already sampling the future.
 * At their real strength one line takes 30 to 40 seconds for 120 trials, which
 * on the device this app is actually used on is not a feature. So they are
 * capped at `BOT_TRIALS`.
 *
 * That is not free, and the cost was measured across four independent spots at
 * 120 trials each:
 *
 * | spot | capped (40) | full strength (340) |
 * |------|-------------|---------------------|
 * | 0    | +387 ± 134  | +215 ± 77           |
 * | 1    | -449 ± 226  | -455 ± 197          |
 * | 2    | +2288 ± 569 | +1981 ± 513         |
 * | 3    | -1031 ± 308 | -1334 ± 240         |
 *
 * Three of the four move in the same direction and one of them (spot 0) moves
 * far enough that the bands do not overlap. Weaker opponents lose to you more
 * often, so **the numbers here flatter your line by something like 10 to 25
 * per cent**. That is a real bias, it is in the direction that makes you feel
 * good, and the UI says so rather than leaving it in a comment.
 *
 * Which is also why the useful output is `separated` rather than a ranking.
 * Most of the time the honest answer is that two lines are too close to tell
 * apart, and a feature that says so beats one that invents a winner.
 *
 * ### What it costs to run
 *
 * Measured end to end in a browser on a development machine: **9.4 seconds**
 * for three lines at 120 trials, in a worker. On the iPad this app is actually
 * used on it will be slower. That is why it is asked for rather than computed
 * ahead of you, why it runs off the main thread, and why the panel says what
 * it is doing while you wait — several silent seconds reads as a hang.
 */

import { makeDeck, shuffle, type Card, type Rng, Shoe } from './cards'
import { parseCards } from './cards'
import { decideAction, decideDiscard } from './ai'
import { createHand, dealHand, applyAction, addStraddle, legalActions, resolveShowdown } from './hand'
import { advanceStreet } from './core/streets'
import { boardSizeFor, type HandReplay } from './replay'
import { emptyReads } from './reads'
import type { Action, HandState, Seat, Street } from './types'

/**
 * How many times a line is played out.
 *
 * Measured against the clock rather than chosen: at this count with the bots
 * capped, a three-line exploration lands in a few seconds rather than a few
 * minutes, and the band is narrow enough to separate lines that genuinely
 * differ. Raising it narrows the band as the square root, so doubling the wait
 * buys 40% — rarely the right trade when the honest answer is usually "too
 * close to call" either way.
 */
export const DEFAULT_TRIALS = 120

/** Below this the spread is wider than anything it could tell you. */
export const MINIMUM_TRIALS = 30

export interface Outcome {
  /** Mean chips won or lost across the hand, in cents. */
  mean: number
  /** Half-width of the 95% band, in cents. */
  margin: number
  /** Share of trials that finished ahead of where the hand started. */
  aheadShare: number
  best: number
  worst: number
  trials: number
}

export interface Line {
  action: Action
  label: string
  outcome: Outcome
}

/**
 * How much the capped opponents flatter the result, as measured.
 *
 * Exported so the screen can say it in the player's own terms instead of the
 * number living only in a comment nobody reads.
 */
export const OPPONENT_BIAS = 'The simulated opponents think less hard than the ones you played, '
  + 'which flatters every line here by something like 10 to 25 per cent. Compare the lines '
  + 'against each other rather than reading any one of them as what you would have won.'

export interface Exploration {
  /** Which journal entry was rewound to. */
  at: number
  street: Street
  /** What actually happened, replayed the same way for a fair comparison. */
  played: Line
  /** The alternatives, in the order they were offered. */
  lines: Line[]
  /**
   * Whether any two lines are far enough apart to be distinguishable.
   *
   * False means the honest answer is "these are too close to call", which is
   * the answer far more often than a single replay would suggest.
   */
  separated: boolean
}

/** The hero's own decisions in a replay, in order. */
export function decisionPoints(replay: HandReplay): number[] {
  const out: number[] = []
  replay.journal.forEach((entry, i) => {
    if (entry.seat !== replay.heroSeat) return
    if (entry.kind === 'blind' || entry.kind === 'straddle' || entry.kind === 'ante') return
    if (entry.kind === 'discard') return
    out.push(i)
  })
  return out
}

/** Fresh seats at the stacks the hand started with, personas carried over. */
function seatsFor(replay: HandReplay, live: readonly Seat[]): Seat[] {
  return live.map((seat) => {
    const stored = replay.seats.find((s) => s.seat === seat.seat)
    return { ...seat, stack: stored?.startingStack ?? seat.stack, sittingOut: !stored }
  })
}

/**
 * Deal the hand as it was dealt, with an unknown future.
 *
 * Hole cards are written in rather than dealt, because stacking a shoe to
 * produce a known deal means reproducing the order cards go out in — which is
 * a detail of `dealHand` that this module has no business knowing. The shoe is
 * then loaded with the board that is already known, followed by the rest of
 * the deck shuffled for this trial.
 */
function setUp(replay: HandReplay, seats: Seat[], knownBoard: Card[], rng: Rng) {
  const state = createHand({
    handNumber: replay.handNumber,
    seats,
    order: replay.seats.map((s) => s.seat),
    buttonSeat: replay.buttonSeat,
    variant: replay.variant,
    bombGame: replay.bombGame,
    bombReason: null,
  })

  for (const stored of replay.seats) {
    if (stored.straddle > 0 && state.phase === 'straddles') {
      addStraddle(state, seats, stored.seat)
    }
  }
  if (state.phase === 'straddles') state.phase = 'street'

  const hole = new Map(
    replay.seats.map((s) => [
      s.seat,
      // Crazy Pineapple: the third card was pitched, so it is back in the deck.
      parseCards(s.hole),
    ]),
  )
  const known = [...hole.values()].flat()
  const rest = shuffle(
    makeDeck().filter((c) => ![...known, ...knownBoard].some((k) => k.rank === c.rank && k.suit === c.suit)),
    rng,
  )

  /*
   * Burns are interleaved because `advanceStreet` draws one before every
   * street. Taking them from the shuffled remainder rather than from a fixed
   * pool keeps each trial's deck a real deck.
   */
  const tail = [...knownBoard]
  let next = 0
  while (tail.length < 5) tail.push(rest[next++])
  const ordered: Card[] = [
    rest[next++], tail[0], tail[1], tail[2],
    rest[next++], tail[3],
    rest[next++], tail[4],
    ...rest.slice(next),
  ]

  dealHand(state, seats, new Shoe(rng))
  for (const [seat, cards] of hole) state.players[seat].hole = [...cards]
  // Bomb pots deal their flop during `dealHand`, so it is replaced rather than
  // waited for.
  if (state.board.length > 0) state.board = tail.slice(0, state.board.length)

  return { state, shoe: new Shoe(rng, [...ordered].reverse()) }
}

/** Replay the journal up to `at`, so the alternative starts from the real spot. */
function fastForward(
  state: HandState,
  seats: Seat[],
  replay: HandReplay,
  at: number,
  shoe: Shoe,
  rng: Rng,
): boolean {
  for (let i = 0; i < at; i++) {
    const entry = replay.journal[i]
    if (entry.kind === 'blind' || entry.kind === 'straddle' || entry.kind === 'ante') continue

    // Catch up to the street this entry belongs to.
    let guard = 0
    while (state.street !== entry.street && guard++ < 6) {
      if (state.phase === 'discard') {
        for (const seat of [...state.pendingDiscards]) decideDiscard(state, seat, rng)
        continue
      }
      if (state.phase !== 'street') return false
      advanceStreet(state, shoe)
    }
    if (state.phase === 'discard') {
      for (const seat of [...state.pendingDiscards]) decideDiscard(state, seat, rng)
    }
    if (entry.kind === 'discard') continue
    if (state.phase !== 'acting' || state.actingSeat !== entry.seat) return false

    const kind = entry.kind as Action['kind']
    const action: Action = kind === 'bet' || kind === 'raise'
      ? { kind, amount: entry.to }
      : { kind }
    try {
      applyAction(state, seats, entry.seat, action)
    } catch {
      return false
    }
  }
  return true
}

/**
 * Play the rest of the hand out with the bots answering.
 *
 * `botTrials` caps how hard each bot thinks. Left at their own setting, a
 * single exploration runs tens of thousands of Monte Carlo trials — the bots
 * sample the future inside a function that is already sampling the future, and
 * the outer sampling is the one that decides the answer. Thinking less per
 * hand and playing more hands buys far more precision for the same time.
 */
function finish(
  state: HandState,
  seats: Seat[],
  shoe: Shoe,
  rng: Rng,
  tableSeats: number[],
  botTrials: number,
) {
  const reads = emptyReads()
  for (let guard = 0; guard < 400 && !state.complete; guard++) {
    switch (state.phase) {
      case 'acting': {
        const seat = state.actingSeat!
        state.players[seat]
        applyAction(state, seats, seat, decideAction({ state, seats, seat, rng, reads, trials: botTrials }))
        break
      }
      case 'discard': {
        for (const seat of [...state.pendingDiscards]) decideDiscard(state, seat, rng)
        break
      }
      case 'street':
        advanceStreet(state, shoe)
        break
      case 'showdown':
        resolveShowdown(state, seats, { dexterCount: 0, tableSeats })
        break
      default:
        // A Dexter show is a house formality with no money in it here.
        state.complete = true
        break
    }
  }
}

function summarise(results: number[]): Outcome {
  const n = results.length
  if (n === 0) return { mean: 0, margin: Infinity, aheadShare: 0, best: 0, worst: 0, trials: 0 }
  const mean = results.reduce((s, v) => s + v, 0) / n
  const variance = n > 1
    ? results.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0
  return {
    mean,
    margin: n > 1 ? 1.96 * Math.sqrt(variance / n) : Infinity,
    aheadShare: results.filter((v) => v > 0).length / n,
    best: Math.max(...results),
    worst: Math.min(...results),
    trials: n,
  }
}

/** Two outcomes are distinguishable when their bands do not overlap. */
function apart(a: Outcome, b: Outcome): boolean {
  if (!Number.isFinite(a.margin) || !Number.isFinite(b.margin)) return false
  return Math.abs(a.mean - b.mean) > a.margin + b.margin
}

export interface ExploreOptions {
  trials?: number
  /** Monte Carlo trials each bot spends on a decision inside a trial. */
  botTrials?: number
  rng?: Rng
}

/**
 * How hard the bots think inside an exploration.
 *
 * Far below their own 60-to-340, and the cost of that is measured at the top
 * of this file rather than waved away: it flatters your line by roughly 10 to
 * 25 per cent, because opponents who think less lose more. Kept because the
 * alternative is a feature nobody waits for.
 */
export const BOT_TRIALS = 40

/**
 * Play each alternative out many times and report what it was worth.
 *
 * `live` supplies the personas: a replay stores names and stacks but not how
 * anybody plays, and re-simulating against default bots would answer a
 * question about a table that was not there.
 *
 * Returns null when the spot cannot be rebuilt — a hand with no replay, a
 * decision index that is not the hero's, or a journal the engine will not
 * accept back. A wrong answer here is worse than none.
 */
export function explore(
  replay: HandReplay,
  live: readonly Seat[],
  at: number,
  alternatives: { action: Action; label: string }[],
  options: ExploreOptions = {},
): Exploration | null {
  const entry = replay.journal[at]
  if (!entry || entry.seat !== replay.heroSeat) return null

  const trials = Math.max(MINIMUM_TRIALS, options.trials ?? DEFAULT_TRIALS)
  const rng = options.rng ?? Math.random
  const knownBoard = parseCards(replay.board).slice(0, boardSizeFor(entry.street, replay.variant))
  const tableSeats = replay.seats.map((s) => s.seat)

  const played: Action = entry.kind === 'bet' || entry.kind === 'raise'
    ? { kind: entry.kind, amount: entry.to }
    : { kind: entry.kind as Action['kind'] }

  const run = (action: Action): number[] => {
    const results: number[] = []
    for (let t = 0; t < trials; t++) {
      const seats = seatsFor(replay, live)
      const { state, shoe } = setUp(replay, seats, knownBoard, rng)
      if (!fastForward(state, seats, replay, at, shoe, rng)) return []

      if (state.phase !== 'acting' || state.actingSeat !== replay.heroSeat) return []
      const legal = legalActions(state, seats, replay.heroSeat)
      // An alternative the spot does not allow is not an alternative.
      const amount = action.amount !== undefined
        ? Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, action.amount))
        : undefined
      try {
        applyAction(state, seats, replay.heroSeat, { ...action, amount })
      } catch {
        return []
      }

      finish(state, seats, shoe, rng, tableSeats, options.botTrials ?? BOT_TRIALS)
      const before = replay.seats.find((s) => s.seat === replay.heroSeat)?.startingStack ?? 0
      results.push(seats[replay.heroSeat].stack - before)
    }
    return results
  }

  const playedOutcome = summarise(run(played))
  if (playedOutcome.trials === 0) return null

  const lines: Line[] = []
  for (const alternative of alternatives) {
    const results = run(alternative.action)
    if (results.length === 0) continue
    lines.push({ ...alternative, outcome: summarise(results) })
  }

  const all = [playedOutcome, ...lines.map((l) => l.outcome)]
  const separated = all.some((a, i) => all.slice(i + 1).some((b) => apart(a, b)))

  return {
    at,
    street: entry.street,
    played: { action: played, label: 'What you did', outcome: playedOutcome },
    lines,
    separated,
  }
}

/**
 * The lines worth offering at a decision, given what was actually done.
 *
 * Deliberately few. Every extra line is another hundred hands to simulate and
 * another bar whose band overlaps the rest, and a screen of six
 * indistinguishable options teaches nothing that three do not.
 *
 * Amounts are proposals rather than legal moves — `explore` clamps each one to
 * what the spot allowed, so a pot-sized raise in a spot where that is more than
 * anybody has left simply becomes the all-in it would have been.
 */
export function alternativesFor(
  replay: HandReplay,
  at: number,
): { action: Action; label: string }[] {
  const entry = replay.journal[at]
  if (!entry) return []

  const pot = Math.max(entry.pot, 1)
  const raiseTo = Math.max(entry.to * 2, Math.round(pot * 0.75))

  switch (entry.kind) {
    case 'fold':
      return [
        { action: { kind: 'call' }, label: 'Call' },
        { action: { kind: 'raise', amount: raiseTo }, label: 'Raise' },
      ]
    case 'check':
      return [
        { action: { kind: 'bet', amount: Math.round(pot * 0.6) }, label: 'Bet half the pot' },
        { action: { kind: 'bet', amount: pot }, label: 'Bet the pot' },
      ]
    case 'call':
      return [
        { action: { kind: 'fold' }, label: 'Fold' },
        { action: { kind: 'raise', amount: raiseTo }, label: 'Raise' },
      ]
    case 'bet':
    case 'raise':
      return [
        { action: { kind: 'fold' }, label: 'Fold' },
        { action: { kind: 'call' }, label: 'Just call' },
        {
          action: { kind: entry.kind, amount: Math.round(entry.to * 2) },
          label: 'Twice the size',
        },
      ]
    default:
      return []
  }
}
