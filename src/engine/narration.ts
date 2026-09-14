/**
 * The wire contract between the app and the narrator proxy.
 *
 * Deliberately free of anything browser- or server-specific so both sides can
 * import it: the app posts a `NarrationRequest`, the proxy answers with a
 * `NarrationResult`.
 */

import type { DecisionBrief, LeakBrief } from './brief'

export interface Turn {
  role: 'user' | 'assistant'
  text: string
}

export type NarrationRequest =
  | { kind: 'decision'; brief: DecisionBrief; question?: string; history?: Turn[] }
  | { kind: 'leaks'; brief: LeakBrief }

export interface LeakFinding {
  title: string
  detail: string
  /** What to do differently, in one line. */
  fix: string
}

export interface NarrationResult {
  text: string
  /** Present for a leak review, where the answer has structure worth rendering. */
  findings?: LeakFinding[]
}
