/**
 * Running an exploration without freezing the app.
 *
 * Deliberately not automatic. An exploration is seconds of real work, so it
 * happens when asked for and not on every frame you step past — the opposite
 * of the coach's advice, which is computed ahead of you because you are about
 * to need it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { explore, DEFAULT_TRIALS, type Exploration } from '../engine/explore'
import type { ExploreRequest, ExploreResponse } from '../engine/exploreWorker'
import type { HandReplay } from '../engine/replay'
import type { Action, Seat } from '../engine/types'

let shared: Worker | null | undefined

function worker(): Worker | null {
  if (shared !== undefined) return shared
  try {
    shared = new Worker(new URL('../engine/exploreWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    // No worker support, or a bundler that could not produce one. The caller
    // falls back to the main thread, which is slow but not broken.
    shared = null
  }
  return shared
}

export interface ExploreApi {
  result: Exploration | null
  running: boolean
  failed: boolean
  /** Ask for a spot. Replaces whatever was showing. */
  run: (
    replay: HandReplay,
    seats: Seat[],
    at: number,
    alternatives: { action: Action; label: string }[],
  ) => void
  clear: () => void
}

export function useExplore(trials = DEFAULT_TRIALS): ExploreApi {
  const [result, setResult] = useState<Exploration | null>(null)
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => { cleanup.current?.() }, [])

  const clear = useCallback(() => {
    latest.current++
    cleanup.current?.()
    cleanup.current = null
    setResult(null)
    setRunning(false)
    setFailed(false)
  }, [])

  const run = useCallback((
    replay: HandReplay,
    seats: Seat[],
    at: number,
    alternatives: { action: Action; label: string }[],
  ) => {
    const id = ++latest.current
    cleanup.current?.()
    setResult(null)
    setFailed(false)
    setRunning(true)

    const w = worker()
    if (!w) {
      // Yield first, so the spinner paints before the thread is tied up.
      const timer = setTimeout(() => {
        if (latest.current !== id) return
        const answer = explore(replay, seats, at, alternatives, { trials })
        setResult(answer)
        setFailed(answer === null)
        setRunning(false)
      }, 0)
      cleanup.current = () => clearTimeout(timer)
      return
    }

    const onMessage = (event: MessageEvent<ExploreResponse>) => {
      if (event.data.id !== id || latest.current !== id) return
      if ('result' in event.data) {
        setResult(event.data.result)
        setFailed(event.data.result === null)
      } else {
        setFailed(true)
      }
      setRunning(false)
    }
    w.addEventListener('message', onMessage)
    cleanup.current = () => w.removeEventListener('message', onMessage)
    w.postMessage({
      id, replay, seats, at, alternatives, trials,
      seed: Math.floor(Math.random() * 2 ** 31),
    } satisfies ExploreRequest)
  }, [trials])

  return { result, running, failed, run, clear }
}
