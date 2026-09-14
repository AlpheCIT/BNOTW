/**
 * Coach mode state: the X-ray toggle, the running review of your decisions,
 * and the leak report built from them.
 */

import { useCallback, useState } from 'react'
import { money } from '../engine/bnotw'
import { pct, type CoachAdvice } from '../engine/coach'
import type { Action } from '../engine/types'
import { emptyCoachStats, loadCoachStats, saveCoachStats, type CoachStats } from '../state/storage'

export interface DecisionReview {
  agreed: boolean
  /** Cents of expected value given up. Zero when the play was fine. */
  evLost: number
  leak: string | null
  message: string
  tone: 'ok' | 'off'
}

export interface CoachApi {
  xray: boolean
  setXray: (on: boolean) => void
  stats: CoachStats
  lastReview: DecisionReview | null
  clearReview: () => void
  record: (advice: CoachAdvice, action: Action) => void
  countHand: () => void
  reset: () => void
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

export function useCoach(): CoachApi {
  const [xray, setXray] = useState(false)
  const [stats, setStats] = useState<CoachStats>(() => loadCoachStats())
  const [lastReview, setLastReview] = useState<DecisionReview | null>(null)

  const persist = useCallback((next: CoachStats) => {
    setStats(next)
    saveCoachStats(next)
  }, [])

  const record = useCallback((advice: CoachAdvice, action: Action) => {
    const review = reviewDecision(advice, action)
    setLastReview(review)
    setStats((prev) => {
      const leaks = { ...prev.leaks }
      if (review.leak) leaks[review.leak] = (leaks[review.leak] ?? 0) + 1
      const next: CoachStats = {
        ...prev,
        decisions: prev.decisions + 1,
        agreed: prev.agreed + (review.agreed ? 1 : 0),
        evLost: prev.evLost + review.evLost,
        leaks,
      }
      saveCoachStats(next)
      return next
    })
  }, [])

  const countHand = useCallback(() => {
    setStats((prev) => {
      const next = { ...prev, handsPlayed: prev.handsPlayed + 1 }
      saveCoachStats(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setLastReview(null)
    persist(emptyCoachStats())
  }, [persist])

  return {
    xray,
    setXray,
    stats,
    lastReview,
    clearReview: () => setLastReview(null),
    record,
    countHand,
    reset,
  }
}
