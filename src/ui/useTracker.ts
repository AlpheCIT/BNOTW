/**
 * Watches your seat and turns what happens into a record of how you play.
 *
 * History lives in IndexedDB and nothing is thrown away: the whole point of
 * keeping it is to see whether you are improving, and a cap that evicts the
 * start of the season deletes exactly the comparison that answers that.
 *
 * Only the most recent hands are held in memory, for the list and the leak
 * review. The rest stay on disk until an export asks for them.
 *
 * Where IndexedDB cannot be opened at all — private browsing, a locked-down
 * profile — this falls back to the old `localStorage` log, capped as it was
 * before. Degraded, but working.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BIG_BLIND } from '../engine/bnotw'
import { cardCode } from '../engine/cards'
import { reviewDecision, type CoachAdvice } from '../engine/coach'
import { isDexterHand, livePlayers } from '../engine/hand'
import { positionOf } from '../engine/position'
import { buildReplay } from '../engine/replay'
import {
  accumulate, emptyTotals, unaccumulate, type DecisionRecord, type HandRecord,
  type PlayMode, type PlayerTotals,
} from '../engine/playerStats'
import type { Table } from '../engine/table'
import type { Action, HandState } from '../engine/types'
import { loadPlayerLog, savePlayerLog, type PlayerLog } from '../state/storage'
import { DEFAULT_PROFILE_ID, isGuestId } from '../state/profiles'
import {
  RECENT_IN_MEMORY, appendHand, countHands, deleteHands as deleteHands_db, openDb,
  readRecentHands, readTotals, replaceAll, setNote as setNote_db,
} from '../state/db'

/**
 * Caps for the `localStorage` fallback only. IndexedDB keeps everything; these
 * exist because 5 MB does not, and a truncated history is still better than a
 * failed write mid-hand.
 */
const HISTORY_LIMIT = 600
const REPLAY_LIMIT = 150

/**
 * Trim the in-memory log for the `localStorage` fallback, keeping notes.
 *
 * A note is the one thing in the record that cannot be rebuilt by playing
 * more, so a noted hand keeps its place and its replay ahead of any un-noted
 * hand, however old it is. Everything else is newest-first as before.
 */
export function trimForStorage(
  hands: HandRecord[],
  historyLimit = HISTORY_LIMIT,
  replayLimit = REPLAY_LIMIT,
): HandRecord[] {
  const noted = hands.filter((h) => h.note)
  const plain = hands.filter((h) => !h.note)
  const kept = [...noted, ...plain.slice(0, Math.max(0, historyLimit - noted.length))]

  // Back into play order, so the list still reads newest first.
  kept.sort((a, b) => b.at - a.at)

  let replaysLeft = Math.max(replayLimit, noted.length)
  return kept.map((hand) => {
    if (!hand.replay) return hand
    if (hand.note) return hand
    if (replaysLeft > 0) { replaysLeft--; return hand }
    return { ...hand, replay: undefined }
  })
}

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
  /**
   * The history has been read back off disk.
   *
   * Exposed because "no decisions recorded" and "not looked yet" are the same
   * shape and mean opposite things — anything that decides what to show a new
   * player has to wait for this or it will decide for the wrong one.
   */
  hydrated: boolean
  /** Attach or clear a note on a hand, found by when it was played. */
  setNote: (at: number, note: string) => void
  /** Call with the state as it stood when the decision was made. */
  recordDecision: (state: HandState, advice: CoachAdvice, action: Action) => void
  /** Call once when a hand finishes. */
  completeHand: (table: Table, mode: PlayMode) => void
  /**
   * Erase specific hands, found by when they were played, and take them back
   * out of the totals. Only hands still held in memory can go this way.
   */
  deleteHands: (ats: number[]) => void
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

/**
 * @param profileId whose history this is. A guest's is never written down, so
 *   their session starts empty, stays in memory and leaves nothing behind —
 *   which is the point of handing the iPad over without it costing you your
 *   own record.
 */
export function useTracker(profileId: string = DEFAULT_PROFILE_ID): TrackerApi {
  const guest = isGuestId(profileId)
  // Starts empty and hydrates, because IndexedDB cannot be read synchronously.
  const [log, setLog] = useState<PlayerLog>(() => ({
    version: 1, totals: emptyTotals(), hands: [],
  }))
  /**
   * Nothing is written until the history has been read back.
   *
   * Without this, finishing a hand in the first moments after load would save
   * an empty log over a real one — turning a slow read into permanent data
   * loss, which is the opposite of what this change is for.
   */
  const hydrated = useRef(false)
  const [ready, setReady] = useState(false)
  const usingDb = useRef(false)
  const current = useRef<InProgress>(blank(-1))
  // Keyed on the hand object rather than its number: starting a fresh session
  // resets the numbering, and a set of numbers would silently skip the new
  // hand 1. The weak set also lets finished hands be collected.
  const completed = useRef(new WeakSet<HandState>())

  /*
   * Read this profile's history back, and re-read it when the profile changes.
   *
   * Switching player is a full reload of the record rather than a filter over
   * one in memory, so there is never a moment where one person's totals are on
   * screen under another person's name.
   */
  useEffect(() => {
    let cancelled = false
    hydrated.current = false
    setReady(false)
    setLog({ version: 1, totals: emptyTotals(), hands: [] })
    completed.current = new WeakSet<HandState>()
    current.current = blank(-1)

    if (guest) {
      // Nothing to read and nothing that will ever be written.
      usingDb.current = false
      hydrated.current = true
      setReady(true)
      return () => { cancelled = true }
    }

    void (async () => {
      const db = await openDb()
      const legacy = loadPlayerLog(profileId)

      if (!db) {
        // No IndexedDB: carry on exactly as before.
        if (!cancelled) { setLog(legacy); hydrated.current = true; setReady(true) }
        return
      }
      usingDb.current = true

      const stored = await countHands(profileId)
      if (stored === 0 && (legacy.hands.length > 0 || legacy.totals.hands > 0)) {
        // One-time move. The old copy is left alone rather than deleted, so a
        // failed migration is recoverable and an older build still opens.
        await replaceAll(legacy.hands, legacy.totals, profileId)
      }

      const [totals, hands] = await Promise.all([
        readTotals(profileId), readRecentHands(profileId),
      ])
      if (cancelled) return
      setLog({
        version: 1,
        totals: totals ?? legacy.totals,
        hands: hands.length > 0 ? hands : legacy.hands,
      })
      hydrated.current = true
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [profileId, guest])

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
      position: positionOf(state, seat),
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
      const totals = accumulate(prev.totals, record)

      if (usingDb.current) {
        // Only the window the UI reads is kept in memory; the store keeps all
        // of it. One append per hand rather than rewriting the whole history.
        const hands = [record, ...prev.hands].slice(0, RECENT_IN_MEMORY)
        if (hydrated.current) void appendHand(record, totals, profileId)
        return { version: 1, totals, hands }
      }

      const hands = trimForStorage([record, ...prev.hands])
      const next: PlayerLog = { version: 1, totals, hands }
      if (hydrated.current) savePlayerLog(next, profileId)
      return next
    })
    current.current = blank(-1)
  }, [profileId])

  const setNote = useCallback((at: number, note: string) => {
    const trimmed = note.trim()
    setLog((prev) => {
      const hands = prev.hands.map((hand) => (
        hand.at === at
          ? (trimmed ? { ...hand, note: trimmed } : { ...hand, note: undefined })
          : hand
      ))
      const next: PlayerLog = { ...prev, hands }
      if (!hydrated.current) return next
      if (usingDb.current) void setNote_db(at, trimmed, profileId)
      else savePlayerLog({ ...next, hands: trimForStorage(hands) }, profileId)
      return next
    })
  }, [profileId])

  /**
   * Erase hands you would rather were not part of your record.
   *
   * Written for the case that prompted it: a stretch of hands played to try
   * the app out, sitting in the same history as the hands you meant. Those
   * hands move your VPIP and your rating exactly as hard as real ones, and
   * the rating is the number this app exists to make honest.
   *
   * Only hands in `recent` can go, which is what the list offers anyway. A
   * hand older than that is no longer held here to subtract, and guessing at
   * its contribution would corrupt the totals rather than correct them.
   */
  const deleteHands = useCallback((ats: number[]) => {
    const wanted = new Set(ats)
    setLog((prev) => {
      const going = prev.hands.filter((hand) => wanted.has(hand.at))
      if (going.length === 0) return prev
      const hands = prev.hands.filter((hand) => !wanted.has(hand.at))
      const totals = going.reduce((acc, hand) => unaccumulate(acc, hand), prev.totals)
      const next: PlayerLog = { ...prev, totals, hands }
      if (!hydrated.current) return next
      if (usingDb.current) void deleteHands_db(going.map((hand) => hand.at), totals, profileId)
      else savePlayerLog({ ...next, hands: trimForStorage(hands) }, profileId)
      return next
    })
  }, [profileId])

  const reset = useCallback(() => {
    const next: PlayerLog = { version: 1, totals: emptyTotals(), hands: [] }
    completed.current = new WeakSet<HandState>()
    current.current = blank(-1)
    // Cleared in both places: leaving the old localStorage copy behind would
    // have it migrated straight back the next time the database is empty.
    savePlayerLog(next, profileId)
    if (usingDb.current) void replaceAll([], next.totals, profileId)
    setLog(next)
  }, [profileId])

  return {
    totals: log.totals, recent: log.hands, hydrated: ready,
    setNote, recordDecision, completeHand, deleteHands, reset,
  }
}
