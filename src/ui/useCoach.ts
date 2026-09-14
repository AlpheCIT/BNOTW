/**
 * Coach mode state: the X-ray toggle, the running review of your decisions,
 * and the leak report built from them.
 */

import { useCallback, useState } from 'react'
import { reviewDecision, type CoachAdvice, type DecisionReview } from '../engine/coach'
import type { Action } from '../engine/types'
import { emptyCoachStats, loadCoachStats, saveCoachStats, type CoachStats } from '../state/storage'

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
