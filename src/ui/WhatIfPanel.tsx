/**
 * What would have happened, shown carefully.
 *
 * The danger in this panel is not that it is wrong, it is that it is
 * persuasive. "You would have made a flush" is the most memorable thing on the
 * screen and the least useful, and a player who reads only that learns to
 * regret good folds. So the layout puts the probability you acted on *above*
 * the one runout that came, and the caveat is body text rather than a
 * footnote.
 *
 * Coach mode only, for the same reason X-ray is.
 */

import { money } from '../engine/bnotw'
import { parseCards } from '../engine/cards'
import { pct } from '../engine/coach'
import { isWhatIf, type WhatIfResult } from '../engine/whatIf'
import { CardRow } from './pieces'

const NO_ANSWER: Record<string, string> = {
  'still-in': '',
  'no-river': 'The hand finished before the river, so there is no runout to show you. Dealing one now would be a different hand.',
  'no-opponents': 'Everyone else folded too, so there was nobody left to have beaten.',
}

export function WhatIfPanel({
  result, equityAtFold, onClose,
}: {
  result: WhatIfResult
  /** Your equity at the moment you folded, if it was measured. */
  equityAtFold: number | null
  onClose?: () => void
}) {
  if (!isWhatIf(result)) {
    const message = NO_ANSWER[result.unknown]
    if (!message) return null
    return (
      <div className="whatif">
        <h3>Had you stayed</h3>
        <p className="sub" style={{ margin: 0 }}>{message}</p>
      </div>
    )
  }

  const { madeLabel, wouldHaveWon, best, showdown, pot } = result

  return (
    <div className={`whatif ${wouldHaveWon ? 'hit' : 'missed'}`}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Had you stayed</h3>
        <span className="spacer" />
        {onClose && (
          <button className="btn small ghost" onClick={onClose}>Hide</button>
        )}
      </div>

      {/*
        The probability first, then the outcome. The other order reads as "you
        were robbed" — which is exactly the lesson not to teach.
      */}
      {equityAtFold !== null && (
        <p className="whatif-equity">
          You had <b>{pct(equityAtFold)}</b> when you folded.
        </p>
      )}

      <div className="whatif-cards">
        <CardRow cards={parseCards(result.hole)} size="small" />
        <span className="faint">on</span>
        <CardRow cards={parseCards(result.board)} size="small" />
      </div>

      <p className="whatif-made">
        You would have had <b>{madeLabel}</b>
        {wouldHaveWon
          ? ' — the best hand at the river.'
          : best
            ? <> — beaten by {best.name}&rsquo;s <b>{best.hand}</b>.</>
            : '.'}
      </p>

      {showdown.length > 1 && (
        <div className="whatif-showdown">
          {showdown.map((s) => (
            <span key={s.seat} className={s.won > 0 ? 'won' : ''}>
              {s.name}: {s.hand}
            </span>
          ))}
        </div>
      )}

      <p className="sub" style={{ margin: '6px 0 0' }}>
        The pot was {money(pot)}.
      </p>

      {/*
        Not a footnote. Two separate reasons this is weaker evidence than it
        looks, and the second one is the one people never think of.
      */}
      <p className="whatif-caveat">
        This is one runout, not a probability — and with you still in, the
        betting would not have gone the same way, so some of these hands would
        never have reached the river. A fold that would have won is usually
        still the right fold.
      </p>
    </div>
  )
}
