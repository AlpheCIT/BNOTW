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
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { DecisionBrief, LeakBrief } from '../src/engine/brief'
import type { NarrationRequest } from '../src/engine/narration'

const MODEL = 'claude-opus-5'

/**
 * Claude Opus 5's safety classifiers can decline a request. Rather than
 * surfacing that to the player mid-hand, `fallbacks: "default"` re-runs it on
 * Anthropic's recommended substitute server-side, routed by refusal category.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

const SHARED_RULES = `
You are a poker coach explaining decisions at a $0.25/$0.50 home game.

The single most important rule: EVERY NUMBER YOU MENTION MUST COME FROM THE
BRIEF YOU ARE GIVEN. The equity, the pot odds, the outs, the expected value
and the recommendation were all computed exactly by a poker engine before you
were called. Do not recompute them, do not round them into different numbers,
and do not invent any figure that is not in front of you. If something is not
in the brief, say you do not know it rather than estimating.

You are explaining, not deciding. The recommendation in the brief is the
answer; your job is to make the reasoning behind it land.

Write plainly, the way a good player talks at the table. No lists unless they
genuinely help, no hedging into uselessness, no restating the whole brief back.
Assume the reader can see the numbers on screen already — tell them what the
numbers mean and what to do about it.
`.trim()

function decisionPrompt(brief: DecisionBrief, question?: string): string {
  return [
    SHARED_RULES,
    '',
    'THE SPOT (all figures computed by the engine):',
    JSON.stringify(brief, null, 1),
    '',
    question
      ? `The player asks: "${question}"\n\nAnswer that question specifically, in two or three sentences, using only the facts above.`
      : 'Explain this spot in two or three sentences: what the hand is worth, what the price is, and why the recommendation follows. Lead with whichever of those actually decides it.',
  ].join('\n')
}

const FindingsSchema = z.object({
  summary: z.string().describe('Two sentences on the shape of this player\'s game overall.'),
  findings: z.array(z.object({
    title: z.string().describe('The leak, in a few words.'),
    detail: z.string().describe('What the numbers show, citing only figures from the brief.'),
    fix: z.string().describe('One concrete thing to do differently next session.'),
  })).min(1).max(4),
})

function leakPrompt(brief: LeakBrief): string {
  return [
    SHARED_RULES,
    '',
    'A PLAYER\'S RECORD (all figures computed by the engine):',
    JSON.stringify(brief, null, 1),
    '',
    'Find the patterns. Look across the tendencies, the leak counts, the',
    'per-street breakdown and the worst individual decisions, and say what they',
    'have in common — the point is the theme, not a list of the same numbers',
    'back. Give at most four findings, fewest that cover it, most costly first.',
    brief.provisional
      ? 'Note: this is a small sample and the rating is still provisional. Say so rather than overstating what it shows.'
      : '',
  ].filter(Boolean).join('\n')
}

function text(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
}

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
        model: MODEL,
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
      model: MODEL,
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
    return json({ text: text(response) })
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
