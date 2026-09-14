/**
 * Talking to a narrator.
 *
 * Provider-agnostic on purpose: the app posts a brief to an endpoint and gets
 * prose back. Which model is behind that endpoint is the proxy's business, and
 * swapping it should never touch the app.
 *
 * Everything here degrades to nothing. With no endpoint configured the coach
 * works exactly as it always has — the narrator is an enhancement, never a
 * dependency, and the app must remain fully usable with no network and no key.
 */

import type { NarrationRequest, NarrationResult } from './narration'

export type { NarrationRequest, NarrationResult } from './narration'
export type { LeakFinding, Turn } from './narration'

export interface Narrator {
  /** False when no endpoint is configured; callers must handle this. */
  available: boolean
  narrate(request: NarrationRequest, signal?: AbortSignal): Promise<NarrationResult>
}

export class NarratorError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'NarratorError'
  }
}

/** The endpoint, from the build or from a local override set in Settings. */
export function narratorEndpoint(override?: string | null): string {
  const configured = override?.trim()
  if (configured) return configured
  const fromBuild = (import.meta.env?.VITE_COACH_ENDPOINT as string | undefined)?.trim()
  return fromBuild ?? ''
}

/** A narrator that posts briefs to the proxy. */
export function httpNarrator(endpoint: string): Narrator {
  return {
    available: Boolean(endpoint),
    async narrate(request, signal) {
      if (!endpoint) throw new NarratorError('No coach endpoint is configured.', false)

      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        })
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError') throw cause
        throw new NarratorError('Could not reach the coach service.', true)
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new NarratorError(
          detail.slice(0, 200) || `The coach service answered ${response.status}.`,
          response.status === 429 || response.status >= 500,
        )
      }

      const data = (await response.json()) as NarrationResult
      if (!data || typeof data.text !== 'string') {
        throw new NarratorError('The coach service sent back something unreadable.', false)
      }
      return data
    },
  }
}

/** Nothing configured: every call fails the same way, and callers say so. */
export const offlineNarrator: Narrator = {
  available: false,
  async narrate() {
    throw new NarratorError('No coach endpoint is configured.', false)
  },
}
