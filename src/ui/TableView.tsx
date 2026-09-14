import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BIG_BLIND, BOMB_POT_GAMES, CHIP_INCREMENT, NAMED_BETS, SMALL_BLIND,
  money, namedBetFor, toChipIncrement,
} from '../engine/bnotw'
import { shortHand } from '../engine/handEval'
import { advise, pct, showdownEquity, type CoachAdvice, type EquityResult } from '../engine/coach'
import { bestHand, legalActions, livePlayers, potTotal } from '../engine/hand'
import type { Action, HandPlayer, HandState, Seat as SeatModel } from '../engine/types'
import { Avatar } from './Avatar'
import { CoachPanel } from './CoachPanel'
import { CardRow, PlayingCard } from './pieces'
import type { PlayMode } from '../engine/playerStats'
import type { CoachApi } from './useCoach'
import type { GameApi } from './useGame'
import type { TrackerApi } from './useTracker'

/** Seats sit on an ellipse with the human parked at the bottom. */
function ellipse(index: number, total: number, rx: number, ry: number) {
  const angle = ((180 + (index * 360) / total) * Math.PI) / 180
  return { x: 50 + rx * Math.sin(angle), y: 50 - ry * Math.cos(angle) }
}

/**
 * Where a seat's bet chips sit: between the seat and the middle, on a ring
 * that tightens for the seats directly above and below the board and widens
 * for the ones off to the sides. A single radius cannot clear both the seat
 * plates at the top and bottom and the board across the middle.
 */
function betSpot(index: number, total: number) {
  const angle = ((180 + (index * 360) / total) * Math.PI) / 180
  const vertical = Math.abs(Math.cos(angle))
  return ellipse(index, total, 19 + (1 - vertical) * 7, 21 + (1 - vertical) * 9)
}

export function TableView({
  game, onCashOut, coach, tracker, mode = 'table',
}: {
  game: GameApi
  onCashOut: () => void
  /** Present only in coach mode. */
  coach?: CoachApi
  /** Records how you play, in both modes. */
  tracker?: TrackerApi
  mode?: PlayMode
}) {
  const { table, version } = game
  const hand = table.hand
  void version // re-render key: the engine mutates in place

  const pot = hand ? potTotal(hand) : 0
  const bombDue = table.bombPotDue()
  const seat = table.human.seat
  const myTurn = hand?.phase === 'acting' && hand.actingSeat === seat

  // Work out the advice only when the decision is actually ours; the
  // simulation is cheap but not free.
  const advice = useMemo<CoachAdvice | null>(() => {
    if (!coach || !myTurn || !hand) return null
    return advise(hand, table.seats, seat, Math.random, 1500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach, myTurn, version, hand, seat, table.seats])

  // X-ray: every hand face up, with the odds a broadcast would put on screen.
  const xrayOdds = useMemo<Map<number, EquityResult> | null>(() => {
    if (!coach?.xray || !hand || hand.complete) return null
    const live = livePlayers(hand).filter((p) => p.hole.length >= 2)
    if (live.length < 2) return null
    const results = showdownEquity(
      live.map((p) => p.hole), hand.board, Math.random,
      hand.board.length === 0 ? 1000 : 4000,
    )
    return new Map(live.map((p, i) => [p.seat, results[i]]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach?.xray, version, hand])

  // Wrap a finished hand up exactly once. Keyed on the hand itself, because a
  // fresh session restarts the numbering from one.
  const countedRef = useRef(new WeakSet<HandState>())
  useEffect(() => {
    if (!hand?.complete || countedRef.current.has(hand)) return
    countedRef.current.add(hand)
    coach?.countHand()
    tracker?.completeHand(table, mode)
  }, [coach, tracker, table, mode, hand, hand?.complete])

  const act = (action: Action) => {
    // In coach mode the advice is already on screen. In normal play it is
    // worked out here instead, so tracking costs nothing until the moment a
    // decision is actually made and never slows a render.
    const scored = advice
      ?? (hand && tracker ? advise(hand, table.seats, seat, Math.random, 700) : null)
    if (coach && scored) coach.record(scored, action)
    if (hand && tracker && scored) tracker.recordDecision(hand, scored, action)
    game.act(action)
  }

  return (
    <div className="table-screen">
      <div className="statusbar">
        <div className="stat">
          <b className="num">{money(table.human.stack)}</b>
          <span>Your stack</span>
        </div>
        <div className="stat">
          <b className="num">{money(SMALL_BLIND)}/{money(BIG_BLIND)}</b>
          <span>Blinds</span>
        </div>
        <div className="stat">
          <b className="num">#{table.handNumber}</b>
          <span>Hand</span>
        </div>
        <div className="stat">
          <b className="num">{money((table.dexterCount + 1) * 100)}</b>
          <span>Next Dexter</span>
        </div>
        <div className={`stat ${bombDue ? 'hot' : ''}`}>
          <b>{bombDue ? 'DUE' : bombCountdown(table)}</b>
          <span>Bomb pot</span>
        </div>
        <div className="stat">
          <b className="num">{table.human.buyIns}</b>
          <span>Buy-ins</span>
        </div>
        {coach ? (
          <label className="stat xray-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={coach.xray}
              onChange={(e) => coach.setXray(e.target.checked)}
            />
            <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              X-ray
            </span>
          </label>
        ) : (
          <button className="btn small ghost" onClick={onCashOut} style={{ alignSelf: 'center' }}>
            Cash out
          </button>
        )}
      </div>

      {hand?.isBombPot && (
        <div className="banner bomb">
          💣 Bomb Pot · {BOMB_POT_GAMES[hand.bombGame!].name} ·{' '}
          {money(BOMB_POT_GAMES[hand.bombGame!].ante)} ante
        </div>
      )}
      {hand?.dexter && (
        <div className="banner dexter">
          DEXTER! {table.seats[hand.dexter.seat].name} — everyone pays {money(hand.dexter.perPlayer)}
        </div>
      )}

      <div className={`table-body ${coach ? 'with-coach' : ''}`}>
      <div className="table-main">
      <div className="felt-wrap">
        <div className="felt">
          <div className="felt-logo">
            <b>BNOTW</b>
            <span>BEST NIGHT OF THE WEEK</span>
          </div>

          <div className="middle">
            <div className="board">
              {hand && hand.board.length > 0
                ? <CardRow cards={hand.board} size="big" />
                : <span className="faint" style={{ fontSize: 11, letterSpacing: '0.2em' }}>
                    {hand?.phase === 'straddles' ? 'STRADDLES?' : ''}
                  </span>}
            </div>
            {pot > 0 && (
              <div className="pot">
                <span>Pot</span>
                <b className="num">{money(pot)}</b>
              </div>
            )}
            {hand && hand.pots.length > 1 && (
              <div className="side-pots">
                {hand.pots.map((p, i) => (
                  <span key={i}>{p.label}: {money(p.amount)}</span>
                ))}
              </div>
            )}
          </div>

          {table.seats.map((tableSeat) => (
            <SeatPlate
              key={tableSeat.id}
              seat={tableSeat}
              hand={hand}
              total={table.seats.length}
              isWinner={game.winners.includes(tableSeat.seat)}
              xray={Boolean(coach?.xray)}
              odds={xrayOdds?.get(tableSeat.seat) ?? null}
            />
          ))}
        </div>
      </div>

      {!coach && <HandLog hand={hand} />}
      </div>
      {coach && <CoachPanel advice={advice} review={coach.lastReview} />}
      </div>
      <Controls game={game} act={act} />
    </div>
  )
}

function bombCountdown(table: GameApi['table']): string {
  const { bombPotTrigger, bombPotHands, bombPotMinutes } = table.settings
  if (bombPotTrigger === 'off') return 'Off'
  if (bombPotTrigger === 'hands') {
    return `${Math.max(0, bombPotHands - table.handsSinceBomb)} hands`
  }
  const left = bombPotMinutes - (Date.now() - table.lastBombAt) / 60000
  return `${Math.max(0, Math.ceil(left))} min`
}

// ---------------------------------------------------------------------------

function SeatPlate({
  seat, hand, total, isWinner, xray, odds,
}: {
  seat: SeatModel
  hand: HandState | null
  total: number
  isWinner: boolean
  xray: boolean
  odds: EquityResult | null
}) {
  const player: HandPlayer | undefined = hand?.players[seat.seat]
  const pos = ellipse(seat.seat, total, 43, 39)
  const bet = betSpot(seat.seat, total)
  // Nudged around the ellipse as well as inward so it never lands on the cards.
  const button = ellipse(seat.seat + 0.38, total, 33, 31)

  const acting = hand?.actingSeat === seat.seat && hand?.phase === 'acting'
  const showFace = seat.isHuman || player?.revealed || (xray && !player?.folded)
  const classes = [
    'seat',
    seat.isHuman ? 'you' : '',
    acting ? 'acting' : '',
    player?.folded ? 'folded' : '',
    isWinner ? 'winner' : '',
    !player ? 'out' : '',
  ].filter(Boolean).join(' ')

  const handLabel = player && showFace && hand && hand.board.length >= 3 && !player.folded
    ? shortHand(bestHand(hand, seat.seat)!)
    : null

  return (
    <>
      <div className={classes} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
        <div className="seat-cards">
          {player
            ? <CardRow cards={player.hole} faceDown={!showFace} size={seat.isHuman ? 'big' : 'small'} />
            : null}
        </div>
        <div className="seat-plate">
          <div className="seat-face">
            <Avatar
              spec={seat.persona.avatar}
              size={22}
              alt=""
              ring={acting ? 'var(--brass)' : '#0d1613'}
            />
          </div>
          <div className="seat-name">
            <span className="seat-label">{seat.name}</span>
            {player?.straddle ? <span>⚡</span> : null}
          </div>
          <div className="seat-stack num">
            {seat.sittingOut && !player ? 'Sitting out' : money(seat.stack)}
          </div>
          {odds && <div className="seat-odds">{pct(odds.equity)} to win</div>}
          {handLabel && <div className="seat-hand">{handLabel}</div>}
          {player?.lastAction && !player.folded && (
            <div className="seat-action">{player.lastAction}</div>
          )}
          {player?.folded && <div className="seat-action">Folded</div>}
        </div>
      </div>

      {player && player.committedRound > 0 && (
        <div className="seat-bet" style={{ left: `${bet.x}%`, top: `${bet.y}%` }}>
          <span className="num">{money(player.committedRound)}</span>
        </div>
      )}

      {hand?.buttonSeat === seat.seat && (
        <div className="dealer-button" style={{ left: `${button.x}%`, top: `${button.y}%` }}>D</div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

function HandLog({ hand }: { hand: HandState | null }) {
  const lines = hand?.log ?? []
  useEffect(() => {
    const el = document.querySelector('.log')
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  return (
    <div className="log" aria-live="polite">
      {lines.map((line) => (
        <div key={line.id} className={line.tone}>{line.text}</div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Controls({ game, act }: { game: GameApi; act: (action: Action) => void }) {
  const { table } = game
  const hand = table.hand
  const seat = table.human.seat
  const player = hand?.players[seat]

  if (!hand) return <div className="actionbar"><span className="muted">Shuffling up…</span></div>

  if (game.needsRebuy || game.tableBroke) {
    return (
      <div className="actionbar">
        <div className="prompt">
          <h3>{game.tableBroke ? 'Table is short' : 'You are out of chips'}</h3>
          <p>
            Rebuys are always welcome. There is no shame in a rebuy — in fact the rest
            of the table will probably encourage it. $42 for $40 in chips.
          </p>
          <div className="row">
            <button className="btn primary" onClick={game.rebuy}>Rebuy — $42</button>
          </div>
        </div>
      </div>
    )
  }

  if (hand.phase === 'straddles' && table.humanCanStraddle()) {
    const amount = hand.straddles.length ? hand.straddles[hand.straddles.length - 1].amount * 2 : BIG_BLIND * 2
    return (
      <div className="actionbar">
        <div className="prompt">
          <h3>Straddle?</h3>
          <p>
            Declare now — before anybody looks at a card. A straddle is a blind raise
            that plays as the big blind, so the next raise has to double it.
            {hand.straddles.length > 0 && ` Already out there: ${
              hand.straddles.map((s) => `${table.seats[s.seat].name} ${money(s.amount)}`).join(', ')
            }.`}
          </p>
          <div className="row">
            <button className="btn primary" onClick={game.straddle}>
              Straddle {money(amount)}
            </button>
            <button className="btn" onClick={game.declineStraddle}>Deal the cards</button>
          </div>
        </div>
      </div>
    )
  }

  if (hand.phase === 'discard' && hand.pendingDiscards.includes(seat) && player) {
    return (
      <div className="actionbar">
        <div className="prompt bomb">
          <h3>Crazy Pineapple — pitch one</h3>
          <p>Tap the card you are throwing away. The other two play to the river.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {player.hole.map((card, i) => (
              <PlayingCard
                key={`${card.rank}${card.suit}`}
                card={card}
                size="big"
                onClick={() => game.discard(i)}
                title="Discard this card"
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (hand.phase === 'dexterShow' && hand.pendingDexter?.seat === seat) {
    const claim = hand.pendingDexter
    return (
      <div className="actionbar">
        <div className="prompt dexter">
          <h3>You just won with a Dexter</h3>
          <p>
            7-2, sole winner, and the hand got to the river. Show it and every other
            player at the table pays you {money(claim.perPlayer)} — {money(claim.total)} in all.
            Muck it and the bonus walks.
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => game.showDexter(true)}>
              Show the 7-2 — collect {money(claim.total)}
            </button>
            <button className="btn ghost" onClick={() => game.showDexter(false)}>Muck</button>
          </div>
        </div>
      </div>
    )
  }

  if (hand.complete) {
    return (
      <div className="actionbar">
        <div className="row">
          <span className="muted" style={{ fontSize: 12.5, flex: '1 1 auto' }}>
            {hand.awards.map((a) => `${table.seats[a.seat].name} ${a.split ? 'chops' : 'wins'} ${money(a.amount)}`).join(' · ')}
          </span>
          <button className="btn primary" onClick={game.nextHand}>Next hand →</button>
        </div>
      </div>
    )
  }

  if (hand.phase === 'acting' && hand.actingSeat === seat && player) {
    return <ActionButtons game={game} act={act} />
  }

  return (
    <div className="actionbar">
      <div className="row">
        <span className="muted" style={{ fontSize: 12.5, flex: '1 1 auto' }}>
          {hand.phase === 'acting' && hand.actingSeat !== null
            ? `${table.seats[hand.actingSeat].name} is thinking…`
            : hand.phase === 'discard'
              ? 'Waiting on discards…'
              : 'Dealing…'}
        </span>
        <button className="btn small ghost" onClick={() => game.setPaused(!game.paused)}>
          {game.paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ActionButtons({ game, act }: { game: GameApi; act: (action: Action) => void }) {
  const { table } = game
  const hand = table.hand!
  const seat = table.human.seat
  const legal = useMemo(
    () => legalActions(hand, table.seats, seat),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.version, hand, seat, table.seats],
  )
  const pot = potTotal(hand)
  const [raising, setRaising] = useState(false)
  const [amount, setAmount] = useState(legal.minRaiseTo)

  // Reset the slider whenever a fresh decision lands on us.
  useEffect(() => {
    setRaising(false)
    setAmount(legal.minRaiseTo)
  }, [legal.minRaiseTo, legal.maxRaiseTo, hand.street, hand.handNumber])

  const canOpenRaise = legal.canBet || legal.canRaise
  const named = namedBetFor(amount)

  const quick: { label: string; value: number; named?: boolean }[] = []
  for (const bet of NAMED_BETS) {
    if (bet.amount >= legal.minRaiseTo && bet.amount <= legal.maxRaiseTo) {
      quick.push({ label: bet.name, value: bet.amount, named: true })
    }
  }
  for (const [label, fraction] of [['½ pot', 0.5], ['¾ pot', 0.75], ['Pot', 1]] as const) {
    const value = clamp(toChipIncrement(hand.currentBet + pot * fraction), legal)
    if (value > legal.minRaiseTo && value < legal.maxRaiseTo) quick.push({ label, value })
  }
  quick.push({ label: 'All in', value: legal.maxRaiseTo })

  const submitRaise = () => {
    act({ kind: legal.canBet ? 'bet' : 'raise', amount: clamp(amount, legal) })
    setRaising(false)
  }

  return (
    <div className="actionbar">
      {raising && canOpenRaise && (
        <div className="raise-panel">
          <div className="raise-head">
            <b className="num">{money(amount)}</b>
            {named && <span className="named">{named.name.toUpperCase()}</span>}
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 11 }}>
              min {money(legal.minRaiseTo)} · max {money(legal.maxRaiseTo)}
            </span>
          </div>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={CHIP_INCREMENT}
            value={amount}
            onChange={(e) => setAmount(clamp(Number(e.target.value), legal))}
            aria-label="Bet amount"
          />
          <div className="chiprow">
            {quick.map((q) => (
              <button
                key={q.label}
                className={`btn small ${q.named ? 'named' : ''}`}
                onClick={() => setAmount(clamp(q.value, legal))}
              >
                {q.label}
                <small style={{ opacity: 0.7, marginLeft: 4 }}>{money(q.value)}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="action-buttons">
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
            Call
            <small>{money(legal.callAmount)}{legal.callIsAllIn ? ' · all in' : ''}</small>
          </button>
        )}

        {raising ? (
          <button className="btn raise" onClick={submitRaise}>
            {legal.canBet ? 'Bet' : 'Raise to'}
            <small>{money(amount)}</small>
          </button>
        ) : (
          <button className="btn raise" disabled={!canOpenRaise} onClick={() => setRaising(true)}>
            {legal.canBet ? 'Bet' : 'Raise'}
            <small>{canOpenRaise ? `from ${money(legal.minRaiseTo)}` : 'not available'}</small>
          </button>
        )}
      </div>
    </div>
  )
}

function clamp(value: number, legal: { minRaiseTo: number; maxRaiseTo: number }): number {
  const stepped = Math.round(value / CHIP_INCREMENT) * CHIP_INCREMENT
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, stepped))
}
