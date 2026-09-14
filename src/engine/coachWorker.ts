/**
 * The coach's arithmetic, off the main thread.
 *
 * `advise` runs a Monte Carlo over several thousand hand evaluations. Measured
 * on a development machine it took a median of 253 ms pre-flop and up to
 * 435 ms, once per decision, synchronously — which on a phone is a visible
 * stall between your turn arriving and anything appearing, every single time.
 *
 * Nothing here is different from calling `advise` directly. The state crosses
 * as a structured clone, which it can because a hand is plain data: cards are
 * `{rank, suit}`, players a record of numbers and booleans, and no part of it
 * is a class instance or a function.
 */

import { mulberry32 } from './cards'
import { advise } from './coach'
import type { CoachAdvice } from './coach'
import type { HandState, Seat } from './types'

export interface AdviceRequest {
  /** Echoed back, so a late answer to a spot that has passed can be dropped. */
  id: number
  hand: HandState
  seats: Seat[]
  seat: number
  trials: number
  seed: number
}

export type AdviceResponse =
  | { id: number; advice: CoachAdvice }
  | { id: number; error: string }

self.onmessage = (event: MessageEvent<AdviceRequest>) => {
  const { id, hand, seats, seat, trials, seed } = event.data
  try {
    // Seeded rather than Math.random so the same request twice gives the same
    // answer — which makes a reported spot reproducible.
    const advice = advise(hand, seats, seat, mulberry32(seed), trials)
    ;(self as unknown as Worker).postMessage({ id, advice } satisfies AdviceResponse)
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      id,
      error: (error as Error)?.message ?? 'The coach could not work that spot out.',
    } satisfies AdviceResponse)
  }
}
