import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BIG_BLIND, BOMB_POT_GAMES, CHIP_INCREMENT, NAMED_BETS, SMALL_BLIND,
  money, namedBetFor, toChipIncrement,
} from '../engine/bnotw'
import { cardCode } from '../engine/cards'
import { shortHand } from '../engine/handEval'
import { pct, showdownEquity, type EquityResult } from '../engine/coach'
import { bestHand, legalActions, livePlayers, potTotal } from '../engine/hand'
import { handName, type CustomHandNames } from '../engine/handNames'
import { voice, voiceName } from '../engine/voices'
import { DEFAULT_VOICES, type VoiceSettings } from '../state/storage'
import { guardFor, type Guard, type GuardOptions } from '../engine/misclick'
import { useAdvice } from './useAdvice'
import type { Action, HandPlayer, HandState, Seat as SeatModel } from '../engine/types'
import { Avatar } from './Avatar'
import { CoachPanel } from './CoachPanel'
import { CardRow, PlayingCard } from './pieces'
import type { PlayMode } from '../engine/playerStats'
import type { CoachApi } from './useCoach'
import type { NarratorApi } from './useNarrator'
import type { GameApi } from './useGame'
import type { TrackerApi } from './useTracker'

/** Where a seat sits, in the words a player would use. */
function positionLabel(hand: HandState | null, seat: number): string {
  if (!hand) return 'in this seat'
  const i = hand.order.indexOf(seat)
  const n = hand.order.length
  if (i === n - 1) return 'on the button'
  if (i === n - 2) return 'in the cut-off'
  if (seat === hand.smallBlindSeat) return 'in the small blind'
  if (seat === hand.bigBlindSeat) return 'in the big blind'
  if (i <= Math.floor(n / 3)) return 'in early position'
  return 'in middle position'
}

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
  game, onCashOut, coach, tracker, mode = 'table', narrator, guardOptions = {},
  handNames = {}, voices = DEFAULT_VOICES,
}: {
  game: GameApi
  onCashOut: () => void
  /** Present only in coach mode. */
  coach?: CoachApi
  /** Records how you play, in both modes. */
  tracker?: TrackerApi
  mode?: PlayMode
  /** Optional explanation service; absent when none is configured. */
  narrator?: NarratorApi
  /** When to ask twice before an action you cannot take back. */
  guardOptions?: GuardOptions
  /** Nicknames this table has added or changed. */
  handNames?: CustomHandNames
  /** Whose read to show, and an optional second opinion beside it. */
  voices?: VoiceSettings
}) {
  const { table, version } = game
  const hand = table.hand
  void version // re-render key: the engine mutates in place

  const pot = hand ? potTotal(hand) : 0
  const bombDue = table.bombPotDue()
  const seat = table.human.seat
  const myTurn = hand?.phase === 'acting' && hand.actingSeat === seat

  /**
   * The coach's verdict, worked out in the background while you read the spot.
   *
   * Computed whenever the decision is ours, not only in coach mode: tracking
   * needs it the moment you act, and starting it now means it is almost always
   * ready by then rather than being raced on the main thread after the tap.
   */
  const scoring = useAdvice(hand, table.seats, seat, myTurn, 1500, voices.primary)
  /*
   * A second read on the same spot, when one is chosen.
   *
   * Two coaches agreeing is reassuring and two disagreeing is the actually
   * useful case — marginal hands are marginal precisely because good players
   * differ on them, and one confident verdict hides that.
   */
  const secondScoring = useAdvice(
    hand, table.seats, seat, Boolean(coach) && myTurn && Boolean(voices.second),
    1200, voices.second ?? 'house',
  )
  // Only coach mode puts it on screen; the table uses it silently for tracking.
  const advice = coach ? scoring.advice : null

  /**
   * What the X-ray odds actually depend on: who is still in, holding what, and
   * what is on the board. Not `version` — that ticks on every bet and check,
   * and none of those change anyone's chance of winning. Keyed on `version`
   * this ran a Monte Carlo per bot action: on a phone, a quarter-second of
   * blocked main thread twenty-odd times a hand, for a number that had not
   * moved.
   */
  const xrayKey = useMemo(() => {
    if (!coach?.xray || !hand || hand.complete) return null
    const live = livePlayers(hand).filter((p) => p.hole.length >= 2)
    if (live.length < 2) return null
    return `${live.map((p) => `${p.seat}${p.hole.map(cardCode).join('')}`).join(',')}/${
      hand.board.map(cardCode).join('')}`
  }, [coach?.xray, hand, version])

  // X-ray: every hand face up, with the odds a broadcast would put on screen.
  const xrayOdds = useMemo<Map<number, EquityResult> | null>(() => {
    if (!xrayKey || !hand) return null
    const live = livePlayers(hand).filter((p) => p.hole.length >= 2)
    if (live.length < 2) return null
    const results = showdownEquity(
      live.map((p) => p.hole), hand.board, Math.random,
      hand.board.length === 0 ? 1000 : 4000,
    )
    return new Map(live.map((p, i) => [p.seat, results[i]]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xrayKey])

  // Wrap a finished hand up exactly once. Keyed on the hand itself, because a
  // fresh session restarts the numbering from one.
  const countedRef = useRef(new WeakSet<HandState>())
  useEffect(() => {
    if (!hand?.complete || countedRef.current.has(hand)) return
    countedRef.current.add(hand)
    coach?.countHand()
    tracker?.completeHand(table, mode)
  }, [coach, tracker, table, mode, hand, hand?.complete])

  useEffect(() => {
    narrator?.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.handNumber, hand?.street, hand?.actingSeat])

  /**
   * Drop the feedback as soon as a new decision is put in front of you.
   *
   * It describes the action you just took, and it is meant to be read while
   * the table responds to it. Left up, it sits directly above the advice for
   * the *next* decision and reads as though it described that one — a verdict
   * about last hand's fold, over this hand's cards, quoting percentages that
   * match neither.
   *
   * Keyed on the edge into your turn rather than on `myTurn` being true: the
   * action that produces the feedback happens while it is still your turn, and
   * clearing on the level would wipe it in the same breath it was written.
   */
  const wasMyTurn = useRef(false)
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) coach?.clearReview()
    wasMyTurn.current = myTurn
  }, [myTurn, coach])

  const act = (action: Action) => {
    // Normally already waiting; `now()` only computes if you acted faster than
    // the background pass.
    const scored = scoring.now()
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
              handNames={handNames}
            />
          ))}
        </div>
      </div>

      {!coach && <HandLog hand={hand} />}
      </div>
      {coach && (
        <CoachPanel
          advice={advice}
          pending={coach ? scoring.pending : false}
          speaker={voiceName(voice(voices.primary), voices.names)}
          second={voices.second ? {
            name: voiceName(voice(voices.second), voices.names),
            advice: secondScoring.advice,
          } : null}
          review={coach.lastReview}
          narrator={narrator}
          position={positionLabel(hand, seat)}
        />
      )}
      </div>
      <Controls game={game} act={act} guardOptions={guardOptions} />
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
  seat, hand, total, isWinner, xray, odds, handNames = {},
}: {
  seat: SeatModel
  hand: HandState | null
  total: number
  isWinner: boolean
  xray: boolean
  odds: EquityResult | null
  handNames?: CustomHandNames
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

  /*
   * After the flop, what the hand actually is. Before it, what the table calls
   * it — which is the only thing there is to say about two cards, and the
   * thing people say out loud.
   */
  const handLabel = player && showFace && hand && !player.folded
    ? (hand.board.length >= 3
      ? shortHand(bestHand(hand, seat.seat)!)
      : handName(player.hole, handNames))
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

function Controls({
  game, act, guardOptions,
}: {
  game: GameApi
  act: (action: Action) => void
  guardOptions: GuardOptions
}) {
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
    return <ActionButtons game={game} act={act} guardOptions={guardOptions} />
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

/**
 * How long the action bar ignores taps after it appears.
 *
 * The fat-finger fold is usually not a mis-aimed tap at all: it is a tap aimed
 * at something that was on screen a moment ago, landing just as the buttons
 * arrive. Swallowing the first fraction of a second costs nobody anything and
 * removes the whole class.
 */
const SETTLE_MS = 350

function ActionButtons({
  game, act, guardOptions,
}: {
  game: GameApi
  act: (action: Action) => void
  guardOptions: GuardOptions
}) {
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
  const [pending, setPending] = useState<{ action: Action; guard: Guard } | null>(null)
  const [settled, setSettled] = useState(false)

  // Reset the slider whenever a fresh decision lands on us.
  useEffect(() => {
    setRaising(false)
    setAmount(legal.minRaiseTo)
    setPending(null)
  }, [legal.minRaiseTo, legal.maxRaiseTo, hand.street, hand.handNumber])

  // Re-armed for every decision, not once per hand: the buttons reappear each
  // time the action comes back round.
  useEffect(() => {
    setSettled(false)
    const timer = setTimeout(() => setSettled(true), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [hand.handNumber, hand.street, hand.actingSeat])

  /** Every route to an action goes through here, keyboard included. */
  const attempt = useCallback((action: Action) => {
    if (!settled) return
    const guard = guardFor(hand, table.seats, seat, action, legal, guardOptions)
    if (guard) setPending({ action, guard })
    else act(action)
  }, [settled, hand, table.seats, seat, legal, guardOptions, act])

  /**
   * Keyboard shortcuts, for playing at a desk. Deliberately not bound while a
   * confirmation is up: the whole point of that sheet is a second, deliberate
   * input, and a stray F would defeat it.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (pending) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Never steal a key from something being typed into.
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) {
        return
      }

      if (raising) {
        if (event.key === 'Enter') { event.preventDefault(); submitRaise() }
        if (event.key === 'Escape') { event.preventDefault(); setRaising(false) }
        return
      }

      switch (event.key.toLowerCase()) {
        case 'f':
          if (legal.canFold) { event.preventDefault(); attempt({ kind: 'fold' }) }
          break
        case 'c':
          event.preventDefault()
          attempt(legal.canCheck ? { kind: 'check' } : { kind: 'call' })
          break
        case 'r':
        case 'b':
          if (canOpenRaise) { event.preventDefault(); setRaising(true) }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const canOpenRaise = legal.canBet || legal.canRaise
  const named = namedBetFor(amount)

  const quick: { label: string; value: number; named?: boolean }[] = []
  for (const bet of NAMED_BETS) {
    if (bet.amount >= legal.minRaiseTo && bet.amount <= legal.maxRaiseTo) {
      quick.push({ label: bet.name, value: bet.amount, named: true })
    }
  }
  quick.push({ label: legal.canBet ? 'Min bet' : 'Min raise', value: legal.minRaiseTo })
  for (const [label, fraction] of [['½ pot', 0.5], ['¾ pot', 0.75], ['Pot', 1]] as const) {
    const value = clamp(toChipIncrement(hand.currentBet + pot * fraction), legal)
    if (value > legal.minRaiseTo && value < legal.maxRaiseTo) quick.push({ label, value })
  }
  quick.push({ label: 'All in', value: legal.maxRaiseTo })

  const submitRaise = () => {
    attempt({ kind: legal.canBet ? 'bet' : 'raise', amount: clamp(amount, legal) })
    setRaising(false)
  }

  return (
    <div className="actionbar">
      {raising && canOpenRaise && !pending && (
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

      {pending ? (
        <div className="confirm-sheet" role="alertdialog" aria-label={pending.guard.title}>
          <div className="confirm-body">
            <b>{pending.guard.title}</b>
            <span>{pending.guard.detail}</span>
          </div>
          <div className="confirm-actions">
            <button className="btn" onClick={() => setPending(null)} autoFocus>
              Back
            </button>
            <button
              className="btn danger"
              onClick={() => { const { action } = pending; setPending(null); act(action) }}
            >
              {pending.guard.confirm}
            </button>
          </div>
        </div>
      ) : (
      <div className={`action-buttons ${settled ? '' : 'settling'}`}>
        {raising ? (
          /*
           * While a bet is being composed, nothing else is on offer.
           *
           * Fold, Check and Call used to stay live underneath the slider, so
           * setting a custom amount and then reaching for the confirm button
           * could land on Check instead — the bet you just dialled in thrown
           * away by the tap meant to place it. Two buttons here, and one of
           * them is the bet.
           */
          <>
            <button className="btn" onClick={() => setRaising(false)}>← Back</button>
            <button className="btn raise" onClick={submitRaise}>
              {legal.canBet ? 'Bet' : 'Raise to'}
              <small>{money(amount)}</small>
            </button>
          </>
        ) : (
          <>
            <button
              className="btn fold"
              disabled={!legal.canFold}
              onClick={() => attempt({ kind: 'fold' })}
            >
              Fold
            </button>

            {legal.canCheck ? (
              <button className="btn check" onClick={() => attempt({ kind: 'check' })}>
                Check
                <small>free</small>
              </button>
            ) : (
              <button className="btn call" onClick={() => attempt({ kind: 'call' })}>
                Call
                <small>{money(legal.callAmount)}{legal.callIsAllIn ? ' · all in' : ''}</small>
              </button>
            )}

            <button className="btn raise" disabled={!canOpenRaise} onClick={() => setRaising(true)}>
              {legal.canBet ? 'Bet' : 'Raise'}
              <small>{canOpenRaise ? `from ${money(legal.minRaiseTo)}` : 'not available'}</small>
            </button>
          </>
        )}
      </div>
      )}
    </div>
  )
}

function clamp(value: number, legal: { minRaiseTo: number; maxRaiseTo: number }): number {
  const stepped = Math.round(value / CHIP_INCREMENT) * CHIP_INCREMENT
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, stepped))
}
