import { money, signedMoney } from '../engine/bnotw'
import { cardCode } from '../engine/cards'
import { pct, type CoachAdvice, type DecisionReview } from '../engine/coach'
import type { CoachStats } from '../state/storage'
import { Explain } from './Explain'
import type { NarratorApi } from './useNarrator'

/** The advice panel shown while it is your turn in coach mode. */
export function CoachPanel({
  advice, review, narrator, position, pending = false, speaker, second = null,
}: {
  advice: CoachAdvice | null
  review: DecisionReview | null
  narrator?: NarratorApi
  position?: string
  /** The spot is yours and the numbers are still being worked out. */
  pending?: boolean
  /** Who is giving this read. Omitted when it is just the house. */
  speaker?: string
  /** A second read on the same spot, for when two coaches disagree. */
  second?: { name: string; advice: CoachAdvice | null } | null
}) {
  if (!advice) {
    return (
      <div className="coach">
        <h3>Coach</h3>
        {review && <div className={`feedback ${review.tone}`}>{review.message}</div>}
        <p className="sub" style={{ margin: 0 }}>
          {pending
            ? 'Working this one out…'
            : 'Waiting for the action. Numbers appear when the decision is yours.'}
        </p>
      </div>
    )
  }

  const { equity, recommendation: rec } = advice
  const facing = advice.toCall > 0
  const preflop = advice.board.length === 0

  return (
    <div className="coach">
      <h3>{speaker ?? 'Coach'}</h3>

      {review && <div className={`feedback ${review.tone}`}>{review.message}</div>}

      <div className={`verdict ${rec.action}`}>
        <b>{rec.headline}</b>
        <span className="spacer" />
        <small>{rec.confidence === 'close' ? 'Marginal' : 'Clear'}</small>
      </div>

      {second?.advice && (
        <div className={`second-read ${
          second.advice.recommendation.action === rec.action ? 'agrees' : 'differs'
        }`}>
          <b>{second.name}</b>
          <span>
            {second.advice.recommendation.action === rec.action
              ? `agrees — ${second.advice.recommendation.headline.toLowerCase()}`
              : `would ${second.advice.recommendation.headline.toLowerCase()}`}
          </span>
          {second.advice.recommendation.action !== rec.action && (
            <p>{second.advice.recommendation.reasons.at(-1)}</p>
          )}
        </div>
      )}

      <div className="equity-bar" title={`${pct(equity.equity)} equity`}>
        <i style={{ width: `${Math.min(100, equity.equity * 100)}%` }} />
        {facing && <u style={{ left: `${Math.min(100, advice.breakEven * 100)}%` }} />}
      </div>
      {facing && (
        <p className="sub" style={{ margin: '0 0 8px', fontSize: 11 }}>
          The gold mark is the {pct(advice.breakEven)} you need to break even on the call.
        </p>
      )}

      <div className="coach-grid">
        <div className="coach-cell">
          <b>{pct(equity.equity)}</b>
          <span>Equity vs {advice.opponents}</span>
        </div>
        {preflop ? (
          <div className="coach-cell">
            <b>{advice.starting.chen}</b>
            <span>Chen · {advice.starting.grade}</span>
          </div>
        ) : (
          <div className="coach-cell">
            <b style={{ fontSize: 12 }}>{advice.madeLabel}</b>
            <span>Your hand</span>
          </div>
        )}
        {facing && (
          <div className="coach-cell">
            <b>{pct(advice.breakEven)}</b>
            <span>Need to call</span>
          </div>
        )}
        {/*
          EV of calling is shown after the flop only.
          
          It is the value of a call that ends the hand there and runs to
          showdown with no more betting. After the flop that is close enough to
          the question being asked. Pre-flop it is not: three streets remain in
          which you can fold and cap the loss or make a hand and get paid, so it
          systematically understates exactly the hands — suited connectors,
          suited broadway — that the pre-flop advice is built to play.
          
          Shown anyway, it sat beside a "Call" recommendation reading -$0.35 and
          flatly contradicted it, which is worse than showing nothing.
        */}
        {facing && !preflop && (
          <div className={`coach-cell ${advice.callEV >= 0 ? 'good' : 'bad'}`}>
            <b>{signedMoney(Math.round(advice.callEV))}</b>
            <span>EV of calling</span>
          </div>
        )}
        <div className="coach-cell">
          <b>{money(advice.pot)}</b>
          <span>Pot</span>
        </div>
        {advice.outs.count > 0 && (
          <div className="coach-cell">
            <b>{advice.outs.count}</b>
            <span>Cards improve you</span>
          </div>
        )}
      </div>

      {advice.outs.groups.length > 0 && (
        <div className="outs">
          {advice.outs.groups.map((group) => (
            <span className="out-group" key={group.makes} title={group.cards.map(cardCode).join(' ')}>
              {group.makes}: <b>{group.cards.length}</b>
              <span className="faint">{pct(group.byRiver)} by river</span>
            </span>
          ))}
        </div>
      )}

      <ul>
        {rec.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
      </ul>

      {narrator && (
        <Explain advice={advice} position={position ?? 'in this seat'} narrator={narrator} />
      )}

      <p className="sub" style={{ margin: 0, fontSize: 10.5 }}>
        Equity is {equity.exact ? 'counted exactly' : `sampled over ${equity.runouts.toLocaleString()} runouts`}
        {advice.assumedRange > 0
          ? ', against opponents credited with hands worth playing rather than random '
            + 'cards — tighter from early position, tighter again for anyone who raised. '
            + 'A heuristic, not a solver.'
          : '.'}
        {advice.outs.count > 0 && ' Cards that improve you are not the same as cards that win — the equity figure already accounts for that.'}
      </p>
    </div>
  )
}

/** The running leak report. */
export function CoachScorecard({ stats, onReset }: { stats: CoachStats; onReset: () => void }) {
  const accuracy = stats.decisions > 0 ? stats.agreed / stats.decisions : 0
  const leaks = Object.entries(stats.leaks).sort((a, b) => b[1] - a[1])

  return (
    <>
      <div className="summary-grid">
        <div className="summary-cell"><b>{stats.handsPlayed}</b><span>Hands coached</span></div>
        <div className="summary-cell"><b>{stats.decisions}</b><span>Decisions</span></div>
        <div className="summary-cell">
          <b>{stats.decisions ? pct(accuracy) : '—'}</b><span>Matched the coach</span>
        </div>
        <div className="summary-cell">
          <b className={stats.evLost > 0 ? 'neg' : ''}>{money(stats.evLost)}</b>
          <span>EV given up</span>
        </div>
      </div>

      {leaks.length > 0 && (
        <>
          <p className="sub" style={{ marginBottom: 6 }}>Where it goes wrong most often:</p>
          {leaks.map(([leak, count]) => (
            <div className="kv" key={leak}>
              <span>{leak}</span>
              <b>{count}</b>
            </div>
          ))}
        </>
      )}

      {stats.decisions === 0 && (
        <p className="sub">
          No decisions reviewed yet. Play some hands in coach mode and the leaks will
          show up here.
        </p>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn small danger" onClick={onReset} disabled={stats.decisions === 0}>
          Reset coach stats
        </button>
      </div>
    </>
  )
}
