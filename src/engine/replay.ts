/**
 * Replaying a hand.
 *
 * A finished hand is flattened into a compact record small enough to keep a
 * few hundred of in a browser, then expanded back into a sequence of frames
 * you can step through — the board filling in, chips going in, and what your
 * actual chances were at every point along the way.
 *
 * The equity shown during a replay is not the coach's estimate. Every hand is
 * face up by then, so it is the true number, counted exactly wherever the
 * runout is small enough to enumerate.
 */

import { parseCards, cardCode, type Card, type Rng } from './cards'
import { describeHand, evaluate } from './handEval'
import { showdownEquity, type EquityResult } from './coach'
import type { BombPotGame } from './bnotw'
import type { HandState, JournalEntry, Seat, Street, Variant } from './types'

export interface ReplaySeat {
  seat: number
  name: string
  /** Final hole cards, after any Crazy Pineapple discard. */
  hole: string
  discarded: string | null
  startingStack: number
  folded: boolean
  straddle: number
  /** Chips won across every pot. */
  won: number
}

export interface ReplayAward {
  seat: number
  amount: number
  potLabel: string
  split: boolean
  hand: string | null
}

export interface HandReplay {
  handNumber: number
  variant: Variant
  bombGame: BombPotGame | null
  buttonSeat: number
  heroSeat: number
  smallBlindSeat: number | null
  bigBlindSeat: number | null
  board: string
  seats: ReplaySeat[]
  journal: JournalEntry[]
  awards: ReplayAward[]
  dexter: { seat: number; perPlayer: number; total: number } | null
}

/** Flatten a finished hand into something storable. */
export function buildReplay(state: HandState, seats: Seat[], heroSeat: number): HandReplay {
  return {
    handNumber: state.handNumber,
    variant: state.variant,
    bombGame: state.bombGame,
    buttonSeat: state.buttonSeat,
    heroSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    board: state.board.map(cardCode).join(' '),
    seats: state.order.map((seat) => {
      const p = state.players[seat]
      return {
        seat,
        name: seats[seat]?.name ?? `Seat ${seat + 1}`,
        hole: p.hole.map(cardCode).join(' '),
        discarded: p.discarded ? cardCode(p.discarded) : null,
        startingStack: p.startingStack,
        folded: p.folded,
        straddle: p.straddle,
        won: state.awards.filter((a) => a.seat === seat).reduce((sum, a) => sum + a.amount, 0),
      }
    }),
    journal: state.journal,
    awards: state.awards.map((a) => ({
      seat: a.seat,
      amount: a.amount,
      potLabel: a.potLabel,
      split: a.split,
      hand: a.hand ? describeHand(a.hand) : null,
    })),
    dexter: state.dexter
      ? { seat: state.dexter.seat, perPlayer: state.dexter.perPlayer, total: state.dexter.total }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

/** How many board cards are face up on each street. */
export function boardSizeFor(street: Street, variant: Variant): number {
  // A bomb pot deals the flop before any betting, so its first street is the flop.
  if (variant !== 'holdem' && street === 'preflop') return 3
  switch (street) {
    case 'preflop': return 0
    case 'flop': return 3
    case 'turn': return 4
    default: return 5
  }
}

export interface FrameSeat {
  seat: number
  name: string
  hole: Card[]
  /** Chips in front of them on this street. */
  committed: number
  stack: number
  folded: boolean
  /** Has already pitched a card in Crazy Pineapple. */
  discarded: string | null
  isHero: boolean
  isButton: boolean
}

export interface ReplayFrame {
  index: number
  street: Street
  /** The event that produced this frame; null for the opening deal. */
  entry: JournalEntry | null
  /** A short description of what just happened. */
  caption: string
  board: Card[]
  pot: number
  seats: FrameSeat[]
  /** True once the pots have been awarded. */
  settled: boolean
}

/**
 * Expand a stored hand into the sequence of frames a reader steps through.
 * One frame for the opening deal, one for each recorded event, one for each
 * new street, and a last one for the result.
 */
export function replayFrames(replay: HandReplay): ReplayFrame[] {
  const hole = new Map(replay.seats.map((s) => [s.seat, parseCards(s.hole)]))
  const board = parseCards(replay.board)
  const committed = new Map(replay.seats.map((s) => [s.seat, 0]))
  const paid = new Map(replay.seats.map((s) => [s.seat, 0]))
  const folded = new Set<number>()
  const discarded = new Map<number, string | null>(replay.seats.map((s) => [s.seat, null]))

  // In Crazy Pineapple the discard is only known once it happens, so the third
  // card has to be put back for the frames before it.
  const preDiscard = new Map(
    replay.seats.map((s) => [
      s.seat,
      s.discarded ? [...parseCards(s.hole), ...parseCards(s.discarded)] : parseCards(s.hole),
    ]),
  )

  const frames: ReplayFrame[] = []
  let street: Street = replay.variant === 'holdem' ? 'preflop' : 'flop'
  let pot = 0

  const snapshot = (
    entry: JournalEntry | null,
    caption: string,
    settled = false,
  ): ReplayFrame => ({
    index: frames.length,
    street,
    entry,
    caption,
    board: board.slice(0, boardSizeFor(street, replay.variant)),
    pot,
    settled,
    seats: replay.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      hole: discarded.get(s.seat) ? hole.get(s.seat)! : preDiscard.get(s.seat)!,
      committed: committed.get(s.seat) ?? 0,
      stack: s.startingStack - (paid.get(s.seat) ?? 0),
      folded: folded.has(s.seat),
      discarded: discarded.get(s.seat) ?? null,
      isHero: s.seat === replay.heroSeat,
      isButton: s.seat === replay.buttonSeat,
    })),
  })

  frames.push(snapshot(null, replay.variant === 'holdem' ? 'Cards in the air' : 'Antes posted, flop out'))

  for (const entry of replay.journal) {
    if (entry.street !== street) {
      street = entry.street
      // Reset the street: chips in front go to the middle.
      for (const key of committed.keys()) committed.set(key, 0)
      const dealt = boardSizeFor(street, replay.variant)
      frames.push(snapshot(null, `${streetName(street)}: ${board.slice(dealt - 1, dealt).map(cardCode).join(' ')}`))
    }

    committed.set(entry.seat, entry.to)
    paid.set(entry.seat, (paid.get(entry.seat) ?? 0) + entry.amount)
    pot = entry.pot
    if (entry.kind === 'fold') folded.add(entry.seat)
    if (entry.kind === 'discard') discarded.set(entry.seat, entry.card ?? null)

    frames.push(snapshot(entry, captionFor(entry, nameOf(replay, entry.seat))))
  }

  // Any streets dealt after the last action — an all-in runout.
  while (boardSizeFor(street, replay.variant) < board.length) {
    street = STREETS[STREETS.indexOf(street) + 1]
    const dealt = boardSizeFor(street, replay.variant)
    for (const key of committed.keys()) committed.set(key, 0)
    frames.push(snapshot(null, `${streetName(street)}: ${board.slice(dealt - 1, dealt).map(cardCode).join(' ')}`))
  }

  for (const key of committed.keys()) committed.set(key, 0)
  pot = 0
  const result = replay.awards
    .map((a) => `${nameOf(replay, a.seat)} ${a.split ? 'chops' : 'wins'} ${dollars(a.amount)}${a.hand ? ` with ${a.hand}` : ''}`)
    .join(' · ')
  frames.push(snapshot(null, result || 'Hand over', true))

  return frames
}

function streetName(street: Street): string {
  return street === 'flop' ? 'Flop' : street === 'turn' ? 'Turn' : street === 'river' ? 'River' : 'Pre-flop'
}

function nameOf(replay: HandReplay, seat: number): string {
  return replay.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function captionFor(entry: JournalEntry, who: string): string {
  const amount = dollars(entry.amount)
  const to = dollars(entry.to)
  switch (entry.kind) {
    case 'blind': return `${who} posts ${amount}`
    case 'ante': return `${who} antes ${amount}`
    case 'straddle': return `${who} straddles ${to}`
    case 'discard': return `${who} pitches ${entry.card}`
    case 'fold': return `${who} folds`
    case 'check': return `${who} checks`
    case 'call': return `${who} calls ${amount}${entry.allIn ? ' and is all in' : ''}`
    case 'bet': return `${who} bets ${to}${entry.allIn ? ' and is all in' : ''}`
    default: return `${who} raises to ${to}${entry.allIn ? ' and is all in' : ''}`
  }
}

// ---------------------------------------------------------------------------
// What your chances really were
// ---------------------------------------------------------------------------

export interface FrameEquity {
  bySeat: Map<number, EquityResult>
  exact: boolean
}

/**
 * True equity at a frame, with every hand face up — the number a broadcast
 * would show. Returns null once only one player is left, where it means nothing.
 */
export function frameEquity(frame: ReplayFrame, rng: Rng = Math.random): FrameEquity | null {
  const live = frame.seats.filter((s) => !s.folded && s.hole.length >= 2)
  if (live.length < 2) return null

  // Before the discard a Crazy Pineapple hand has three cards, which is not a
  // holding anyone can be scored on.
  const holdings = live.map((s) => s.hole.slice(0, 2))
  if (live.some((s) => s.hole.length > 2)) return null

  const results = showdownEquity(holdings, frame.board, rng, frame.board.length === 0 ? 1200 : 4000)
  return {
    bySeat: new Map(live.map((s, i) => [s.seat, results[i]])),
    exact: results[0]?.exact ?? false,
  }
}

/** The best five-card hand a seat holds at this frame, once there is a board. */
export function frameHand(frame: ReplayFrame, seat: number): string | null {
  const s = frame.seats.find((x) => x.seat === seat)
  if (!s || s.folded || s.hole.length > 2) return null
  const cards = [...s.hole, ...frame.board]
  return cards.length >= 5 ? describeHand(evaluate(cards)) : null
}
