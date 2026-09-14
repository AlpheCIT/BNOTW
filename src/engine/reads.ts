/**
 * What the bots have noticed about each other, and about you.
 *
 * Without this every bot plays the same fixed strategy forever, and one fixed
 * counter-strategy beats the whole table for as long as you care to sit there.
 * It is also why the top of the skill ladder had nothing left to express:
 * beating a player who calls too much means value-betting far wider than
 * standard, and no profile could do that without first knowing who calls too
 * much.
 *
 * Deliberately only things anyone at the table can see. Nothing here looks at
 * a hole card — a bot that read cards would not be a better player, it would
 * be a cheat, and the numbers it produced would teach you nothing.
 */

export interface SeatRead {
  /** Decisions faced with a bet in front of them. */
  faced: number
  folded: number
  /** Chances to bet or raise — checked to, or facing a bet with raise legal. */
  chances: number
  aggressive: number
}

export type Reads = Map<number, SeatRead>

/**
 * How many observations before a read is trusted at all.
 *
 * Low enough to matter inside a single session, high enough that one folded
 * hand does not brand somebody a nit. Reads are scaled smoothly up to this,
 * so there is no cliff where a bot suddenly changes personality.
 */
export const READ_CONFIDENCE_AT = 20

/** Fold-to-bet rate taken as ordinary. Above it is a nit, below it a station. */
export const NEUTRAL_FOLD_RATE = 0.4

/** Bet-or-raise rate taken as ordinary. */
export const NEUTRAL_AGGRESSION = 0.3

export function emptyReads(): Reads {
  return new Map()
}

function seatRead(reads: Reads, seat: number): SeatRead {
  let read = reads.get(seat)
  if (!read) {
    read = { faced: 0, folded: 0, chances: 0, aggressive: 0 }
    reads.set(seat, read)
  }
  return read
}

/**
 * Record one action.
 *
 * `facingBet` has to be worked out before the action is applied, since
 * applying it is what changes whether there was a bet to face.
 */
export function noteAction(
  reads: Reads,
  seat: number,
  kind: string,
  facingBet: boolean,
  canRaise: boolean,
): void {
  const read = seatRead(reads, seat)

  if (facingBet) {
    read.faced++
    if (kind === 'fold') read.folded++
    if (canRaise) {
      read.chances++
      if (kind === 'raise') read.aggressive++
    }
    return
  }

  // Checked to: betting was the alternative to checking.
  read.chances++
  if (kind === 'bet') read.aggressive++
}

export interface Read {
  /** How often they fold when there is a bet in front of them. */
  foldRate: number
  /** How often they take the aggressive option when it is available. */
  aggression: number
  /**
   * 0 to 1, over whichever of the two measures has been seen most. Anything
   * derived from `aggression` should be scaled by it; `station` already is.
   */
  confidence: number
  /**
   * Negative for someone who folds more than usual, positive for someone who
   * folds less. Already scaled by confidence, so an unknown player reads 0 and
   * every adjustment built on it falls away to nothing.
   */
  station: number
}

export function readFor(reads: Reads | undefined, seat: number): Read {
  const raw = reads?.get(seat)
  if (!raw || (raw.faced === 0 && raw.chances === 0)) {
    return { foldRate: NEUTRAL_FOLD_RATE, aggression: NEUTRAL_AGGRESSION, confidence: 0, station: 0 }
  }

  /*
   * Folding and betting are counted in different situations, so they are
   * trusted separately. A seat that has only ever been checked to has plenty
   * of evidence about how often it bets and none at all about how often it
   * folds — treating those as one number would either throw away the first or
   * invent the second.
   */
  const foldConfidence = Math.min(1, raw.faced / READ_CONFIDENCE_AT)
  const aggressionConfidence = Math.min(1, raw.chances / READ_CONFIDENCE_AT)

  const foldRate = raw.faced > 0 ? raw.folded / raw.faced : NEUTRAL_FOLD_RATE
  const aggression = raw.chances > 0 ? raw.aggressive / raw.chances : NEUTRAL_AGGRESSION

  // Clamped to ±1 so an extreme early sample cannot swing a bot further than
  // a settled one ever would.
  const tilt = (NEUTRAL_FOLD_RATE - foldRate) / NEUTRAL_FOLD_RATE
  return {
    foldRate,
    aggression,
    confidence: Math.max(foldConfidence, aggressionConfidence),
    station: Math.max(-1, Math.min(1, tilt)) * foldConfidence,
  }
}

/** The table's average read, for a pot with several players still in it. */
export function readForMany(reads: Reads | undefined, seats: number[]): Read {
  if (seats.length === 0) return readFor(undefined, -1)
  const each = seats.map((seat) => readFor(reads, seat))
  const mean = (pick: (r: Read) => number) =>
    each.reduce((sum, r) => sum + pick(r), 0) / each.length
  return {
    foldRate: mean((r) => r.foldRate),
    aggression: mean((r) => r.aggression),
    confidence: mean((r) => r.confidence),
    station: mean((r) => r.station),
  }
}
