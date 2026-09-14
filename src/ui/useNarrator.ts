/**
 * Asking the narrator for an explanation.
 *
 * Every call is cancellable, because the table moves on: if you act before the
 * explanation arrives, the answer is about a spot that no longer exists and is
 * worse than nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  NarratorError, chooseNarrator, narratorEndpoint,
  type NarrationRequest, type NarrationResult, type NarratorMode,
} from '../engine/narrator'

export interface NarratorApi {
  /** False when nothing is configured; the UI hides its affordances. */
  available: boolean
  /** How it is connected, for the UI to explain itself. */
  via: NarratorMode
  endpoint: string
  result: NarrationResult | null
  loading: boolean
  error: string | null
  ask: (request: NarrationRequest) => void
  clear: () => void
}

export function useNarrator(
  endpointOverride?: string | null,
  apiKey?: string | null,
): NarratorApi {
  const endpoint = useMemo(() => narratorEndpoint(endpointOverride), [endpointOverride])
  const key = apiKey?.trim() ?? ''
  const { via, narrator } = useMemo(
    () => chooseNarrator(endpoint, key),
    [endpoint, key],
  )

  const [result, setResult] = useState<NarrationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  const clear = useCallback(() => {
    inFlight.current?.abort()
    inFlight.current = null
    setResult(null)
    setError(null)
    setLoading(false)
  }, [])

  const ask = useCallback((request: NarrationRequest) => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setLoading(true)
    setError(null)

    narrator.narrate(request, controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return
        setResult(answer)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause as Error)?.name === 'AbortError') return
        setError(cause instanceof NarratorError ? cause.message : 'The coach could not answer.')
        setLoading(false)
      })
  }, [narrator])

  // Never leave a request running behind a closed panel.
  useEffect(() => () => inFlight.current?.abort(), [])

  return { available: narrator.available, via, endpoint, result, loading, error, ask, clear }
}
