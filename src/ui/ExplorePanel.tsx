/**
 * What each line was worth, shown as a range rather than a number.
 *
 * The temptation is a leaderboard: fold +0.0, call -2.8, raise -4.1, sorted.
 * That would be the most readable thing on the screen and the least true —
 * most of the time the bands overlap and the honest answer is that two lines
 * are too close to tell apart. So the ordering is the order they were offered,
 * the band is drawn rather than tucked into a tooltip, and when nothing is
 * separated the panel says so instead of picking a winner.
 */

import { money } from '../engine/bnotw'
import { pct } from '../engine/coach'
import { OPPONENT_BIAS, type Exploration, type Line } from '../engine/explore'

function Band({ line, widest }: { line: Line; widest: number }) {
  const { mean, margin } = line.outcome
  const scale = (value: number) => 50 + (value / (widest * 2)) * 100
  const from = Math.max(0, scale(mean - (Number.isFinite(margin) ? margin : 0)))
  const to = Math.min(100, scale(mean + (Number.isFinite(margin) ? margin : 0)))

  return (
    <div className="expband">
      <i className="expzero" />
      <i
        className={`expspread ${mean >= 0 ? 'pos' : 'neg'}`}
        style={{ left: `${Math.min(from, to)}%`, width: `${Math.max(1.5, Math.abs(to - from))}%` }}
      />
      <i className="expmean" style={{ left: `${Math.min(99, Math.max(1, scale(mean)))}%` }} />
    </div>
  )
}

export function ExplorePanel({
  exploration, running, failed, onClose,
}: {
  exploration: Exploration | null
  running: boolean
  failed: boolean
  onClose?: () => void
}) {
  if (running) {
    return (
      <div className="explore">
        <h3>Working it out</h3>
        <p className="sub" style={{ margin: 0 }}>
          Playing each line out a hundred times or so. One replay would be an
          anecdote, so this takes a moment.
        </p>
      </div>
    )
  }

  if (failed || !exploration) {
    if (!failed) return null
    return (
      <div className="explore">
        <h3>Had you played it differently</h3>
        <p className="sub" style={{ margin: 0 }}>
          This spot could not be rebuilt from the stored hand. Showing nothing
          beats showing a number from a hand that did not happen.
        </p>
      </div>
    )
  }

  const all = [exploration.played, ...exploration.lines]
  const widest = Math.max(
    1,
    ...all.map((l) => Math.abs(l.outcome.mean) + (Number.isFinite(l.outcome.margin) ? l.outcome.margin : 0)),
  )

  return (
    <div className="explore">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Had you played it differently</h3>
        <span className="spacer" />
        {onClose && <button className="btn small ghost" onClick={onClose}>Hide</button>}
      </div>

      <p className="sub">
        Each line played out {exploration.played.outcome.trials} times from this
        point, with a fresh runout every time. The bar is the range the answer
        actually sits in, not a margin of error to ignore.
      </p>

      <div className="explines">
        {all.map((line) => (
          <div className={`expline ${line === exploration.played ? 'played' : ''}`} key={line.label}>
            <div className="explabel">
              <b>{line.label}</b>
              {line === exploration.played && <span className="tag">Played</span>}
            </div>
            <Band line={line} widest={widest} />
            <div className="expfigures">
              <span className={line.outcome.mean >= 0 ? 'pos' : 'neg'}>
                {line.outcome.mean >= 0 ? '+' : ''}{money(Math.round(line.outcome.mean))}
              </span>
              <span className="faint">
                {Number.isFinite(line.outcome.margin)
                  ? `± ${money(Math.round(line.outcome.margin))}`
                  : '± unknown'}
              </span>
              <span className="faint">{pct(line.outcome.aheadShare)} ahead</span>
            </div>
          </div>
        ))}
      </div>

      {/*
        The headline finding, and usually this one. Two lines whose bands
        overlap have not been told apart, and saying so is the whole value —
        a feature that always crowns a winner teaches confidence it has not
        earned.
      */}
      <p className={`expverdict ${exploration.separated ? '' : 'flat'}`}>
        {exploration.separated
          ? 'At least two of these are far enough apart to tell apart. Where the bars overlap, they are not.'
          : 'None of these are far enough apart to tell apart. On this hand, the line you took was as good a guess as any of them.'}
      </p>

      <p className="expcaveat">
        Everyone&rsquo;s cards are held as they were dealt, so this answers
        &ldquo;what would this line have done <i>in this hand</i>&rdquo; — not
        whether it is right in spots like it. {OPPONENT_BIAS}
      </p>
    </div>
  )
}
