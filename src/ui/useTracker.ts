/**
 * Watches your seat and turns what happens into a record of how you play.
 *
 * Running counters are kept forever; the hand list is capped, because the
 * counters already carry the totals and a browser's storage is not infinite.
 */

import { useCallback, useRef, useState } from 'react'
import { BIG_BLIND } from '../engine/bnotw'
import { cardCode } from '../engine/cards'
import { reviewDecision, type CoachAdvice } from '../engine/coach'
import { isDexterHand, livePlayers } from '../engine/hand'
import { buildReplay } from '../engine/replay'
import {
  accumulate, emptyTotals, type DecisionRecord, type HandRecord, type PlayMode,
  type PlayerTotals,
} from '../engine/playerStats'
import type { Table } from '../engine/table'
import type { Action, HandState } from '../engine/types'
import { loadPlayerLog, savePlayerLog, type PlayerLog } from '../state/storage'

/** How many individual hands to keep. The totals are never truncated. */
const HISTORY_LIMIT = 600
/**
 * How many of those keep their full replay. A replay is an order of magnitude
 * bigger than the summary row, so older hands keep the row and lose the replay
 * rather than the history getting short.
 */
const REPLAY_LIMIT = 150

interface InProgress {
  handNumber: number
  vpip: boolean
  pfr: boolean
  facedRaise: boolean
  threeBet: boolean
  foldedPreflop: boolean
  aggressive: number
  passive: number
  decisions: DecisionRecord[]
}

export interface TrackerApi {
  totals: PlayerTotals
  recent: HandRecord[]
  /** Call with the state as it stood when the decision was made. */
  recordDecision: (state: HandState, advice: CoachAdvice, action: Action) => void
  /** Call once when a hand finishes. */
  completeHand: (table: Table, mode: PlayMode) => void
  reset: () => void
}

function blank(handNumber: number): InProgress {
  return {
    handNumber,
    vpip: false,
    pfr: false,
    facedRaise: false,
    threeBet: false,
    foldedPreflop: false,
    aggressive: 0,
    passive: 0,
    decisions: [],
  }
}

export function useTracker(): TrackerApi {
  const [log, setLog] = useState<PlayerLog>(() => loadPlayerLog())
  const current = useRef<InProgress>(blank(-1))
  // Keyed on the hand object rather than its number: starting a fresh session
  // resets the numbering, and a set of numbers would silently skip the new
  // hand 1. The weak set also lets finished hands be collected.
  const completed = useRef(new WeakSet<HandState>())

  const forHand = (handNumber: number) => {
    if (current.current.handNumber !== handNumber) current.current = blank(handNumber)
    return current.current
  }

  const recordDecision = useCallback((
    state: HandState,
    advice: CoachAdvice,
    action: Action,
  ) => {
    const hand = forHand(state.handNumber)
    const review = reviewDecision(advice, action)
    hand.decisions.push({
      street: state.street,
      action: action.kind,
      recommended: advice.recommendation.action,
      agreed: review.agreed,
      evLost: review.evLost,
      leak: review.leak,
    })

    if (state.board.length === 0) {
      // A blind is not a choice, so only money put in beyond it counts.
      const forced = Math.max(BIG_BLIND, ...state.straddles.map((s) => s.amount))
      if (state.currentBet > forced) hand.facedRaise = true
      if (action.kind === 'call' || action.kind === 'raise' || action.kind === 'bet') {
        hand.vpip = true
      }
      if (action.kind === 'raise' || action.kind === 'bet') {
        hand.pfr = true
        if (state.currentBet > forced) hand.threeBet = true
      }
      if (action.kind === 'fold') hand.foldedPreflop = true
    } else if (action.kind === 'bet' || action.kind === 'raise') {
      hand.aggressive += 1
    } else if (action.kind === 'call') {
      hand.passive += 1
    }
  }, [])

  const completeHand = useCallback((table: Table, mode: PlayMode) => {
    const state = table.hand
    if (!state) return
    if (completed.current.has(state)) return
    completed.current.add(state)

    const seat = table.human.seat
    const player = state.players[seat]
    if (!player) return // sat out this hand

    const progress = forHand(state.handNumber)
    const live = livePlayers(state)
    const showdown = !player.folded && state.board.length === 5 && live.length > 1

    const record: HandRecord = {
      at: Date.now(),
      mode,
      handNumber: state.handNumber,
      bomb: state.isBombPot,
      position: seat === state.buttonSeat ? 'button' : 'other',
      hole: player.hole.map(cardCode).join(' '),
      couldStraddle: !state.isBombPot,
      straddled: player.straddle > 0,
      vpip: progress.vpip,
      pfr: progress.pfr,
      facedRaise: progress.facedRaise,
      threeBet: progress.threeBet,
      sawFlop: state.board.length >= 3 && !progress.foldedPreflop,
      showdown,
      wonShowdown: showdown && state.awards.some((a) => a.seat === seat),
      net: table.seats[seat].stack - player.startingStack,
      aggressive: progress.aggressive,
      passive: progress.passive,
      dexterHeld: isDexterHand(player.hole),
      dexterWon: state.dexter?.seat === seat,
      decisions: progress.decisions,
      replay: buildReplay(state, table.seats, seat),
    }

    setLog((prev) => {
      const hands = [record, ...prev.hands]
        .slice(0, HISTORY_LIMIT)
        .map((hand, i) => (i < REPLAY_LIMIT || !hand.replay ? hand : { ...hand, replay: undefined }))
      const next: PlayerLog = { version: 1, totals: accumulate(prev.totals, record), hands }
      savePlayerLog(next)
      return next
    })
    current.current = blank(-1)
  }, [])

  const reset = useCallback(() => {
    const next: PlayerLog = { version: 1, totals: emptyTotals(), hands: [] }
    completed.current = new WeakSet<HandState>()
    current.current = blank(-1)
    savePlayerLog(next)
    setLog(next)
  }, [])

  return { totals: log.totals, recent: log.hands, recordDecision, completeHand, reset }
}
