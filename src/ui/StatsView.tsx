import { useMemo, useState } from 'react'
import { money, signedMoney } from '../engine/bnotw'
import {
  diagnose, rating, ratingBand, tendencies, winRate,
  PROVISIONAL_DECISIONS, RATING_BASE,
  type Tendency,
} from '../engine/playerStats'
import type { HandRecord } from '../engine/playerStats'
import { leakBrief } from '../engine/brief'
import { ReplayView } from './ReplayView'
import type { NarratorApi } from './useNarrator'
import type { TrackerApi } from './useTracker'

export function StatsView({
  tracker, narrator,
}: {
  tracker: TrackerApi
  /** Optional review service; absent when none is configured. */
  narrator?: NarratorApi
}) {
  const { totals } = tracker
  const [confirmReset, setConfirmReset] = useState(false)
  const [replaying, setReplaying] = useState<HandRecord | null>(null)

  /** The hands that cost the most, worst first — the ones worth looking at. */
  const worst = useMemo(
    () => tracker.recent
      .filter((h) => h.replay && h.decisions.some((d) => d.evLost > 0))
      .map((h) => ({ hand: h, lost: h.decisions.reduce((sum, d) => sum + d.evLost, 0) }))
      .sort((a, b) => b.lost - a.lost)
      .slice(0, 6),
    [tracker.recent],
  )

  const score = useMemo(() => rating(totals), [totals])
  const results = useMemo(() => winRate(totals), [totals])
  const stats = useMemo(() => tendencies(totals), [totals])
  const notes = useMemo(() => diagnose(totals), [totals])

  if (totals.hands === 0) {
    return (
      <div className="scroll">
        <div className="panel">
          <h2>Your Game</h2>
          <div className="empty">
            Nothing tracked yet.<br />
            Play some hands at the table or in coach mode and your tendencies,
            your rating and your leaks will build up here.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="scroll">
      <div className="panel">
        <h2>BNOTW Rating</h2>
        <div className="rating-head">
          <div className="rating-value">
            <b>{score.value}</b>
            <span>
              {score.margin < 400 ? `± ${score.margin}` : 'wide open'}
            </span>
          </div>
          <div className="rating-band">
            <b>{score.band}</b>
            <span className="faint">
              {score.provisional
                ? `Provisional — ${score.decisions} of ${PROVISIONAL_DECISIONS} decisions scored`
                : `${score.decisions.toLocaleString()} decisions scored`}
            </span>
          </div>
        </div>

        <RatingScale value={score.value} margin={score.margin} />

        <p className="sub" style={{ marginTop: 12 }}>
          This is not built on whether you won. It is built on how much expected
          value your decisions gave up against the line the coach would take —
          the same reason a chess engine rates a player by accuracy rather than
          by their win/loss record. It says far more, far sooner.
        </p>
        <div className="summary-grid">
          <div className="summary-cell">
            <b className={score.evLossPer100 > 40 ? 'neg' : 'pos'}>
              {score.evLossPer100.toFixed(0)}
            </b>
            <span>EV index /100 hands</span>
          </div>
          <div className="summary-cell">
            <b>{Math.round(score.agreement * 100)}%</b>
            <span>Matched the coach</span>
          </div>
          <div className="summary-cell"><b>{totals.hands.toLocaleString()}</b><span>Hands tracked</span></div>
          <div className="summary-cell">
            <b>{totals.handsByMode.coach.toLocaleString()}</b><span>Of those, coached</span>
          </div>
        </div>
        <p className="sub" style={{ margin: 0 }}>
          {RATING_BASE} is playing the coach's line exactly, and every point of EV
          you give up costs rating. The band around the number is a real
          confidence interval, so a rating built on thirty hands says so.
        </p>
        <p className="sub" style={{ margin: 0 }}>
          One caveat worth knowing: the EV index prices every decision on its own,
          as though the hand ended there, so it overstates what actually leaves
          your stack — measured at about six to one against real win rate. It
          is for comparing yourself against yourself over time, not a dollar figure.
        </p>
      </div>

      <div className="panel">
        <h2>Tendencies</h2>
        <p className="sub">
          What you actually do, in the terms a poker tracker uses. These are
          descriptive — there is no wrong VPIP, only one that does not match how
          you are trying to play. The shaded band is rough guidance for a
          six-handed game, not a rule; a friendly live game runs looser than this
          across the board.
        </p>
        {stats.map((stat) => <TendencyRow key={stat.key} stat={stat} />)}
      </div>

      {notes.length > 0 && (
        <div className="panel">
          <h2>What to work on</h2>
          {notes.map((note, i) => (
            <div className={`note ${note.tone}`} key={i}>{note.text}</div>
          ))}

          {narrator?.available && (
            <>
              <p className="sub" style={{ marginTop: 12 }}>
                The notes above come from fixed thresholds. A review reads across
                everything at once — your tendencies, your leak counts, the
                per-street breakdown and the individual hands that cost the most —
                and looks for the theme they share.
              </p>
              {!narrator.result && !narrator.loading && (
                <button
                  className="btn primary"
                  onClick={() => narrator.ask({ kind: 'leaks', brief: leakBrief(totals, tracker.recent) })}
                  disabled={totals.decisions < 20}
                >
                  {totals.decisions < 20
                    ? `Review my game (needs ${20 - totals.decisions} more decisions)`
                    : 'Review my game'}
                </button>
              )}
              {narrator.loading && <div className="explain-body faint">Reading your history…</div>}
              {narrator.error && (
                <div className="warn bad">
                  {narrator.error}
                  <button
                    className="btn small ghost"
                    style={{ marginLeft: 8 }}
                    onClick={() => narrator.ask({ kind: 'leaks', brief: leakBrief(totals, tracker.recent) })}
                  >
                    Try again
                  </button>
                </div>
              )}
              {narrator.result && (
                <>
                  <div className="explain-body">{narrator.result.text}</div>
                  {narrator.result.findings?.map((finding, i) => (
                    <div className="finding" key={i}>
                      <b>{finding.title}</b>
                      <p>{finding.detail}</p>
                      <p className="fix">→ {finding.fix}</p>
                    </div>
                  ))}
                  <button className="btn small ghost" onClick={narrator.clear}>Clear</button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className="panel">
        <h2>Results</h2>
        <div className="summary-grid">
          <div className="summary-cell">
            <b className={results.net >= 0 ? 'pos' : 'neg'}>{signedMoney(results.net)}</b>
            <span>Net across all hands</span>
          </div>
          <div className="summary-cell">
            <b className={results.bbPer100 >= 0 ? 'pos' : 'neg'}>
              {results.bbPer100 >= 0 ? '+' : ''}{results.bbPer100.toFixed(1)}
            </b>
            <span>bb / 100 hands</span>
          </div>
          <div className="summary-cell">
            <b>{Math.round(totals.handsWon / Math.max(1, totals.hands) * 100)}%</b>
            <span>Hands won</span>
          </div>
          <div className="summary-cell">
            <b>{totals.dexterWon}</b><span>Dexters won</span>
          </div>
        </div>

        {Number.isFinite(results.margin) && (
          <div className="warn">
            Your win rate is <b>{results.bbPer100.toFixed(1)} ± {results.margin.toFixed(1)}</b> bb/100
            — anywhere from {(results.bbPer100 - results.margin).toFixed(1)} to{' '}
            {(results.bbPer100 + results.margin).toFixed(1)}.{' '}
            {Math.abs(results.bbPer100) < results.margin
              ? 'That band covers both a winning player and a losing one, which is exactly why results make a poor rating.'
              : `That band is ${(results.margin * 2).toFixed(0)} bb/100 wide — far too wide to call a win rate, which is why results make a poor rating.`}
            {' '}Narrowing it to ±5 bb/100 would take about{' '}
            <b>{results.handsForConfidence.toLocaleString()}</b> more hands than most home games will ever see.
          </div>
        )}

        {totals.bombHands > 0 && (
          <div className="kv">
            <span>Bomb pots ({totals.bombHands})</span>
            <b className={totals.bombNet >= 0 ? 'pos' : 'neg'}>{signedMoney(totals.bombNet)}</b>
          </div>
        )}
        {totals.couldStraddle > 0 && (
          <div className="kv">
            <span>Straddled</span>
            <b>
              {totals.straddled} of {totals.couldStraddle} hands
              {' '}({Math.round((totals.straddled / totals.couldStraddle) * 100)}%)
            </b>
          </div>
        )}
        {totals.dexterHeld > 0 && (
          <div className="kv">
            <span>Dealt the Dexter</span>
            <b>{totals.dexterHeld} time{totals.dexterHeld === 1 ? '' : 's'}</b>
          </div>
        )}
      </div>

      {Object.keys(totals.byStreet).length > 0 && (
        <div className="panel">
          <h2>Where it goes wrong</h2>
          <div className="tablewrap">
            <table className="grid" style={{ minWidth: 380 }}>
              <thead>
                <tr><th>Street</th><th>Decisions</th><th>Matched</th><th>EV given up</th></tr>
              </thead>
              <tbody>
                {['preflop', 'flop', 'turn', 'river'].filter((s) => totals.byStreet[s]).map((street) => {
                  const row = totals.byStreet[street]
                  return (
                    <tr key={street}>
                      <td style={{ textTransform: 'capitalize' }}>{street}</td>
                      <td>{row.decisions}</td>
                      <td>{Math.round((row.agreed / row.decisions) * 100)}%</td>
                      <td className={row.evLost > 0 ? 'neg' : ''}>{money(row.evLost)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {Object.entries(totals.leaks).sort((a, b) => b[1] - a[1]).map(([leak, count]) => (
            <div className="kv" key={leak}><span>{leak}</span><b>{count}</b></div>
          ))}
        </div>
      )}

      {worst.length > 0 && (
        <div className="panel">
          <h2>Worth a Second Look</h2>
          <p className="sub">
            The hands that cost you the most against the coach's line. Replaying one
            shows every hand face up and the real odds at each street.
          </p>
          {worst.map(({ hand, lost }) => (
            <button
              key={`${hand.mode}-${hand.handNumber}-${hand.at}`}
              className="worst-row"
              onClick={() => setReplaying(hand)}
            >
              <span className="num">{hand.hole}</span>
              <span className="faint">#{hand.handNumber}</span>
              <span className="spacer" />
              <span className="neg num">-{money(lost)}</span>
              <span className="faint">replay ›</span>
            </button>
          ))}
        </div>
      )}

      <div className="panel">
        <h2>Recent Hands</h2>
        <p className="sub">
          The last {tracker.recent.length} hands — tap one to replay it. The totals
          above cover everything ever played, not just these. Older hands keep their
          row but drop the replay, so the history stays storable.
        </p>
        <div className="tablewrap">
          <table className="grid" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>Hand</th><th>Hole</th><th>Saw flop</th><th>Showdown</th>
                <th>Decisions</th><th>EV lost</th><th>Net</th><th />
              </tr>
            </thead>
            <tbody>
              {tracker.recent.slice(0, 40).map((hand, i) => (
                <tr
                  key={`${hand.mode}-${hand.handNumber}-${i}`}
                  className={hand.replay ? 'clickable' : ''}
                  onClick={() => hand.replay && setReplaying(hand)}
                >
                  <td>
                    #{hand.handNumber}
                    {hand.bomb && <span className="tag bomb" style={{ marginLeft: 6 }}>Bomb</span>}
                    {hand.mode === 'coach' && <span className="tag" style={{ marginLeft: 6, color: '#6fd3e8' }}>Coach</span>}
                  </td>
                  <td className="num">{hand.hole}</td>
                  <td>{hand.sawFlop ? 'Yes' : '—'}</td>
                  <td>{hand.showdown ? (hand.wonShowdown ? 'Won' : 'Lost') : '—'}</td>
                  <td>{hand.decisions.length}</td>
                  <td className={hand.decisions.some((d) => d.evLost > 0) ? 'neg' : 'faint'}>
                    {money(hand.decisions.reduce((s, d) => s + d.evLost, 0))}
                  </td>
                  <td className={hand.net >= 0 ? 'pos' : 'neg'}>{signedMoney(hand.net)}</td>
                  <td className="faint">{hand.replay ? '›' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Start Over</h2>
        <p className="sub">
          Clears every tracked hand, your tendencies and your rating. The Record
          Book is separate and is not touched.
        </p>
        <div className="row">
          {confirmReset ? (
            <>
              <button className="btn danger" onClick={() => { tracker.reset(); setConfirmReset(false) }}>
                Yes, erase my history
              </button>
              <button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn small danger" onClick={() => setConfirmReset(true)}>
              Reset my stats
            </button>
          )}
        </div>
      </div>

      {replaying?.replay && (
        <ReplayView
          replay={replaying.replay}
          decisions={replaying.decisions}
          onClose={() => setReplaying(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function RatingScale({ value, margin }: { value: number; margin: number }) {
  // Wide enough that genuinely careless play still lands on the scale rather
  // than pinning silently at the end of it.
  const LOW = 700
  const HIGH = 1550
  const place = (v: number) => ((Math.max(LOW, Math.min(HIGH, v)) - LOW) / (HIGH - LOW)) * 100
  const band = Math.min(100, (margin / (HIGH - LOW)) * 100)

  return (
    <div className="rating-scale">
      <div className="rating-track">
        {margin < 400 && (
          <i
            className="rating-margin"
            style={{ left: `${Math.max(0, place(value) - band)}%`, width: `${Math.min(100, band * 2)}%` }}
          />
        )}
        <u style={{ left: `${place(value)}%` }} />
      </div>
      <div className="rating-labels">
        {[850, 1150, 1340, 1445, 1520].map((v) => (
          <span key={v} style={{ left: `${place(v)}%` }}>{ratingBand(v)}</span>
        ))}
      </div>
    </div>
  )
}

function TendencyRow({ stat }: { stat: Tendency }) {
  const max = stat.format === 'percent' ? 1 : 6
  const place = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  const show = (v: number) =>
    stat.format === 'percent' ? `${(v * 100).toFixed(1)}%` : v.toFixed(2)

  return (
    <div className="tendency">
      <div className="tendency-head">
        <b>{stat.label}</b>
        <span className="spacer" />
        {stat.value === null
          ? <span className="faint">needs {20 - stat.samples} more</span>
          : <span className="num">{show(stat.value)}</span>}
      </div>
      <div className="tendency-track">
        <i
          className="tendency-target"
          style={{
            left: place(stat.target[0]),
            width: `${((stat.target[1] - stat.target[0]) / max) * 100}%`,
          }}
        />
        {stat.value !== null && <u style={{ left: place(stat.value) }} />}
      </div>
      <p className="tendency-blurb">
        {stat.blurb}
        {stat.value !== null && (
          <span className="faint">
            {' '}Guidance: {show(stat.target[0])}–{show(stat.target[1])}.
          </span>
        )}
      </p>
    </div>
  )
}
