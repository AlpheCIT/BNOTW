import { useState } from 'react'
import type { CoachAdvice } from '../engine/coach'
import { decisionBrief } from '../engine/brief'
import type { Turn } from '../engine/narrator'
import type { NarratorApi } from './useNarrator'

/**
 * "Explain this" under the coach's verdict.
 *
 * The numbers above it are the answer; this is for when you want the reasoning
 * in words, or want to argue with it. Every fact the narrator uses was computed
 * before it was called — it is putting the arithmetic into sentences, not
 * doing any.
 */
export function Explain({
  advice, position, narrator,
}: {
  advice: CoachAdvice
  position: string
  narrator: NarratorApi
}) {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<Turn[]>([])

  if (!narrator.available) return null

  const brief = () => decisionBrief(advice, position)

  const explain = () => {
    setHistory([])
    narrator.ask({ kind: 'decision', brief: brief() })
  }

  const followUp = (text: string) => {
    const asked = text.trim()
    if (!asked) return
    const next: Turn[] = narrator.result
      ? [...history, { role: 'assistant' as const, text: narrator.result.text }]
      : history
    setHistory(next)
    setQuestion('')
    narrator.ask({ kind: 'decision', brief: brief(), question: asked, history: next })
  }

  return (
    <div className="explain">
      {!narrator.result && !narrator.loading && !narrator.error && (
        <button className="btn small" onClick={explain}>Explain this spot</button>
      )}

      {narrator.loading && <div className="explain-body faint">Thinking it through…</div>}

      {narrator.error && (
        <div className="explain-body warn" style={{ margin: 0 }}>
          {narrator.error}
          <button className="btn small ghost" onClick={explain} style={{ marginLeft: 8 }}>
            Try again
          </button>
        </div>
      )}

      {narrator.result && !narrator.loading && (
        <>
          <div className="explain-body">{narrator.result.text}</div>
          <div className="chiprow">
            {['Why not raise?', 'What if I had position?', 'What beats me here?'].map((q) => (
              <button key={q} className="btn small ghost" onClick={() => followUp(q)}>{q}</button>
            ))}
          </div>
          <form
            className="row"
            style={{ marginTop: 6, flexWrap: 'nowrap' }}
            onSubmit={(e) => { e.preventDefault(); followUp(question) }}
          >
            <input
              className="cell-input"
              style={{ flex: '1 1 auto', width: 'auto', textAlign: 'left' }}
              placeholder="Ask about this spot…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button className="btn small" type="submit" disabled={!question.trim()}>Ask</button>
          </form>
        </>
      )}
    </div>
  )
}
