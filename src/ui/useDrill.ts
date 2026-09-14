/**
 * Drill mode state.
 *
 * The one thing worth knowing about this hook: it deals the *next* spot while
 * you are still reading the verdict on the current one. Generating a spot
 * means playing a whole hand through the engine and then running the coach
 * over it — around a second on a phone for a river spot — and a drill that
 * pauses for a second between questions is a drill nobody finishes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { reviewDecision, type DecisionReview } from '../engine/coach'
import { nextSpot, type DrillSpot } from '../engine/drill'
import type { Persona } from '../engine/persona'
import type { PlayerTotals } from '../engine/playerStats'
import type { Action } from '../engine/types'
import {
  emptyDrillStats, loadDrillStats, saveDrillStats, type DrillStats,
} from '../state/storage'

export interface DrillApi {
  spot: DrillSpot | null
  review: DecisionReview | null
  /** True while the first spot of a session is being dealt. */
  loading: boolean
  /** Set when the generator could not find a spot at all. */
  failed: boolean
  stats: DrillStats
  answer: (action: Action) => void
  next: () => void
  reset: () => void
}

export function useDrill(
  opponents: Persona[],
  totals: PlayerTotals,
  playerName: string,
  active: boolean,
): DrillApi {
  const [spot, setSpot] = useState<DrillSpot | null>(null)
  const [review, setReview] = useState<DecisionReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [stats, setStats] = useState<DrillStats>(() => loadDrillStats())

  // The spot after this one, dealt early and waiting.
  const queued = useRef<DrillSpot | null>(null)
  // Generation is synchronous and slow; this stops two from overlapping.
  const dealing = useRef(false)

  const options = { opponents, playerName, trials: 1200 }
  const optionsRef = useRef(options)
  optionsRef.current = options
  const totalsRef = useRef(totals)
  totalsRef.current = totals

  /**
   * Deal into the queue, yielding to the browser first.
   *
   * Without the timeout this runs inside the click that asked for it, and the
   * verdict the player is waiting to see does not paint until the next spot
   * has finished generating — which is exactly backwards.
   */
  const fill = useCallback(() => {
    if (queued.current || dealing.current) return
    dealing.current = true
    setTimeout(() => {
      try {
        queued.current = nextSpot(totalsRef.current, Math.random, optionsRef.current)
      } finally {
        dealing.current = false
      }
    }, 0)
  }, [])

  const take = useCallback(() => {
    const ready = queued.current
    queued.current = null
    if (ready) {
      setSpot(ready)
      setReview(null)
      setFailed(false)
      fill()
      return true
    }
    return false
  }, [fill])

  // Deal the opening spot when the tab is opened, not before: generating one
  // costs real work and nobody asked for it until now.
  useEffect(() => {
    if (!active || spot) return
    if (take()) return
    setLoading(true)
    const timer = setTimeout(() => {
      const first = nextSpot(totalsRef.current, Math.random, optionsRef.current)
      setSpot(first)
      setFailed(first === null)
      setLoading(false)
      if (first) fill()
    }, 0)
    return () => clearTimeout(timer)
  }, [active, spot, take, fill])

  const answer = useCallback((action: Action) => {
    if (!spot || review) return
    const verdict = reviewDecision(spot.advice, action)
    setReview(verdict)

    setStats((prev) => {
      const street = prev.byStreet[spot.street] ?? { spots: 0, agreed: 0, evLost: 0 }
      const streak = verdict.agreed ? prev.streak + 1 : 0
      const next: DrillStats = {
        ...prev,
        spots: prev.spots + 1,
        agreed: prev.agreed + (verdict.agreed ? 1 : 0),
        evLost: prev.evLost + verdict.evLost,
        streak,
        bestStreak: Math.max(prev.bestStreak, streak),
        byStreet: {
          ...prev.byStreet,
          [spot.street]: {
            spots: street.spots + 1,
            agreed: street.agreed + (verdict.agreed ? 1 : 0),
            evLost: street.evLost + verdict.evLost,
          },
        },
      }
      saveDrillStats(next)
      return next
    })

    // The player is about to read; use the time.
    fill()
  }, [spot, review, fill])

  const next = useCallback(() => {
    if (take()) return
    setLoading(true)
    setTimeout(() => {
      const dealt = nextSpot(totalsRef.current, Math.random, optionsRef.current)
      setSpot(dealt)
      setReview(null)
      setFailed(dealt === null)
      setLoading(false)
      if (dealt) fill()
    }, 0)
  }, [take, fill])

  const reset = useCallback(() => {
    const fresh = emptyDrillStats()
    setStats(fresh)
    saveDrillStats(fresh)
  }, [])

  return { spot, review, loading, failed, stats, answer, next, reset }
}
