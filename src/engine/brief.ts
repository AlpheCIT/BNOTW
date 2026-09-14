/**
 * Briefs: the facts a narrator is allowed to talk about.
 *
 * Everything in here was computed by the engine — equity by enumeration or
 * simulation, outs by inspection, pot odds by arithmetic. A language model is
 * good at explaining these and bad at producing them, so the brief is the
 * boundary: the model receives numbers and returns prose, and never the other
 * way round. If a fact is not in the brief, the narrator does not know it.
 */

import { money } from './bnotw'
import { cardCode } from './cards'
import { pct, type CoachAdvice } from './coach'
import {
  rating, tendencies, winRate, type PlayerTotals,
} from './playerStats'
import type { HandRecord } from './playerStats'
import type { ActionKind, Street } from './types'

export interface OutsBrief {
  makes: string
  count: number
  byRiver: string
}

/** One decision, with everything known about it at the moment it was faced. */
export interface DecisionBrief {
  kind: 'decision'
  street: Street
  hand: string
  board: string
  madeHand: string | null
  startingHand: { label: string; chen: number; grade: string } | null
  position: string
  opponents: number
  pot: string
  toCall: string
  stack: string
  equity: string
  breakEven: string | null
  callEV: string | null
  outs: OutsBrief[]
  recommendation: {
    action: ActionKind
    amount: string | null
    headline: string
    reasons: string[]
    confidence: 'clear' | 'close'
  }
  /** How the equity figure was arrived at, so the narrator can qualify it. */
  method: string
}

export function decisionBrief(advice: CoachAdvice, position: string): DecisionBrief {
  const facing = advice.toCall > 0
  return {
    kind: 'decision',
    street: advice.street,
    hand: advice.hole.map(cardCode).join(' '),
    board: advice.board.map(cardCode).join(' ') || '(none yet)',
    madeHand: advice.madeLabel,
    startingHand: advice.board.length === 0
      ? {
        label: advice.starting.label,
        chen: advice.starting.chen,
        grade: advice.starting.grade,
      }
      : null,
    position,
    opponents: advice.opponents,
    pot: money(advice.pot),
    toCall: facing ? money(advice.toCall) : 'nothing — it is checked to you',
    stack: money(advice.legal.maxRaiseTo),
    equity: pct(advice.equity.equity),
    breakEven: facing ? pct(advice.breakEven) : null,
    callEV: facing ? money(Math.round(advice.callEV)) : null,
    outs: advice.outs.groups.map((g) => ({
      makes: g.makes,
      count: g.cards.length,
      byRiver: pct(g.byRiver),
    })),
    recommendation: {
      action: advice.recommendation.action,
      amount: advice.recommendation.amount ? money(advice.recommendation.amount) : null,
      headline: advice.recommendation.headline,
      reasons: advice.recommendation.reasons,
      confidence: advice.recommendation.confidence,
    },
    method: advice.equity.exact
      ? 'every remaining runout was counted exactly'
      : `sampled over ${advice.equity.runouts.toLocaleString()} runouts, against opponents ` +
        'holding hands worth playing rather than random cards',
  }
}

// ---------------------------------------------------------------------------

export interface LeakBrief {
  kind: 'leaks'
  handsTracked: number
  decisions: number
  agreement: string
  rating: number
  ratingBand: string
  provisional: boolean
  evIndexPer100: number
  winRate: string
  tendencies: { label: string; value: string; guidance: string; samples: number }[]
  leaks: { name: string; count: number }[]
  byStreet: { street: string; decisions: number; agreement: string; evLost: string }[]
  worstDecisions: {
    street: Street
    hand: string
    action: ActionKind
    recommended: ActionKind
    evLost: string
  }[]
}

/** Everything known about how somebody has been playing. */
export function leakBrief(totals: PlayerTotals, recent: HandRecord[]): LeakBrief {
  const score = rating(totals)
  const results = winRate(totals)

  const worst = recent
    .flatMap((hand) => hand.decisions.map((d) => ({ hand, d })))
    .filter(({ d }) => d.evLost > 0)
    .sort((a, b) => b.d.evLost - a.d.evLost)
    .slice(0, 12)
    .map(({ hand, d }) => ({
      street: d.street,
      hand: hand.hole,
      action: d.action,
      recommended: d.recommended,
      evLost: money(d.evLost),
    }))

  return {
    kind: 'leaks',
    handsTracked: totals.hands,
    decisions: totals.decisions,
    agreement: pct(score.agreement),
    rating: score.value,
    ratingBand: score.band,
    provisional: score.provisional,
    evIndexPer100: Math.round(score.evLossPer100),
    winRate: Number.isFinite(results.margin)
      ? `${results.bbPer100.toFixed(1)} ± ${results.margin.toFixed(1)} bb/100`
      : 'not enough hands to say',
    tendencies: tendencies(totals)
      .filter((t) => t.value !== null)
      .map((t) => ({
        label: t.label,
        value: t.format === 'percent' ? pct(t.value!) : t.value!.toFixed(2),
        guidance: t.format === 'percent'
          ? `${pct(t.target[0])}–${pct(t.target[1])}`
          : `${t.target[0].toFixed(2)}–${t.target[1].toFixed(2)}`,
        samples: t.samples,
      })),
    leaks: Object.entries(totals.leaks)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    byStreet: ['preflop', 'flop', 'turn', 'river']
      .filter((s) => totals.byStreet[s])
      .map((street) => {
        const row = totals.byStreet[street]
        return {
          street,
          decisions: row.decisions,
          agreement: pct(row.agreed / row.decisions),
          evLost: money(row.evLost),
        }
      }),
    worstDecisions: worst,
  }
}
