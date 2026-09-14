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
 * The contract with the rest of the app: this service only ever *narrates*.
 * Every number it mentions was computed by the engine and handed to it in the
 * brief. It is told, firmly, not to do arithmetic of its own.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  FALLBACK_BETA, FindingsSchema, NARRATOR_MODEL, decisionPrompt, leakPrompt, textOf,
} from '../src/engine/narratorPrompt'
import type { NarrationRequest } from '../src/engine/narration'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Send a POST with a brief.' }, 405)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'The coach service has no API key configured.' }, 503)
  }

  let payload: NarrationRequest
  try {
    payload = (await request.json()) as NarrationRequest
  } catch {
    return json({ error: 'That request body was not readable JSON.' }, 400)
  }
  if (payload?.kind !== 'decision' && payload?.kind !== 'leaks') {
    return json({ error: 'Unknown brief kind.' }, 400)
  }

  const client = new Anthropic()

  try {
    if (payload.kind === 'leaks') {
      const response = await client.messages.parse({
        model: NARRATOR_MODEL,
        max_tokens: 4000,
        output_config: { format: zodOutputFormat(FindingsSchema) },
        messages: [{ role: 'user', content: leakPrompt(payload.brief) }],
      })
      if (response.stop_reason === 'refusal') {
        return json({ error: 'The model declined to answer that one.' }, 502)
      }
      const parsed = response.parsed_output
      if (!parsed) return json({ error: 'The review came back unreadable.' }, 502)
      return json({ text: parsed.summary, findings: parsed.findings })
    }

    const history = (payload.history ?? []).slice(-6).map((turn) => ({
      role: turn.role,
      content: turn.text,
    }))
    const response = await client.beta.messages.create({
      model: NARRATOR_MODEL,
      max_tokens: 1200,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      messages: [
        ...history,
        { role: 'user', content: decisionPrompt(payload.brief, payload.question) },
      ],
    })
    if (response.stop_reason === 'refusal') {
      return json({ error: 'The model declined to answer that one.' }, 502)
    }
    return json({ text: textOf(response) })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: 'The coach is rate limited — try again shortly.' }, 429)
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return json({ error: 'The coach service key was rejected.' }, 503)
    }
    if (error instanceof Anthropic.APIError) {
      return json({ error: `The coach service failed (${error.status}).` }, 502)
    }
    return json({ error: 'The coach service failed unexpectedly.' }, 500)
  }
}
