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
import type { Provider, ProviderConfig } from './providers/types'

export type { NarrationRequest, NarrationResult } from './narration'
export type { LeakFinding, Turn } from './narration'
export type { ProviderConfig, ProviderId } from './providers/types'

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

/**
 * Call a model service straight from the browser with the player's own key.
 *
 * This is the convenient path, not the safe one. A key held in a browser is
 * readable by anything with access to the page — a browser extension, anyone
 * on the device, any script that ever gets injected — so it suits a personal
 * install and not an app handed round the group. The proxy exists for that.
 *
 * Which service answers is the provider's business; this function only knows
 * that something with `explain` and `review` can be built from a config. The
 * provider, and whatever SDK it needs, is loaded on demand so nobody who
 * leaves this off pays for it in their bundle.
 */
export function directNarrator(config: ProviderConfig): Narrator {
  // Built once and reused, so a conversation does not re-import the SDK and
  // re-open a client on every question.
  let pending: Promise<Provider> | null = null

  return {
    available: Boolean(config.apiKey),
    async narrate(request, signal) {
      if (!config.apiKey) throw new NarratorError('No API key is set.', false)

      try {
        if (!pending) {
          const { createProvider } = await import('./providers')
          pending = createProvider(config)
        }
        const provider = await pending

        if (request.kind === 'leaks') {
          const answer = await provider.review(request.brief, { signal })
          return { text: answer.summary, findings: answer.findings }
        }
        const text = await provider.explain(request.brief, {
          question: request.question,
          history: request.history,
          signal,
        })
        return { text }
      } catch (cause) {
        // A failed build must not be cached, or one bad key poisons the rest
        // of the session even after it is corrected.
        pending = null
        if ((cause as Error)?.name === 'AbortError') throw cause
        if (cause instanceof NarratorError) throw cause
        if (isProviderError(cause)) {
          throw new NarratorError(cause.message, cause.retryable)
        }
        throw new NarratorError((cause as Error)?.message || 'The coach could not answer.', false)
      }
    },
  }
}

/**
 * Recognise a provider failure by shape rather than by `instanceof`.
 *
 * The provider module is loaded dynamically, and under a bundler or a test
 * that resets modules the class it exports need not be the same object this
 * module would compare against. The shape is the stable part.
 */
function isProviderError(cause: unknown): cause is { message: string; retryable: boolean } {
  return (
    Boolean(cause)
    && typeof cause === 'object'
    && (cause as { name?: string }).name === 'ProviderError'
    && typeof (cause as { retryable?: unknown }).retryable === 'boolean'
  )
}

/** Nothing configured: every call fails the same way, and callers say so. */
export const offlineNarrator: Narrator = {
  available: false,
  async narrate() {
    throw new NarratorError('No coach endpoint is configured.', false)
  },
}

export type NarratorMode = 'proxy' | 'key' | 'none'

/**
 * Pick how to reach the narrator.
 *
 * A proxy always wins over a key, because the whole reason the proxy exists is
 * to keep the key off the device — silently preferring the browser key when
 * both are set would quietly undo that.
 */
export function chooseNarrator(
  endpoint: string,
  config: ProviderConfig | string,
): { via: NarratorMode; narrator: Narrator } {
  const url = endpoint.trim()
  if (url) return { via: 'proxy', narrator: httpNarrator(url) }

  const resolved: ProviderConfig = typeof config === 'string'
    ? { id: 'anthropic', model: '', apiKey: config.trim() }
    : { ...config, apiKey: config.apiKey.trim(), model: config.model.trim() }
  if (resolved.apiKey && isUsable(resolved)) {
    return { via: 'key', narrator: directNarrator(resolved) }
  }
  return { via: 'none', narrator: offlineNarrator }
}

/**
 * Whether a config has enough to make a call.
 *
 * Only Anthropic has a default model worth assuming; everywhere else the model
 * is the deployment or the exact name, and an empty one would fail at the
 * service with a message about a missing parameter rather than about the
 * field the player left blank.
 */
export function isUsable(config: ProviderConfig): boolean {
  if (!config.apiKey.trim()) return false
  return config.id === 'anthropic' || Boolean(config.model.trim())
}
