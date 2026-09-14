import { useEffect, useMemo, useState } from 'react'
import { money, signedMoney } from '../engine/bnotw'
import { pct } from '../engine/coach'
import {
  frameEquity, frameHand, replayFrames, type HandReplay, type ReplayFrame,
} from '../engine/replay'
import { BOMB_POT_GAMES } from '../engine/bnotw'
import type { DecisionRecord } from '../engine/playerStats'
import { CardRow } from './pieces'

/**
 * Step through a finished hand.
 *
 * The equity here is not the coach's estimate — every hand is face up, so it
 * is the true number, counted exactly wherever the runout is small enough.
 * Seeing what you actually had against what you actually faced is the whole
 * point of a replay.
 */
export function ReplayView({
  replay, decisions, onClose, note = '', onNote,
}: {
  replay: HandReplay
  decisions: DecisionRecord[]
  onClose: () => void
  /** What you wrote about this hand, if anything. */
  note?: string
  onNote?: (note: string) => void
}) {
  const frames = useMemo(() => replayFrames(replay), [replay])
  const [index, setIndex] = useState(0)
  const [showAll, setShowAll] = useState(true)
  const frame = frames[Math.min(index, frames.length - 1)]

  const equity = useMemo(
    () => (showAll ? frameEquity(frame) : null),
    [frame, showAll],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, frames.length - 1))
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [frames.length, onClose])

  const hero = frame.seats.find((s) => s.isHero)
  const heroDecisions = decisions.filter((d) => d.street === frame.street)
  const decisionHere = frame.entry && frame.entry.seat === replay.heroSeat
    ? heroDecisions.find((d) => d.action === frame.entry!.kind)
    : undefined

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog replay" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Hand #{replay.handNumber}</h2>
            <span className="faint" style={{ fontSize: 11.5 }}>
              {replay.bombGame
                ? `Bomb pot · ${BOMB_POT_GAMES[replay.bombGame].name}`
                : "$0.25/$0.50 Hold'em"}
            </span>
          </div>
          <span className="spacer" />
          <label className="xray-row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            <span style={{ fontSize: 11.5 }}>Show everyone</span>
          </label>
          <button className="btn small ghost" onClick={onClose} aria-label="Close replay">✕</button>
        </div>

        <div className="replay-board">
          <div className="replay-cards">
            <CardRow cards={frame.board} size="big" placeholders={5} />
          </div>
          <div className="pot" style={{ marginTop: 8 }}>
            <span>{frame.settled ? 'Paid out' : 'Pot'}</span>
            <b className="num">{money(frame.pot)}</b>
          </div>
        </div>

        <div className="replay-caption">{frame.caption}</div>

        <div className="replay-seats">
          {frame.seats.map((seat) => {
            const odds = equity?.bySeat.get(seat.seat)
            const made = showAll ? frameHand(frame, seat.seat) : null
            const acting = frame.entry?.seat === seat.seat
            return (
              <div
                key={seat.seat}
                className={[
                  'replay-seat',
                  seat.folded ? 'folded' : '',
                  seat.isHero ? 'replay-hero' : '',
                  acting ? 'acting' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="replay-seat-head">
                  <b>{seat.name}</b>
                  {seat.isButton && <span className="tag gold">D</span>}
                  <span className="spacer" />
                  <span className="num faint">{money(seat.stack)}</span>
                </div>
                <div className="replay-seat-cards">
                  <div className="replay-cards">
                    <CardRow
                      cards={seat.hole}
                      size="small"
                      faceDown={!showAll && !seat.isHero}
                    />
                  </div>
                  {odds && !seat.folded && (
                    <span className="replay-odds">{pct(odds.equity)}</span>
                  )}
                  {seat.committed > 0 && (
                    <span className="replay-bet num">{money(seat.committed)}</span>
                  )}
                </div>
                {made && !seat.folded && <div className="replay-made">{made}</div>}
                {seat.discarded && (
                  <div className="replay-made faint">pitched {seat.discarded}</div>
                )}
              </div>
            )
          })}
        </div>

        {decisionHere && (
          <div className={`feedback ${decisionHere.agreed ? 'ok' : 'off'}`}>
            {decisionHere.agreed
              ? `You ${decisionHere.action}ed here, and that was the play.`
              : `You ${decisionHere.action}ed here. The coach would have ${verb(decisionHere.recommended)}` +
                `${decisionHere.evLost > 0 ? `, giving up about ${money(decisionHere.evLost)}` : ''}.`}
          </div>
        )}

        {equity && (
          <p className="sub" style={{ margin: '0 0 8px', fontSize: 11 }}>
            Every hand is face up here, so these are the real odds —{' '}
            {equity.exact ? 'every runout counted' : 'sampled, since there are too many runouts to count'}.
          </p>
        )}

        <div className="replay-controls">
          <button className="btn small" onClick={() => setIndex(0)} disabled={index === 0}>⏮</button>
          <button
            className="btn small"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={index === 0}
          >
            ‹ Back
          </button>
          <span className="replay-progress num">{frame.index + 1} / {frames.length}</span>
          <button
            className="btn small primary"
            onClick={() => setIndex((i) => Math.min(i + 1, frames.length - 1))}
            disabled={index >= frames.length - 1}
          >
            Next ›
          </button>
          <button
            className="btn small"
            onClick={() => setIndex(frames.length - 1)}
            disabled={index >= frames.length - 1}
          >
            ⏭
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label="Position in the hand"
        />

        {frame.settled && replay.dexter && (
          <div className="warn">
            DEXTER — {nameOf(replay, replay.dexter.seat)} showed the 7-2 and collected{' '}
            {money(replay.dexter.total)} from the table.
          </div>
        )}
        {frame.settled && hero && (
          <div className="kv">
            <span>Your result</span>
            <b className={heroNet(replay) >= 0 ? 'pos' : 'neg'}>{signedMoney(heroNet(replay))}</b>
          </div>
        )}

        {onNote && <HandNote note={note} onNote={onNote} />}
      </div>
    </div>
  )
}

/**
 * Why you did what you did.
 *
 * The tracker records what you did and whether the coach agreed; it has no
 * idea why, and the reasoning is usually the thing that was actually wrong.
 * "Called too light" cannot tell a misread price from a read on the villain
 * from being on tilt from the hand before — and by tomorrow neither can you.
 *
 * Saved on blur rather than on every keystroke: a note is a sentence, not a
 * stream, and writing through to storage per character is wasted work.
 */
function HandNote({ note, onNote }: { note: string; onNote: (note: string) => void }) {
  const [draft, setDraft] = useState(note)
  const [saved, setSaved] = useState(false)

  const commit = () => {
    if (draft.trim() === note.trim()) return
    onNote(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
      <label htmlFor="handnote">
        Why you played it that way {saved && <span className="pos">· saved</span>}
      </label>
      <textarea
        id="handnote"
        value={draft}
        placeholder="Had him on a draw. Wanted to charge it."
        maxLength={600}
        style={{ minHeight: 64 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      <p className="sub" style={{ marginTop: 4 }}>
        Kept with the hand, and kept ahead of everything else when old hands are
        trimmed — it is the only part of a hand you cannot get back by playing more.
      </p>
    </div>
  )
}

function heroNet(replay: HandReplay): number {
  const hero = replay.seats.find((s) => s.seat === replay.heroSeat)
  if (!hero) return 0
  const paid = replay.journal
    .filter((e) => e.seat === replay.heroSeat)
    .reduce((sum, e) => sum + e.amount, 0)
  return hero.won - paid
}

function nameOf(replay: HandReplay, seat: number): string {
  return replay.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`
}

function verb(kind: DecisionRecord['recommended']): string {
  switch (kind) {
    case 'fold': return 'folded'
    case 'check': return 'checked'
    case 'call': return 'called'
    case 'bet': return 'bet'
    default: return 'raised'
  }
}

export type { ReplayFrame }
