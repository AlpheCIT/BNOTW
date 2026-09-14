/**
 * The coach narrator proxy.
 *
 * The one piece of this app that needs a server, and only because an API key
 * cannot ship in a browser. It takes a brief of facts the engine computed,
 * asks a model to explain them, and returns prose.
 *
 * Written as a standard Web `Request` -> `Response` handler, which is what
 * Vercel Edge, Netlify, Cloudflare Workers and Deno Deploy all speak. See
 * `server/dev-proxy.mjs` to run it locally.
 *
 * Which model answers is configuration, not code: the same provider adapters
 * the browser uses are reused here, chosen by environment variable. Deploying
 * this in front of OpenAI, Azure OpenAI or a local server is a matter of
 * setting COACH_PROVIDER and COACH_BASE_URL.
 *
 * The contract with the rest of the app: this service only ever *narrates*.
 * Every number it mentions was computed by the engine and handed to it in the
 * brief. It is told, firmly, not to do arithmetic of its own.
 */

import { createProvider } from '../src/engine/providers'
import type { ProviderConfig, ProviderId } from '../src/engine/providers/types'
import type { NarrationRequest } from '../src/engine/narration'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Read the provider out of the environment.
 *
 * Anthropic is the default and needs no key here: its SDK reads
 * ANTHROPIC_API_KEY itself, which keeps the key out of this file entirely.
 *
 * A misconfiguration says which piece is missing. Deploying this is the one
 * moment the operator has no UI to guide them, and "not configured" sends
 * them reading source.
 */
export function configFromEnv(
  env: Record<string, string | undefined>,
): { config: ProviderConfig } | { error: string } {
  const id = (env.COACH_PROVIDER?.trim() || 'anthropic') as ProviderId

  if (id === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      return { error: 'The coach service has no API key configured.' }
    }
    return { config: { id, model: env.COACH_MODEL?.trim() || '', apiKey: '' } }
  }

  const apiKey = env.COACH_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || ''
  if (!apiKey) {
    return { error: 'The coach service has no API key configured (set COACH_API_KEY).' }
  }
  const model = env.COACH_MODEL?.trim() || ''
  if (!model) {
    return { error: 'The coach service has no model configured (set COACH_MODEL).' }
  }
  return {
    config: {
      id,
      model,
      apiKey,
      baseUrl: env.COACH_BASE_URL?.trim() || undefined,
      auth: env.COACH_AUTH?.trim() === 'api-key' ? 'api-key' : 'bearer',
    },
  }
}

/** Provider failures carry their own retry advice; map it onto a status. */
function statusFor(error: unknown): number {
  const message = (error as Error)?.message ?? ''
  if (/rate limited/i.test(message)) return 429
  if (/rejected/i.test(message)) return 503
  return (error as { retryable?: boolean })?.retryable ? 502 : 500
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Send a POST with a brief.' }, 405)
  }

  const resolved = configFromEnv(process.env)
  if ('error' in resolved) return json({ error: resolved.error }, 503)

  let payload: NarrationRequest
  try {
    payload = (await request.json()) as NarrationRequest
  } catch {
    return json({ error: 'That request body was not readable JSON.' }, 400)
  }
  if (payload?.kind !== 'decision' && payload?.kind !== 'leaks') {
    return json({ error: 'Unknown brief kind.' }, 400)
  }

  try {
    const provider = await createProvider(resolved.config)

    if (payload.kind === 'leaks') {
      const answer = await provider.review(payload.brief, {})
      return json({ text: answer.summary, findings: answer.findings })
    }
    const text = await provider.explain(payload.brief, {
      question: payload.question,
      history: payload.history,
    })
    return json({ text })
  } catch (error) {
    // The provider's own message is safe to pass on: it describes the failure
    // class, never the key or the request.
    return json(
      { error: (error as Error)?.message || 'The coach service failed unexpectedly.' },
      statusFor(error),
    )
  }
}
