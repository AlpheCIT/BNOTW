/**
 * The coach's verdict for the spot in front of you, worked out in the
 * background.
 *
 * Two things this has to get right.
 *
 * **Staleness.** The table moves. An answer that arrives after you have acted
 * describes a spot that no longer exists, and showing it would be worse than
 * showing nothing — so every request carries an id and anything that is not
 * the current one is dropped.
 *
 * **Always having an answer.** Tracking your decisions needs the advice at the
 * moment you act, not a moment later. So the spot is worked out as soon as it
 * appears, while you are still reading it, and `now()` falls back to computing
 * on the spot if you act before it lands. In practice you are reading for
 * longer than it takes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { advise, type CoachAdvice } from '../engine/coach'
import type { AdviceRequest, AdviceResponse } from '../engine/coachWorker'
import type { HandState, Seat } from '../engine/types'

export interface AdviceApi {
  advice: CoachAdvice | null
  /** True while a spot is being worked out and there is nothing to show yet. */
  pending: boolean
  /**
   * The advice for the current spot, computed here and now if the background
   * answer has not arrived. Never null while it is your turn.
   */
  now: () => CoachAdvice | null
}

/** One worker for the whole app; spinning one up per spot would cost more than it saves. */
let shared: Worker | null = null
let failed = false

function worker(): Worker | null {
  if (failed) return null
  if (shared) return shared
  try {
    shared = new Worker(new URL('../engine/coachWorker.ts', import.meta.url), { type: 'module' })
    return shared
  } catch {
    // No worker support, or a bundler that could not produce one. The
    // main-thread path below still answers, just less smoothly.
    failed = true
    return null
  }
}

export function useAdvice(
  hand: HandState | null,
  seats: Seat[],
  seat: number,
  enabled: boolean,
  trials = 1500,
): AdviceApi {
  const [advice, setAdvice] = useState<CoachAdvice | null>(null)
  const [pending, setPending] = useState(false)
  const latest = useRef(0)

  // What identifies a spot: whose turn, on what street, of which hand, with
  // how much in front of them. Not the engine's version counter, which ticks
  // for things that do not change the decision.
  const key = enabled && hand && hand.phase === 'acting' && hand.actingSeat === seat
    ? `${hand.handNumber}:${hand.street}:${hand.currentBet}:${hand.board.length}`
    : null

  useEffect(() => {
    if (!key || !hand) {
      setAdvice(null)
      setPending(false)
      return
    }

    const id = ++latest.current
    setAdvice(null)
    setPending(true)

    const w = worker()
    if (!w) {
      // Yield first, so the spot paints before the main thread is tied up.
      const timer = setTimeout(() => {
        if (latest.current !== id) return
        setAdvice(advise(hand, seats, seat, Math.random, trials))
        setPending(false)
      }, 0)
      return () => clearTimeout(timer)
    }

    const onMessage = (event: MessageEvent<AdviceResponse>) => {
      if (event.data.id !== id || latest.current !== id) return
      if ('advice' in event.data) setAdvice(event.data.advice)
      setPending(false)
    }
    w.addEventListener('message', onMessage)
    w.postMessage({
      id, hand, seats, seat, trials,
      seed: Math.floor(Math.random() * 2 ** 31),
    } satisfies AdviceRequest)

    return () => w.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, trials])

  const now = useCallback((): CoachAdvice | null => {
    if (advice) return advice
    if (!hand || hand.phase !== 'acting' || hand.actingSeat !== seat) return null
    // Acted before the background answer landed. Fewer trials, because this one
    // is being waited on: a rougher number now beats a sharper one too late.
    return advise(hand, seats, seat, Math.random, Math.min(trials, 700))
  }, [advice, hand, seats, seat, trials])

  return { advice, pending, now }
}
