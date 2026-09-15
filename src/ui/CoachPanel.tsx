import { useState } from 'react'
import { money, signedMoney } from '../engine/bnotw'
import { cardCode } from '../engine/cards'
import { pct, type CoachAdvice, type DecisionReview } from '../engine/coach'
import { allLayers, type LayerId } from '../engine/layers'
import type { Read } from '../engine/reads'
import type { CoachStats } from '../state/storage'
import { Explain } from './Explain'
import type { NarratorApi } from './useNarrator'

/** What the table's own rules are doing to this hand, if anything. */
export interface TableNote {
  label: string
  text: string
}

/** The advice panel shown while it is your turn in coach mode. */
export function CoachPanel({
  advice, review, narrator, position, pending = false, speaker, second = null,
  layers = allLayers(), reads = [], tableNotes = [],
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
  /**
   * Which layers are on. Everything, unless told otherwise — a caller that has
   * not been taught about layers should not silently lose panels.
   */
  layers?: readonly LayerId[]
  /** How each live opponent has been playing. Shown by the player layer. */
  reads?: { seat: number; name: string; read: Read }[]
  /** What the house rules are doing to this hand. Shown by the table layer. */
  tableNotes?: TableNote[]
}) {
  const on = (id: LayerId) => layers.includes(id)
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

      {/*
        With only the price layer on, the bar shows the bar to clear and not
        how close you are to it. That is the layer's whole question: work out
        what you need, then go and decide whether you have it.
      */}
      <div className="equity-bar" title={on('hand') ? `${pct(equity.equity)} equity` : undefined}>
        {on('hand') && <i style={{ width: `${Math.min(100, equity.equity * 100)}%` }} />}
        {facing && <u style={{ left: `${Math.min(100, advice.breakEven * 100)}%` }} />}
      </div>
      {facing && (
        <p className="sub" style={{ margin: '0 0 8px', fontSize: 11 }}>
          The gold mark is the {pct(advice.breakEven)} you need to break even on the call.
          {!on('hand') && ' Turn on The hand to see where you actually stand against it.'}
        </p>
      )}

      <div className="coach-grid">
        {on('hand') && (
          <div className="coach-cell">
            <b>{pct(equity.equity)}</b>
            <span>Equity vs {advice.opponents}</span>
          </div>
        )}
        {on('hand') && !preflop && (
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
        {on('hand') && advice.outs.count > 0 && (
          <div className="coach-cell">
            <b>{advice.outs.count}</b>
            <span>Cards improve you</span>
          </div>
        )}
      </div>

      {on('hand') && preflop && <ChenLine starting={advice.starting} />}

      {on('player') && <PlayerLayer advice={advice} position={position} reads={reads} />}

      {on('table') && tableNotes.length > 0 && (
        <div className="layer-panel">
          <h4>This table</h4>
          {tableNotes.map((note) => (
            <p key={note.label}>
              <b>{note.label}</b> {note.text}
            </p>
          ))}
        </div>
      )}

      {on('hand') && advice.outs.groups.length > 0 && (
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

      {on('hand') && (
        <p className="sub" style={{ margin: 0, fontSize: 10.5 }}>
          Equity is {equity.exact ? 'counted exactly' : `sampled over ${equity.runouts.toLocaleString()} runouts`}
          {advice.assumedRange > 0
            ? ', against opponents credited with hands worth playing rather than random '
              + 'cards — tighter from early position, tighter again for anyone who raised. '
              + 'A heuristic, not a solver.'
            : '.'}
          {advice.outs.count > 0 && ' Cards that improve you are not the same as cards that win — the equity figure already accounts for that.'}
        </p>
      )}
    </div>
  )
}

/**
 * Chen, ranked and explained rather than pinned.
 *
 * The complaint that produced this was that Chen was "messing with my game" —
 * and the number was not wrong, it was *unranked*. It sat in a tile the same
 * size as equity, so it read as an equal authority on a decision it knows far
 * less about than equity does. It is a pre-flop shorthand that never sees the
 * board, the position or the players.
 *
 * So it keeps its place — it is a genuinely useful tool for "is this hand
 * worth entering with" — as one line, under the numbers that outrank it, with
 * what it is and what it ignores one tap away.
 */
function ChenLine({ starting }: { starting: CoachAdvice['starting'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="chenline">
      <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
        <b>{starting.label}</b>
        <span className={`chen-grade g-${starting.grade.toLowerCase()}`}>{starting.grade}</span>
        <span className="faint">Chen {starting.chen}</span>
        <span className="spacer" />
        <button
          className="btn tiny ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide' : "What's Chen?"}
        </button>
      </div>
      <p className="sub" style={{ margin: '4px 0 0' }}>{starting.note}</p>
      {open && (
        <div className="chen-explain">
          <p>
            A shorthand for how good two cards are before the flop. Points for
            the higher card, doubled for a pair, a bonus for suited and for
            being connected, a penalty for the gap between them. Pocket aces
            score 20; 7-2 offsuit scores below zero.
          </p>
          <p>
            <b>What it is good for:</b> one quick answer to "is this worth
            playing at all", which is the question you have most often and the
            one it is hardest to be honest with yourself about.
          </p>
          <p>
            <b>What it does not know:</b> the board, your position, the size of
            the bet, or who is in the pot. That is why it sits below the equity
            here rather than beside it — a Chen score never changes, and the
            hand it describes plays completely differently from the button than
            it does under the gun. Where the two disagree, believe the equity.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Who you are up against.
 *
 * The range figure was always in the footnote; this is the layer where it
 * stops being a caveat and becomes the point. The reads are the bots' own
 * observed behaviour — the same numbers they use on each other — and every one
 * of them says how much it has actually seen, because a fold rate over four
 * hands is a rumour rather than a read.
 */
function PlayerLayer({
  advice, position, reads,
}: {
  advice: CoachAdvice
  position?: string
  reads: { seat: number; name: string; read: Read }[]
}) {
  return (
    <div className="layer-panel">
      <h4>The players</h4>
      <p>
        You are <b>{position ?? 'in this seat'}</b>, against{' '}
        <b>{advice.opponents}</b>{' '}
        {advice.opponents === 1 ? 'opponent' : 'opponents'}
        {advice.assumedRange > 0
          ? <>, credited with hands scoring <b>{advice.assumedRange}</b> or better on Chen.</>
          : ', credited with any two cards.'}
      </p>
      {reads.length > 0 ? (
        <div className="reads">
          {reads.map(({ seat, name, read }) => (
            <div className="read-row" key={seat}>
              <span className="read-name">{name}</span>
              {read.confidence < 0.25 ? (
                <span className="faint">not seen enough yet</span>
              ) : (
                <>
                  <span>folds {pct(read.foldRate)}</span>
                  <span className="faint">bets {pct(read.aggression)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="sub" style={{ margin: 0 }}>
          Nobody left to read — the reads build up as the session goes on.
        </p>
      )}
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
