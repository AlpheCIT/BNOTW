/**
 * What am I consistently bad at?
 *
 * The app could already tell you whether one decision was good or bad. This
 * answers the more useful question, and it answers it from the engine's own
 * arithmetic rather than from a model's opinion — nothing here needs a network
 * connection, an API key or anybody's judgement but the coach's own.
 *
 * ### Three things this is careful about
 *
 * **Not every mistake can be priced.** Four of the coach's seven leaks carry
 * no EV figure at all, because their cost genuinely is not computable: what it
 * costs to check a hand you should have bet depends on what your opponent
 * would have done with the bet, and the engine does not know. Those leaks are
 * real and frequent and worth fixing, so a report that ranked purely on money
 * would bury them at zero. They are marked rather than dropped.
 *
 * **A grade is not a result.** Every score here comes from decision quality —
 * whether the play matched the coach and what the gap cost — and never from
 * whether the hand won. That is the same reason the rating exists: results are
 * too noisy to learn from, and a grading system built on them would teach you
 * to feel good about bad calls that got there.
 *
 * **A trend in results is noise; a trend in accuracy is not.** Comparing your
 * last hundred hands' *winnings* to the previous hundred tells you almost
 * nothing — the confidence band on a hundred hands is wider than any real
 * change in skill. So the trend here is decision quality, which settles far
 * sooner, and the function refuses to report at all below a usable sample.
 */

import { BIG_BLIND } from './bnotw'
import type { HandRecord, PlayerTotals, DecisionRecord } from './playerStats'
import type { Street } from './types'

/** Cents as big blinds, which is how poker mistakes are usually talked about. */
export function bb(cents: number): number {
  return cents / BIG_BLIND
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export type Severity = 'minor' | 'moderate' | 'major'

/**
 * Where the bands sit, in big blinds.
 *
 * Judgement, not measurement. Under a big blind is the sort of gap that is
 * within the coach's own error; past four is the sort that decides a session.
 * They exist so that a report can put an expensive habit above a frequent one,
 * and nothing depends on them being exactly right.
 */
export const SEVERITY_BB: Record<'moderate' | 'major', number> = {
  moderate: 1,
  major: 4,
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  major: 'Major',
}

/** How bad one slip was. Null when nothing measurable was given up. */
export function severityOf(evLostCents: number): Severity | null {
  if (evLostCents <= 0) return null
  const lost = bb(evLostCents)
  if (lost >= SEVERITY_BB.major) return 'major'
  if (lost >= SEVERITY_BB.moderate) return 'moderate'
  return 'minor'
}

/**
 * The leaks the coach can actually put a price on.
 *
 * Both are the same kind of mistake — paying the wrong price — which is the
 * one case where the engine already knows the expected value of the call it is
 * comparing against. Everything else is a mistake about *which* action to
 * take, and pricing that needs a model of what the opponents would have done
 * next. Checked by test against what `reviewDecision` really produces.
 */
export const PRICED_LEAKS = ['Called too light', 'Folded a good price']

export function isPriced(leak: string): boolean {
  return PRICED_LEAKS.includes(leak)
}

// ---------------------------------------------------------------------------
// Grading a decision, a street, a hand
// ---------------------------------------------------------------------------

export type Letter = 'A' | 'B' | 'C' | 'D' | 'F'

export interface Grade {
  letter: Letter
  /** 0 to 1. The letter is a band of this. */
  score: number
  decisions: number
}

/**
 * How much a priced mistake has to cost to score zero, in big blinds.
 *
 * Past this the grade cannot get any worse, which is deliberate: one
 * catastrophic call in a session should not be able to drag ten good hands
 * below failing, because the point of a grade is to be read across hands.
 */
const ZERO_AT_BB = 6

/**
 * What one decision is worth, from 0 to 1.
 *
 * Matching the coach scores 1. Departing from it scores at most a half, even
 * when nothing measurable was given up — because a mistake nobody can price is
 * still a mistake, and scoring it 1 would make three of the most common leaks
 * invisible to every grade in the app.
 */
export function scoreDecision(decision: DecisionRecord): number {
  if (decision.agreed) return 1
  const lost = bb(Math.max(0, decision.evLost))
  return Math.max(0, 0.5 - (lost / ZERO_AT_BB) * 0.5)
}

/** Where each letter starts. Judgement, and generous at the top on purpose. */
const BANDS: [Letter, number][] = [
  ['A', 0.9], ['B', 0.78], ['C', 0.62], ['D', 0.45], ['F', 0],
]

export function letterFor(score: number): Letter {
  return BANDS.find(([, floor]) => score >= floor)?.[0] ?? 'F'
}

/**
 * Grade a set of decisions.
 *
 * Returns null for none at all rather than an A, which is what an average over
 * an empty list would quietly produce — and folding every hand would then be
 * a perfect session.
 */
export function gradeDecisions(decisions: readonly DecisionRecord[]): Grade | null {
  if (decisions.length === 0) return null
  const score = decisions.reduce((sum, d) => sum + scoreDecision(d), 0) / decisions.length
  return { letter: letterFor(score), score, decisions: decisions.length }
}

export interface HandGrade {
  overall: Grade
  byStreet: Partial<Record<Street, Grade>>
}

/**
 * Grade one hand, street by street.
 *
 * Coarse by nature: a hand with one decision in it grades that decision and
 * nothing else, so a single letter on a single hand says very little. It is
 * useful for finding the hand worth replaying, and the honest place to read
 * decision quality is still the running totals.
 */
export function gradeHand(hand: HandRecord): HandGrade | null {
  const overall = gradeDecisions(hand.decisions)
  if (!overall) return null

  const byStreet: Partial<Record<Street, Grade>> = {}
  for (const street of ['preflop', 'flop', 'turn', 'river'] as Street[]) {
    const here = hand.decisions.filter((d) => d.street === street)
    const grade = gradeDecisions(here)
    if (grade) byStreet[street] = grade
  }
  return { overall, byStreet }
}

// ---------------------------------------------------------------------------
// The leak report
// ---------------------------------------------------------------------------

export interface LeakRow {
  leak: string
  count: number
  /** Cents given up. Zero for a leak whose cost cannot be computed. */
  evLost: number
  bbLost: number
  /** Whether a cost could be measured at all, or it is simply unknown. */
  priced: boolean
  /** Typical severity of one instance. Null when unpriced. */
  severity: Severity | null
  /** This leak's share of everything measurably given up. */
  share: number
}

/**
 * What is actually costing you, worst first.
 *
 * Priced leaks sort ahead of unpriced ones and by money within that, which is
 * the ranking the question "what should I fix first" wants. Unpriced leaks
 * follow by frequency rather than being dropped: "you check hands you should
 * bet, forty times" is a real finding even though nobody can say what it cost.
 */
export function leakReport(totals: PlayerTotals): LeakRow[] {
  const measured = Object.values(totals.leakCost ?? {}).reduce((sum, v) => sum + v, 0)

  return Object.entries(totals.leaks)
    .map(([leak, count]): LeakRow => {
      const evLost = totals.leakCost?.[leak] ?? 0
      return {
        leak,
        count,
        evLost,
        bbLost: bb(evLost),
        priced: isPriced(leak),
        severity: count > 0 ? severityOf(evLost / count) : null,
        share: measured > 0 ? evLost / measured : 0,
      }
    })
    .sort((a, b) => {
      if (a.priced !== b.priced) return a.priced ? -1 : 1
      if (b.evLost !== a.evLost) return b.evLost - a.evLost
      return b.count - a.count
    })
}

// ---------------------------------------------------------------------------
// Are you getting better?
// ---------------------------------------------------------------------------

export interface Window {
  hands: number
  decisions: number
  /** Share of decisions that matched the coach. */
  accuracy: number
  /** Cents given up per hundred decisions. */
  evLostPer100: number
}

export interface Trend {
  recent: Window
  previous: Window
  /** Change in accuracy, positive for improving. */
  accuracyChange: number
  /** Change in EV given up per hundred, negative for improving. */
  costChange: number
  /** Whether both windows carry enough decisions to be worth comparing. */
  enough: boolean
}

/** Decisions needed in each window before a comparison means anything. */
export const TREND_MINIMUM = 40

function windowOf(hands: readonly HandRecord[]): Window {
  const decisions = hands.flatMap((h) => h.decisions)
  const agreed = decisions.filter((d) => d.agreed).length
  const cost = decisions.reduce((sum, d) => sum + d.evLost, 0)
  return {
    hands: hands.length,
    decisions: decisions.length,
    accuracy: decisions.length > 0 ? agreed / decisions.length : 0,
    evLostPer100: decisions.length > 0 ? (cost / decisions.length) * 100 : 0,
  }
}

/**
 * The last `size` hands against the `size` before them.
 *
 * On decision quality, never on money. A hundred hands of results is so noisy
 * that the confidence band swamps any change a person could actually make in
 * that time, so "up 8 bb/100 this week" would be a coin flip presented as
 * progress. Accuracy and expected value given up settle far sooner.
 *
 * `hands` is expected newest first, which is the order the tracker holds them.
 * Returns null when there are not two windows to compare, rather than
 * comparing a full window against a nearly empty one.
 */
export function trend(hands: readonly HandRecord[], size = 100): Trend | null {
  if (hands.length < size * 2) return null
  const recent = windowOf(hands.slice(0, size))
  const previous = windowOf(hands.slice(size, size * 2))

  return {
    recent,
    previous,
    accuracyChange: recent.accuracy - previous.accuracy,
    costChange: recent.evLostPer100 - previous.evLostPer100,
    enough: recent.decisions >= TREND_MINIMUM && previous.decisions >= TREND_MINIMUM,
  }
}
