/**
 * Your own game, tracked hand by hand.
 *
 * Two different things live here, and they are worth keeping straight:
 *
 *   Tendencies — what you *do*. VPIP, pre-flop raise, aggression and the rest
 *     are the standard measures a poker tracker reports. They are descriptive:
 *     there is no such thing as a wrong VPIP, only one that does not match the
 *     way you are trying to play.
 *
 *   Rating — how *well* you do it. This cannot be built on results. Poker
 *     results are so noisy that pinning a win rate down to a few big blinds
 *     per hundred takes tens of thousands of hands, which no home game will
 *     ever produce. It is built on decision quality instead, which is the same
 *     reason chess engines rate a player by accuracy rather than by their
 *     win/loss record: it says far more, far sooner.
 */

import { BIG_BLIND } from './bnotw'
import type { HandReplay } from './replay'
import type { ActionKind, Street } from './types'

export type PlayMode = 'table' | 'coach'

export interface DecisionRecord {
  street: Street
  action: ActionKind
  recommended: ActionKind
  agreed: boolean
  /** Cents of expected value given up against the recommendation. */
  evLost: number
  leak: string | null
}

export interface HandRecord {
  at: number
  /**
   * Why you did what you did, in your own words.
   *
   * The only thing in the record that cannot be rebuilt by playing more, which
   * is why notes are what keep a hand from being trimmed away.
   */
  note?: string
  mode: PlayMode
  handNumber: number
  bomb: boolean
  position: string
  /** Hole cards as short codes, e.g. "As Kh". */
  hole: string
  /** Had a pre-flop round at all, i.e. not a bomb pot. */
  couldStraddle: boolean
  straddled: boolean
  /** Put money in voluntarily pre-flop. */
  vpip: boolean
  /** Raised pre-flop. */
  pfr: boolean
  facedRaise: boolean
  threeBet: boolean
  sawFlop: boolean
  showdown: boolean
  wonShowdown: boolean
  /** Chips won or lost across the hand. */
  net: number
  /** Post-flop bets and raises. */
  aggressive: number
  /** Post-flop calls. */
  passive: number
  dexterHeld: boolean
  dexterWon: boolean
  decisions: DecisionRecord[]
  /**
   * Everything needed to replay the hand. Dropped from older records to keep
   * the history storable — the counters never depend on it.
   */
  replay?: HandReplay
}

/**
 * Running counters. These are never truncated, so the numbers stay correct
 * however many old hands get dropped from the stored history.
 */
export interface PlayerTotals {
  version: 1
  hands: number
  handsByMode: Record<PlayMode, number>
  /** Hands with a pre-flop decision, i.e. everything but a bomb pot. */
  preflopHands: number
  vpip: number
  pfr: number
  facedRaise: number
  threeBet: number
  sawFlop: number
  showdowns: number
  showdownWins: number
  handsWon: number
  aggressive: number
  passive: number
  couldStraddle: number
  straddled: number
  bombHands: number
  bombNet: number
  dexterHeld: number
  dexterWon: number
  net: number
  /** Sum of squares of per-hand results, for the win-rate confidence band. */
  netSq: number
  decisions: number
  agreed: number
  /** Cents of EV given up, and the sum of squares for the standard error. */
  evLost: number
  evLostSq: number
  leaks: Record<string, number>
  byStreet: Record<string, { decisions: number; agreed: number; evLost: number }>
  firstAt: number
  lastAt: number
}

export function emptyTotals(): PlayerTotals {
  return {
    version: 1,
    hands: 0,
    handsByMode: { table: 0, coach: 0 },
    preflopHands: 0,
    vpip: 0,
    pfr: 0,
    facedRaise: 0,
    threeBet: 0,
    sawFlop: 0,
    showdowns: 0,
    showdownWins: 0,
    handsWon: 0,
    aggressive: 0,
    passive: 0,
    couldStraddle: 0,
    straddled: 0,
    bombHands: 0,
    bombNet: 0,
    dexterHeld: 0,
    dexterWon: 0,
    net: 0,
    netSq: 0,
    decisions: 0,
    agreed: 0,
    evLost: 0,
    evLostSq: 0,
    leaks: {},
    byStreet: {},
    firstAt: 0,
    lastAt: 0,
  }
}

export function accumulate(totals: PlayerTotals, hand: HandRecord): PlayerTotals {
  const next: PlayerTotals = {
    ...totals,
    handsByMode: { ...totals.handsByMode },
    leaks: { ...totals.leaks },
    byStreet: { ...totals.byStreet },
  }

  next.hands += 1
  next.handsByMode[hand.mode] += 1
  next.net += hand.net
  next.netSq += hand.net * hand.net
  if (hand.net > 0) next.handsWon += 1
  if (!next.firstAt) next.firstAt = hand.at
  next.lastAt = hand.at

  if (hand.bomb) {
    next.bombHands += 1
    next.bombNet += hand.net
  } else {
    next.preflopHands += 1
    if (hand.vpip) next.vpip += 1
    if (hand.pfr) next.pfr += 1
    if (hand.facedRaise) next.facedRaise += 1
    if (hand.threeBet) next.threeBet += 1
  }

  if (hand.sawFlop) next.sawFlop += 1
  if (hand.showdown) next.showdowns += 1
  if (hand.wonShowdown) next.showdownWins += 1
  next.aggressive += hand.aggressive
  next.passive += hand.passive
  if (hand.couldStraddle) next.couldStraddle += 1
  if (hand.straddled) next.straddled += 1
  if (hand.dexterHeld) next.dexterHeld += 1
  if (hand.dexterWon) next.dexterWon += 1

  for (const d of hand.decisions) {
    next.decisions += 1
    if (d.agreed) next.agreed += 1
    next.evLost += d.evLost
    next.evLostSq += d.evLost * d.evLost
    if (d.leak) next.leaks[d.leak] = (next.leaks[d.leak] ?? 0) + 1
    const street = next.byStreet[d.street] ?? { decisions: 0, agreed: 0, evLost: 0 }
    next.byStreet[d.street] = {
      decisions: street.decisions + 1,
      agreed: street.agreed + (d.agreed ? 1 : 0),
      evLost: street.evLost + d.evLost,
    }
  }

  return next
}

/**
 * Take a hand back out of the totals.
 *
 * The exact inverse of `accumulate`, needed because the counters are running
 * totals rather than something derived from the stored hands: they are kept
 * that way precisely so that trimming old hands does not change your VPIP, so
 * deleting a hand has to subtract it rather than recount what is left.
 *
 * Two things are deliberately not perfectly reversible:
 *
 *   `firstAt` and `lastAt` are a minimum and a maximum, and neither can be
 *     recovered by subtraction — the new boundary lives in some other hand,
 *     which may not even be in memory. They are left alone, except when the
 *     last hand goes and the whole window is meaningless. The window is only
 *     ever too wide, never too narrow, and it feeds the "playing since" line
 *     rather than any rate.
 *
 *   Every counter is clamped at zero. It should never be reachable — a hand
 *     can only be removed after it was added — but a record that has been
 *     through an import, a failed write or an older version of this file is
 *     not something to trust into showing a negative VPIP.
 */
export function unaccumulate(totals: PlayerTotals, hand: HandRecord): PlayerTotals {
  const next: PlayerTotals = {
    ...totals,
    handsByMode: { ...totals.handsByMode },
    leaks: { ...totals.leaks },
    byStreet: { ...totals.byStreet },
  }
  const down = (n: number) => Math.max(0, n - 1)

  next.hands = down(next.hands)
  next.handsByMode[hand.mode] = down(next.handsByMode[hand.mode])
  next.net -= hand.net
  next.netSq = Math.max(0, next.netSq - hand.net * hand.net)
  if (hand.net > 0) next.handsWon = down(next.handsWon)

  if (hand.bomb) {
    next.bombHands = down(next.bombHands)
    next.bombNet -= hand.net
  } else {
    next.preflopHands = down(next.preflopHands)
    if (hand.vpip) next.vpip = down(next.vpip)
    if (hand.pfr) next.pfr = down(next.pfr)
    if (hand.facedRaise) next.facedRaise = down(next.facedRaise)
    if (hand.threeBet) next.threeBet = down(next.threeBet)
  }

  if (hand.sawFlop) next.sawFlop = down(next.sawFlop)
  if (hand.showdown) next.showdowns = down(next.showdowns)
  if (hand.wonShowdown) next.showdownWins = down(next.showdownWins)
  next.aggressive = Math.max(0, next.aggressive - hand.aggressive)
  next.passive = Math.max(0, next.passive - hand.passive)
  if (hand.couldStraddle) next.couldStraddle = down(next.couldStraddle)
  if (hand.straddled) next.straddled = down(next.straddled)
  if (hand.dexterHeld) next.dexterHeld = down(next.dexterHeld)
  if (hand.dexterWon) next.dexterWon = down(next.dexterWon)

  for (const d of hand.decisions) {
    next.decisions = down(next.decisions)
    if (d.agreed) next.agreed = down(next.agreed)
    next.evLost = Math.max(0, next.evLost - d.evLost)
    next.evLostSq = Math.max(0, next.evLostSq - d.evLost * d.evLost)
    if (d.leak) {
      const left = (next.leaks[d.leak] ?? 0) - 1
      // Dropped rather than left at zero: a leak with no instances behind it
      // would still be listed as something you do.
      if (left > 0) next.leaks[d.leak] = left
      else delete next.leaks[d.leak]
    }
    const street = next.byStreet[d.street]
    if (street) {
      const left = {
        decisions: Math.max(0, street.decisions - 1),
        agreed: Math.max(0, street.agreed - (d.agreed ? 1 : 0)),
        evLost: Math.max(0, street.evLost - d.evLost),
      }
      if (left.decisions > 0) next.byStreet[d.street] = left
      else delete next.byStreet[d.street]
    }
  }

  if (next.hands === 0) {
    next.firstAt = 0
    next.lastAt = 0
  }
  return next
}

// ---------------------------------------------------------------------------
// Tendencies
// ---------------------------------------------------------------------------

export interface Tendency {
  key: string
  label: string
  /** Formatted for display, or null when there is not enough data yet. */
  value: number | null
  format: 'percent' | 'ratio'
  samples: number
  /** Rough guidance, not a rule. */
  target: [number, number]
  blurb: string
}

/** Enough of a sample for the number to mean anything at all. */
const MIN_SAMPLES = 20

function rate(numerator: number, denominator: number): number | null {
  return denominator >= MIN_SAMPLES ? numerator / denominator : null
}

/**
 * The standard tracker stats.
 *
 * The target ranges are rough guidance for a six-handed game, not hard rules —
 * treat them as a starting point for a conversation, not a verdict. A friendly
 * live game runs considerably looser than these numbers across the board, and
 * playing looser than "standard" is a choice rather than a mistake so long as
 * you know you are making it.
 */
export function tendencies(totals: PlayerTotals): Tendency[] {
  const af = totals.passive > 0 ? totals.aggressive / totals.passive : null
  return [
    {
      key: 'vpip',
      label: 'VPIP',
      value: rate(totals.vpip, totals.preflopHands),
      format: 'percent',
      samples: totals.preflopHands,
      target: [0.2, 0.32],
      blurb: 'How often you put money in pre-flop. The single best measure of how loose you are.',
    },
    {
      key: 'pfr',
      label: 'Pre-flop raise',
      value: rate(totals.pfr, totals.preflopHands),
      format: 'percent',
      samples: totals.preflopHands,
      target: [0.14, 0.26],
      blurb: 'How often you come in raising rather than calling. Well below your VPIP means you limp a lot.',
    },
    {
      key: 'threeBet',
      label: '3-bet',
      value: rate(totals.threeBet, totals.facedRaise),
      format: 'percent',
      samples: totals.facedRaise,
      target: [0.04, 0.12],
      blurb: 'How often you re-raise a raise. Near zero means you only ever play back with the nuts.',
    },
    {
      key: 'af',
      label: 'Aggression',
      value: totals.passive >= MIN_SAMPLES ? af : null,
      format: 'ratio',
      samples: totals.passive,
      target: [1.5, 3.5],
      blurb: 'Post-flop bets and raises for every call. Under 1 means you are calling far more than betting.',
    },
    {
      key: 'wtsd',
      label: 'Went to showdown',
      value: rate(totals.showdowns, totals.sawFlop),
      format: 'percent',
      samples: totals.sawFlop,
      target: [0.22, 0.34],
      blurb: 'Of the flops you see, how many you take all the way. High means you struggle to fold.',
    },
    {
      key: 'wsd',
      label: 'Won at showdown',
      value: rate(totals.showdownWins, totals.showdowns),
      format: 'percent',
      samples: totals.showdowns,
      target: [0.46, 0.58],
      blurb: 'How often you win once you get there. Low usually means you are showing up with weak hands.',
    },
  ]
}

export interface Observation {
  tone: 'good' | 'watch' | 'bad'
  text: string
}

/** Turn the numbers into something you could act on. */
export function diagnose(totals: PlayerTotals): Observation[] {
  const out: Observation[] = []
  const map = new Map(tendencies(totals).map((t) => [t.key, t]))
  const value = (key: string) => map.get(key)?.value ?? null

  const vpip = value('vpip')
  const pfr = value('pfr')
  if (vpip !== null) {
    if (vpip > 0.45) {
      out.push({ tone: 'bad', text: `You play ${pct(vpip)} of your hands. That is a lot of weak holdings to get out of trouble after the flop.` })
    } else if (vpip < 0.15) {
      out.push({ tone: 'watch', text: `You play only ${pct(vpip)} of hands. Safe, but you are folding away a lot of playable spots in position.` })
    } else {
      out.push({ tone: 'good', text: `A VPIP of ${pct(vpip)} is a sensible range to be selecting from.` })
    }
  }

  if (vpip !== null && pfr !== null && vpip > 0) {
    const limpShare = 1 - pfr / vpip
    if (limpShare > 0.55) {
      out.push({ tone: 'bad', text: `You come in limping about ${pct(limpShare)} of the time you play a hand. Raising instead wins more pots without a showdown.` })
    }
  }

  const af = value('af')
  if (af !== null) {
    if (af < 0.8) {
      out.push({ tone: 'bad', text: `You call ${(1 / af).toFixed(1)} times for every bet or raise. That is a calling station's line — you only win when you have the best hand.` })
    } else if (af > 4.5) {
      out.push({ tone: 'watch', text: `An aggression factor of ${af.toFixed(1)} is very high. Make sure the bets are for value, not just for motion.` })
    }
  }

  const wtsd = value('wtsd')
  const wsd = value('wsd')
  if (wtsd !== null && wtsd > 0.4) {
    out.push({ tone: 'bad', text: `You take ${pct(wtsd)} of your flops to showdown. Somewhere on the turn or river there is a fold you are not making.` })
  }
  if (wsd !== null && wsd < 0.42 && (wtsd ?? 0) > 0.3) {
    out.push({ tone: 'bad', text: `You only win ${pct(wsd)} of the showdowns you reach — you are paying people off.` })
  }

  const leaks = Object.entries(totals.leaks).sort((a, b) => b[1] - a[1])
  if (leaks.length > 0 && totals.decisions >= 40) {
    out.push({ tone: 'watch', text: `Your most common mistake is "${leaks[0][0]}" — ${leaks[0][1]} of ${totals.decisions} decisions.` })
  }

  if (totals.dexterHeld > 0) {
    out.push({
      tone: 'good',
      text: `You have been dealt the Dexter ${totals.dexterHeld} time${totals.dexterHeld === 1 ? '' : 's'} and won with it ${totals.dexterWon}.`,
    })
  }

  return out
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

// ---------------------------------------------------------------------------
// The rating
// ---------------------------------------------------------------------------

/**
 * Calibration, measured rather than chosen.
 *
 * Each bot skill level was played against a fixed field of solid opponents
 * with every one of its decisions scored by the coach, giving the EV it gives
 * up per 100 hands. The same profiles were separately measured head to head
 * for their actual win rate. Putting the two together fixes the scale below,
 * so a rating difference stands for a real difference in how well someone
 * plays rather than being a number that merely goes up.
 *
 * Measured over 800 hands per level (see `calibration.test.ts`, which
 * re-derives this on demand):
 *
 *   skill 1   214.8 EV index    agreement 52%   ->  rating 1049
 *   skill 2    68.3                       73%   ->         1357
 *   skill 3    26.5                       78%   ->         1444
 *   skill 4    30.6                       75%   ->         1436
 *   skill 5     9.3                       75%   ->         1481
 *
 * One number worth keeping in view: the gap in EV index between skill 1 and
 * skill 3 is 188, while their measured win-rate gap is 33 bb/100. The index
 * prices every decision on its own, as though the hand ended there, so it runs
 * about six times larger than the money that actually changes hands. It is a
 * comparative index, not a dollar figure, and the UI says so.
 */
export const RATING_BASE = 1500
/**
 * Rating points per unit of EV index. Set so the gap between a beginner and a
 * solid player lands near 400 points, the spread chess uses for a gap that
 * large.
 */
export const RATING_POINTS_PER_EV = 2.1
/** Below this many scored decisions the rating is a guess, and says so. */
export const PROVISIONAL_DECISIONS = 150

export interface Rating {
  /** The headline number. */
  value: number
  /** Half-width of the confidence band, in rating points. */
  margin: number
  provisional: boolean
  decisions: number
  /** Big blinds of EV given up per 100 hands. */
  evLossPer100: number
  agreement: number
  /** A plain-language band. */
  band: string
}

/**
 * Rating from decision quality.
 *
 * The margin is a real confidence interval, not decoration: it comes from the
 * spread of the per-decision EV losses, so a rating built on thirty hands
 * announces how little it knows.
 */
export function rating(totals: PlayerTotals): Rating {
  const n = totals.decisions
  const handsScored = Math.max(1, totals.hands)
  const evLossPer100 = (totals.evLost / BIG_BLIND / handsScored) * 100
  const value = Math.round(RATING_BASE - evLossPer100 * RATING_POINTS_PER_EV)

  // Standard error of the mean EV loss per decision, carried through the same
  // conversion the rating itself uses.
  let margin = 400
  if (n >= 2) {
    const mean = totals.evLost / n
    const variance = Math.max(0, totals.evLostSq / n - mean * mean)
    const sePerDecision = Math.sqrt(variance / n)
    const decisionsPerHand = n / handsScored
    const seBb = (sePerDecision * decisionsPerHand * 100) / BIG_BLIND
    margin = Math.round(1.96 * seBb * RATING_POINTS_PER_EV)
  }

  return {
    value,
    margin,
    provisional: n < PROVISIONAL_DECISIONS,
    decisions: n,
    evLossPer100,
    agreement: n > 0 ? totals.agreed / n : 0,
    band: ratingBand(value),
  }
}

/** Bands anchored to where the measured bot profiles land. */
export function ratingBand(value: number): string {
  if (value >= 1470) return 'Playing the line'
  if (value >= 1420) return 'Solid'
  if (value >= 1330) return 'Coming along'
  if (value >= 1150) return 'Leaking'
  return 'Paying for lessons'
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface WinRate {
  /** Big blinds won per 100 hands. */
  bbPer100: number
  /** Half-width of the 95% confidence band, in bb/100. */
  margin: number
  hands: number
  net: number
  /** How many hands it would take for the band to narrow to +/- 5 bb/100. */
  handsForConfidence: number
}

/**
 * Your results, with the honesty attached.
 *
 * The margin is the point of this function. Poker results are so noisy that
 * after a few hundred hands the confidence band comfortably spans winning big
 * and losing big, which is exactly why the rating above is not built on them.
 */
export function winRate(totals: PlayerTotals): WinRate {
  const n = totals.hands
  const bbPer100 = n > 0 ? (totals.net / BIG_BLIND / n) * 100 : 0
  if (n < 2) {
    return { bbPer100, margin: Infinity, hands: n, net: totals.net, handsForConfidence: 0 }
  }

  const mean = totals.net / n
  const variance = Math.max(0, totals.netSq / n - mean * mean)
  const sd = Math.sqrt(variance)
  const marginCents = (1.96 * sd) / Math.sqrt(n)
  const margin = (marginCents / BIG_BLIND) * 100

  // n needed so that 1.96 * sd / sqrt(n) is worth 5 bb per 100 hands.
  const targetCents = (5 / 100) * BIG_BLIND
  const handsForConfidence = Math.ceil(((1.96 * sd) / targetCents) ** 2)

  return { bbPer100, margin, hands: n, net: totals.net, handsForConfidence }
}
