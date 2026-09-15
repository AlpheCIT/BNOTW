/**
 * The decision explorer, off the main thread.
 *
 * An exploration plays a hand out a hundred-odd times per line, and each of
 * those hands has bots running their own Monte Carlo inside it. Measured, that
 * is several seconds of solid work — not a stall you could get away with on
 * the main thread, and exactly the shape of the X-ray bug that ran a
 * simulation per bot action on an iPad.
 *
 * Nothing here differs from calling `explore` directly. A replay and a set of
 * seats cross as structured clones, which they can because both are plain
 * data — the same property that lets the coach worker exist.
 */

import { mulberry32 } from './cards'
import { explore, type Exploration } from './explore'
import type { HandReplay } from './replay'
import type { Action, Seat } from './types'

export interface ExploreRequest {
  /** Echoed back, so an answer to a spot that has been left can be dropped. */
  id: number
  replay: HandReplay
  seats: Seat[]
  at: number
  alternatives: { action: Action; label: string }[]
  trials: number
  seed: number
}

export type ExploreResponse =
  | { id: number; result: Exploration | null }
  | { id: number; error: string }

self.onmessage = (event: MessageEvent<ExploreRequest>) => {
  const { id, replay, seats, at, alternatives, trials, seed } = event.data
  try {
    // Seeded, so the same spot explored twice gives the same answer. A number
    // that moved every time you opened it would read as noise even where it
    // is not.
    const result = explore(replay, seats, at, alternatives, { trials, rng: mulberry32(seed) })
    ;(self as unknown as Worker).postMessage({ id, result } satisfies ExploreResponse)
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      id,
      error: (error as Error)?.message ?? 'That spot could not be worked out.',
    } satisfies ExploreResponse)
  }
}
