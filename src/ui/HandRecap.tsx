/**
 * How the hand went, once it is over.
 *
 * The coach panel only ever held one verdict. Each decision's feedback
 * overwrote the last, so in a hand where you acted four times you saw the
 * fourth and the other three were gone — which is why "I can't see the
 * feedback from the hand" was a fair description of something working exactly
 * as written.
 *
 * This is the whole hand at once, and it stays until you deal the next one.
 * Nothing here is new information: every row was already computed and recorded
 * the moment you acted. It was simply never shown twice.
 */

import { money } from '../engine/bnotw'
import { gradeHand, severityOf, SEVERITY_LABEL } from '../engine/grading'
import type { DecisionRecord, HandRecord } from '../engine/playerStats'
import type { Street } from '../engine/types'

const STREET_NAME: Record<string, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/** "call" as something you did, rather than as an enum value. */
function past(action: string): string {
  switch (action) {
    case 'fold': return 'folded'
    case 'check': return 'checked'
    case 'call': return 'called'
    case 'bet': return 'bet'
    case 'raise': return 'raised'
    default: return action
  }
}

function Row({ decision }: { decision: DecisionRecord }) {
  const severity = severityOf(decision.evLost)
  return (
    <div className={`recap-row ${decision.agreed ? 'ok' : 'off'}`}>
      <span className="recap-street">{STREET_NAME[decision.street] ?? decision.street}</span>
      <span className="recap-what">
        You <b>{past(decision.action)}</b>
        {decision.agreed
          ? <> — that was the play.</>
          : <> · the coach would have <b>{past(decision.recommended)}</b>.</>}
        {decision.leak && !decision.agreed && (
          <span className="recap-leak">{decision.leak}</span>
        )}
      </span>
      <span className={`recap-cost ${decision.evLost > 0 ? 'neg' : 'faint'}`}>
        {decision.evLost > 0 ? money(decision.evLost) : '—'}
        {severity && <span className={`tag sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>}
      </span>
    </div>
  )
}

export function HandRecap({
  hand, onReplay,
}: {
  hand: HandRecord
  /** Offered when the hand kept a replay. */
  onReplay?: () => void
}) {
  const graded = gradeHand(hand)
  const lost = hand.decisions.reduce((sum, d) => sum + d.evLost, 0)

  if (hand.decisions.length === 0) {
    return (
      <div className="recap" data-hand={hand.handNumber}>
        <h3>How that hand went</h3>
        <p className="sub" style={{ margin: 0 }}>
          Nothing to judge — you were never put to a decision.
        </p>
      </div>
    )
  }

  // Play order, so it reads as the hand happened rather than worst first.
  const order: Street[] = ['preflop', 'flop', 'turn', 'river']
  const decisions = [...hand.decisions].sort(
    (a, b) => order.indexOf(a.street as Street) - order.indexOf(b.street as Street),
  )

  return (
    <div className="recap" data-hand={hand.handNumber}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>How that hand went</h3>
        <span className="spacer" />
        {graded && (
          <span className={`grade g-${graded.overall.letter.toLowerCase()}`}>
            {graded.overall.letter}
          </span>
        )}
      </div>

      <div className="recap-rows">
        {decisions.map((decision, i) => <Row key={i} decision={decision} />)}
      </div>

      <div className="row recap-foot">
        <span className="sub">
          {lost > 0
            ? <>About <b>{money(lost)}</b> given up across {decisions.length} decision
              {decisions.length === 1 ? '' : 's'}.</>
            : <>Nothing measurably given up across {decisions.length} decision
              {decisions.length === 1 ? '' : 's'}.</>}
        </span>
        <span className="spacer" />
        {onReplay && (
          <button className="btn small ghost" onClick={onReplay}>Replay it</button>
        )}
      </div>
    </div>
  )
}
