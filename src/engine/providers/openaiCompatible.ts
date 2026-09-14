/**
 * Anything that speaks the OpenAI chat-completions format.
 *
 * That is deliberately one adapter rather than several: OpenAI, Azure OpenAI,
 * Groq, Together, OpenRouter and a local server all take the same request
 * shape and differ only in address, auth header and model name. Point
 * `baseUrl` at the service and it works.
 *
 * Written against the REST shape with plain `fetch` rather than an SDK. It
 * adds no dependency, nothing to the bundle, and the wire format is the one
 * thing all of these genuinely agree on — an SDK would only be right for one
 * of them.
 */

import type { DecisionBrief, LeakBrief } from '../brief'
import { FINDINGS_JSON_SCHEMA, decisionPrompt, leakPrompt } from '../narratorPrompt'
import type { LeakFinding } from '../narration'
import { ProviderError, errorForStatus, type Provider, type ProviderConfig } from './types'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function endpointFor(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  // Azure hands you a full deployment URL including the query string; leave it be.
  return /\/chat\/completions/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`
}

export async function openAiCompatibleProvider(config: ProviderConfig): Promise<Provider> {
  const url = endpointFor(config.baseUrl?.trim() || DEFAULT_BASE_URL)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.auth === 'api-key') headers['api-key'] = config.apiKey
  else headers.authorization = `Bearer ${config.apiKey}`

  async function chat(
    messages: ChatMessage[],
    signal: AbortSignal | undefined,
    json: boolean,
  ): Promise<string> {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: config.model,
          messages,
          // Deliberately no token cap: the parameter for it has changed name
          // across models and getting it wrong is a hard error, while the
          // service default is fine for answers this short.
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
    } catch (cause) {
      if ((cause as Error)?.name === 'AbortError') throw cause
      throw new ProviderError('Could not reach the model service.', true)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const error = errorForStatus(response.status, 'The model service')
      throw new ProviderError(
        detail.slice(0, 160) ? `${error.message} (${detail.slice(0, 160)})` : error.message,
        error.retryable,
      )
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new ProviderError('The model service sent back an empty answer.', true)
    }
    return content.trim()
  }

  return {
    async explain(brief: DecisionBrief, { question, history, signal }) {
      return chat([
        ...(history ?? []).slice(-6).map((turn) => ({
          role: turn.role as 'user' | 'assistant',
          content: turn.text,
        })),
        { role: 'user', content: decisionPrompt(brief, question) },
      ], signal, false)
    },

    async review(brief: LeakBrief, { signal }) {
      // Schema enforcement varies across OpenAI-compatible services, so the
      // shape is asked for in the prompt and checked here rather than trusted.
      const raw = await chat([
        {
          role: 'user',
          content: `${leakPrompt(brief)}\n\nReply with JSON matching this schema and nothing else:\n${
            JSON.stringify(FINDINGS_JSON_SCHEMA)}`,
        },
      ], signal, true)
      return parseReview(raw)
    },
  }
}

/**
 * Read a review out of whatever came back. A service that ignores the JSON
 * request still produced a useful paragraph, so that becomes the summary
 * rather than an error.
 */
export function parseReview(raw: string): { summary: string; findings: LeakFinding[] } {
  const body = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { summary: raw, findings: [] }
  }

  const data = parsed as { summary?: unknown; findings?: unknown }
  const findings = Array.isArray(data.findings)
    ? data.findings
      .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
      .map((f) => ({
        title: String(f.title ?? '').trim(),
        detail: String(f.detail ?? '').trim(),
        fix: String(f.fix ?? '').trim(),
      }))
      .filter((f) => f.title || f.detail)
      .slice(0, 4)
    : []

  const summary = typeof data.summary === 'string' && data.summary.trim()
    ? data.summary.trim()
    : findings.length
      ? ''
      : raw
  return { summary, findings }
}
