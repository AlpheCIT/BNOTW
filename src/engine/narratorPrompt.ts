/**
 * What the narrator is asked, and what it is allowed to answer with.
 *
 * Shared by every provider and both connection paths. Divergence would mean
 * the same spot gets explained differently depending on which model answered
 * or how you happen to be connected, so there is exactly one copy of this.
 */

import { z } from 'zod'
import type { DecisionBrief, LeakBrief } from './brief'

export const SHARED_RULES = `
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

export function decisionPrompt(brief: DecisionBrief, question?: string): string {
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

export const FindingsSchema = z.object({
  summary: z.string().describe("Two sentences on the shape of this player's game overall."),
  findings: z.array(z.object({
    title: z.string().describe('The leak, in a few words.'),
    detail: z.string().describe('What the numbers show, citing only figures from the brief.'),
    fix: z.string().describe('One concrete thing to do differently next session.'),
  })).min(1).max(4),
})

export function leakPrompt(brief: LeakBrief): string {
  return [
    SHARED_RULES,
    '',
    "A PLAYER'S RECORD (all figures computed by the engine):",
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

/**
 * The findings shape as plain JSON Schema, for providers whose structured
 * output takes a schema rather than a zod object.
 */
export const FINDINGS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'fix'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
} as const
