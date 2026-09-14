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

/**
 * Call Anthropic straight from the browser with the player's own key.
 *
 * This is the convenient path, not the safe one. A key held in a browser is
 * readable by anything with access to the page — a browser extension, anyone
 * on the device, any script that ever gets injected — so it suits a personal
 * install and not an app handed round the group. The proxy exists for that.
 *
 * The SDK is imported on demand so nobody who leaves this off pays for it in
 * their bundle.
 */
export function directNarrator(apiKey: string): Narrator {
  return {
    available: Boolean(apiKey),
    async narrate(request, signal) {
      if (!apiKey) throw new NarratorError('No API key is set.', false)

      const [{ default: Anthropic }, { zodOutputFormat }, prompts] = await Promise.all([
        import('@anthropic-ai/sdk'),
        import('@anthropic-ai/sdk/helpers/zod'),
        import('./narratorPrompt'),
      ])

      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

      try {
        if (request.kind === 'leaks') {
          const response = await client.messages.parse({
            model: prompts.NARRATOR_MODEL,
            max_tokens: 4000,
            output_config: { format: zodOutputFormat(prompts.FindingsSchema) },
            messages: [{ role: 'user', content: prompts.leakPrompt(request.brief) }],
          }, { signal })
          if (response.stop_reason === 'refusal') {
            throw new NarratorError('The model declined to answer that one.', false)
          }
          const parsed = response.parsed_output
          if (!parsed) throw new NarratorError('The review came back unreadable.', true)
          return { text: parsed.summary, findings: parsed.findings }
        }

        const history = (request.history ?? []).slice(-6).map((turn) => ({
          role: turn.role,
          content: turn.text,
        }))
        const response = await client.beta.messages.create({
          model: prompts.NARRATOR_MODEL,
          max_tokens: 1200,
          betas: [prompts.FALLBACK_BETA],
          fallbacks: 'default',
          messages: [
            ...history,
            { role: 'user', content: prompts.decisionPrompt(request.brief, request.question) },
          ],
        }, { signal })
        if (response.stop_reason === 'refusal') {
          throw new NarratorError('The model declined to answer that one.', false)
        }
        return { text: prompts.textOf(response) }
      } catch (cause) {
        if (cause instanceof NarratorError) throw cause
        if ((cause as Error)?.name === 'AbortError') throw cause
        const status = (cause as { status?: number })?.status
        if (status === 401) throw new NarratorError('That API key was rejected.', false)
        if (status === 429) throw new NarratorError('Rate limited — try again shortly.', true)
        if (status && status >= 500) throw new NarratorError('Anthropic had a problem. Try again.', true)
        throw new NarratorError(
          (cause as Error)?.message || 'The coach could not answer.',
          false,
        )
      }
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
  apiKey: string,
): { via: NarratorMode; narrator: Narrator } {
  const url = endpoint.trim()
  const key = apiKey.trim()
  if (url) return { via: 'proxy', narrator: httpNarrator(url) }
  if (key) return { via: 'key', narrator: directNarrator(key) }
  return { via: 'none', narrator: offlineNarrator }
}
