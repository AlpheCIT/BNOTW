/**
 * Claude, via the official Anthropic SDK.
 *
 * The SDK is imported on demand so a build that never uses this provider does
 * not carry it.
 */

import type { DecisionBrief, LeakBrief } from '../brief'
import { FindingsSchema, decisionPrompt, leakPrompt } from '../narratorPrompt'
import { ProviderError, errorForStatus, type Provider, type ProviderConfig } from './types'

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5'

/**
 * Claude Opus 5's safety classifiers can decline a request. Rather than
 * surfacing that mid-hand, `fallbacks: "default"` re-runs it on Anthropic's
 * recommended substitute server-side, routed by refusal category.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Pull the plain text out of Claude's content blocks. */
function textOf(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
}

function rethrow(cause: unknown): never {
  if (cause instanceof ProviderError) throw cause
  if ((cause as Error)?.name === 'AbortError') throw cause
  throw errorForStatus((cause as { status?: number })?.status, 'Anthropic')
}

export async function anthropicProvider(config: ProviderConfig): Promise<Provider> {
  const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('@anthropic-ai/sdk/helpers/zod'),
  ])

  // An empty key lets the SDK resolve credentials from the environment, which
  // is what the server-side proxy wants.
  const client = config.apiKey
    ? new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })
    : new Anthropic()
  const model = config.model || ANTHROPIC_DEFAULT_MODEL

  return {
    async explain(brief: DecisionBrief, { question, history, signal }) {
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 1200,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          messages: [
            ...(history ?? []).slice(-6).map((turn) => ({
              role: turn.role,
              content: turn.text,
            })),
            { role: 'user' as const, content: decisionPrompt(brief, question) },
          ],
        }, { signal })
        if (response.stop_reason === 'refusal') {
          throw new ProviderError('The model declined to answer that one.', false)
        }
        return textOf(response)
      } catch (cause) {
        rethrow(cause)
      }
    },

    async review(brief: LeakBrief, { signal }) {
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: 4000,
          output_config: { format: zodOutputFormat(FindingsSchema) },
          messages: [{ role: 'user', content: leakPrompt(brief) }],
        }, { signal })
        if (response.stop_reason === 'refusal') {
          throw new ProviderError('The model declined to answer that one.', false)
        }
        const parsed = response.parsed_output
        if (!parsed) throw new ProviderError('The review came back unreadable.', true)
        return { summary: parsed.summary, findings: parsed.findings }
      } catch (cause) {
        rethrow(cause)
      }
    },
  }
}
