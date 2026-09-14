/**
 * The seam every model provider plugs into.
 *
 * Above this line the app knows only about briefs and prose. Below it, each
 * provider deals with its own SDK, auth and response shape. Adding one means
 * writing a file in this directory and listing it in the factory — nothing in
 * the app changes.
 */

import type { DecisionBrief, LeakBrief } from '../brief'
import type { LeakFinding, Turn } from '../narration'

export type ProviderId = 'anthropic' | 'openai'

export interface ProviderConfig {
  id: ProviderId
  /** Model name, or on Azure the deployment name. */
  model: string
  apiKey: string
  /**
   * Override the service address. Any endpoint speaking the OpenAI chat
   * format works here — Azure OpenAI, Groq, Together, OpenRouter, a local
   * server — which is why there is one adapter rather than five.
   */
  baseUrl?: string
  /** Azure wants the key in an `api-key` header; everyone else uses a bearer token. */
  auth?: 'bearer' | 'api-key'
}

export interface ReviewAnswer {
  summary: string
  findings: LeakFinding[]
}

export interface Provider {
  /** Explain one spot, optionally answering a question about it. */
  explain(
    brief: DecisionBrief,
    options: { question?: string; history?: Turn[]; signal?: AbortSignal },
  ): Promise<string>
  /** Read a whole history and report the patterns in it. */
  review(brief: LeakBrief, options: { signal?: AbortSignal }): Promise<ReviewAnswer>
}

/** Raised by a provider so the app can say something useful about a failure. */
export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Map an HTTP status onto the message and retry advice the UI shows. */
export function errorForStatus(status: number | undefined, service: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError('That API key was rejected.', false)
  }
  if (status === 404) {
    return new ProviderError('That model or endpoint was not found.', false)
  }
  if (status === 429) return new ProviderError('Rate limited — try again shortly.', true)
  if (status && status >= 500) return new ProviderError(`${service} had a problem. Try again.`, true)
  return new ProviderError(`${service} could not answer.`, false)
}
