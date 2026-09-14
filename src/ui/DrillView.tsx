/**
 * One decision, stripped of everything that is not the decision.
 *
 * Deliberately not the felt table. At the table the oval, the avatars and the
 * chip animations are the point; here they are noise between you and the only
 * question being asked. What is left is what you would actually reason from:
 * your cards, the board, the price, who is still in and how deep they are.
 *
 * Sizing is not offered, because sizing is not scored — the coach's verdict
 * turns on whether you fold, call or raise. Asking for an amount would imply
 * a precision the marking does not have.
 */

import { useMemo, useState } from 'react'
import { money } from '../engine/bnotw'
import { pct } from '../engine/coach'
import { legalActions, livePlayers, potTotal } from '../engine/hand'
import type { Action } from '../engine/types'
import { CardRow } from './pieces'
import type { DrillApi } from './useDrill'

const STREET_LABEL: Record<string, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

export function DrillView({ drill }: { drill: DrillApi }) {
  const { spot, review, loading, failed, stats } = drill
  const [showStats, setShowStats] = useState(false)

  const legal = useMemo(
    () => (spot ? legalActions(spot.hand, spot.seats, spot.seat) : null),
    [spot],
  )

  if (failed && !spot) {
    return (
      <div className="drill">
        <p className="sub">
          Could not deal a spot. That usually means too few players are seated —
          try seating at least two opponents on the Players tab.
        </p>
      </div>
    )
  }

  if (!spot || !legal) {
    return (
      <div className="drill">
        <p className="sub">{loading ? 'Dealing a spot…' : 'Getting ready…'}</p>
      </div>
    )
  }

  const { hand, seats, seat, advice } = spot
  const pot = potTotal(hand)
  const opponents = livePlayers(hand).length - 1
  const behind = seats[seat].stack

  const act = (action: Action) => drill.answer(action)

  return (
    <div className="drill">
      <div className="drill-head">
        <span className="tag">{STREET_LABEL[spot.street] ?? spot.street}</span>
        <span className="sub">{advice.opponents} against you</span>
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => setShowStats((v) => !v)}>
          {stats.spots > 0 ? `${Math.round((stats.agreed / stats.spots) * 100)}% · ${stats.spots}` : 'Practice'}
        </button>
      </div>

      {showStats && <DrillScore drill={drill} />}

      <div className="drill-facts">
        <Fact label="Pot" value={money(pot)} />
        <Fact label="To call" value={legal.callAmount > 0 ? money(legal.callAmount) : 'nothing'} />
        <Fact label="Your stack" value={money(behind)} />
        <Fact label="Still in" value={`${opponents + 1}`} />
      </div>

      <div className="drill-board">
        <span className="drill-label">Board</span>
        {hand.board.length > 0
          ? <div className="drill-cards"><CardRow cards={hand.board} /></div>
          : <p className="sub" style={{ margin: 0 }}>Nothing yet — this is pre-flop.</p>}
      </div>

      <div className="drill-board">
        <span className="drill-label">You have</span>
        <div className="drill-cards"><CardRow cards={hand.players[seat].hole} /></div>
      </div>

      {review ? (
        <div className={`drill-verdict ${review.agreed ? 'right' : 'wrong'}`}>
          <b>{review.agreed ? 'Right' : advice.recommendation.headline}</b>
          <p>{review.message}</p>
          <div className="drill-numbers">
            <Fact label="Equity" value={pct(advice.equity.equity)} />
            {advice.toCall > 0 && <Fact label="Needed" value={pct(advice.breakEven)} />}
            {!review.agreed && review.evLost > 0 && (
              <Fact label="Cost" value={money(review.evLost)} />
            )}
            <Fact label="Streak" value={`${stats.streak}`} />
          </div>
          <button className="btn primary wide" onClick={drill.next} autoFocus>
            {loading ? 'Dealing…' : 'Next spot →'}
          </button>
        </div>
      ) : (
        <div className="drill-actions">
          <button
            className="btn fold"
            disabled={!legal.canFold}
            onClick={() => act({ kind: 'fold' })}
          >
            Fold
          </button>
          {legal.canCheck ? (
            <button className="btn check" onClick={() => act({ kind: 'check' })}>Check</button>
          ) : (
            <button className="btn call" onClick={() => act({ kind: 'call' })}>
              Call<small>{money(legal.callAmount)}</small>
            </button>
          )}
          <button
            className="btn raise"
            disabled={!legal.canBet && !legal.canRaise}
            onClick={() => act({
              kind: legal.canBet ? 'bet' : 'raise',
              amount: legal.minRaiseTo,
            })}
          >
            {legal.canBet ? 'Bet' : 'Raise'}
          </button>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <b className="num">{value}</b>
      <span>{label}</span>
    </div>
  )
}

function DrillScore({ drill }: { drill: DrillApi }) {
  const { stats } = drill
  if (stats.spots === 0) {
    return (
      <p className="sub">
        No spots answered yet. These are kept apart from your record and do not
        move your rating — the rating is about hands you were actually dealt.
      </p>
    )
  }

  const rows = Object.entries(stats.byStreet)
    .filter(([, row]) => row.spots > 0)
    .sort((a, b) => b[1].spots - a[1].spots)

  return (
    <div className="drill-score">
      <div className="drill-numbers">
        <Fact label="Spots" value={`${stats.spots}`} />
        <Fact label="Matched" value={pct(stats.agreed / stats.spots)} />
        <Fact label="Best streak" value={`${stats.bestStreak}`} />
      </div>
      <table className="grid">
        <thead><tr><th>Street</th><th>Spots</th><th>Matched</th></tr></thead>
        <tbody>
          {rows.map(([street, row]) => (
            <tr key={street}>
              <td>{STREET_LABEL[street] ?? street}</td>
              <td>{row.spots}</td>
              <td>{pct(row.agreed / row.spots)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub">
        Practice only. These spots are generated, so they are kept out of your
        record and out of your rating — otherwise a number meant to describe how
        you play could be moved by grinding spots you find easy.
      </p>
      <button className="btn small danger" onClick={drill.reset}>Clear practice history</button>
    </div>
  )
}
