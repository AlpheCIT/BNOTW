/**
 * Drives the table from React: keeps the engine ticking, paces the bots, and
 * exposes the handful of actions the human seat can take.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { mulberry32 } from '../engine/cards'
import { decideAction, decideDiscard } from '../engine/ai'
import { Table, type TableSettings } from '../engine/table'
import type { Action } from '../engine/types'

export type Speed = 'fast' | 'normal' | 'slow'

const PACE: Record<Speed, { bot: number; street: number; handEnd: number }> = {
  fast: { bot: 320, street: 480, handEnd: 1700 },
  normal: { bot: 750, street: 950, handEnd: 3200 },
  slow: { bot: 1400, street: 1600, handEnd: 5200 },
}

export interface GameApi {
  table: Table
  version: number
  speed: Speed
  setSpeed: (speed: Speed) => void
  paused: boolean
  setPaused: (paused: boolean) => void
  /** Set when the human busted and has to decide whether to rebuy. */
  needsRebuy: boolean
  /** Set when the table cannot continue — too few players with chips. */
  tableBroke: boolean
  act: (action: Action) => void
  discard: (cardIndex: number) => void
  straddle: () => void
  declineStraddle: () => void
  showDexter: (show: boolean) => void
  nextHand: () => void
  rebuy: () => void
  restart: (settings: Partial<TableSettings>) => void
  /** Seats that just won a pot, for the winner highlight. */
  winners: number[]
}

export function useGame(initial: Partial<TableSettings>): GameApi {
  const tableRef = useRef<Table | null>(null)
  if (!tableRef.current) tableRef.current = new Table(initial)
  const table = tableRef.current

  const version = useSyncExternalStore(table.subscribe, table.getVersion, table.getVersion)
  const [speed, setSpeed] = useState<Speed>('normal')
  const [paused, setPaused] = useState(false)
  const [needsRebuy, setNeedsRebuy] = useState(false)
  const [tableBroke, setTableBroke] = useState(false)
  const rng = useMemo(() => mulberry32(Math.floor(Math.random() * 2 ** 31)), [])
  const pace = PACE[speed]

  const hand = table.hand

  /** Wrap up the finished hand and put the next one in the air. */
  const nextHand = useCallback(() => {
    table.finishHand()
    if (table.human.stack <= 0) {
      setNeedsRebuy(true)
      return
    }
    if (table.activeSeats().length < 2) {
      setTableBroke(true)
      return
    }
    table.startHand()
  }, [table])

  // Deal the first hand.
  useEffect(() => {
    if (!table.hand) table.startHand()
  }, [table])

  // The main loop: whatever the engine is waiting on, either a bot answers it
  // or the table deals. Human decisions fall through and the loop idles.
  useEffect(() => {
    if (paused || !hand) return
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = () => {
      switch (hand.phase) {
        case 'straddles': {
          // Wait for the human only if a straddle is actually available.
          if (!table.humanCanStraddle()) {
            timer = setTimeout(() => table.closeStraddles(), 120)
          }
          return
        }
        case 'acting': {
          const seat = hand.actingSeat
          if (seat === null || table.seats[seat].isHuman) return
          timer = setTimeout(() => {
            if (hand.phase !== 'acting' || hand.actingSeat !== seat) return
            table.act(seat, decideAction({ state: hand, seats: table.seats, seat, rng }))
          }, pace.bot)
          return
        }
        case 'discard': {
          const seat = hand.pendingDiscards.find((s) => !table.seats[s].isHuman)
          if (seat === undefined) return
          timer = setTimeout(() => {
            if (hand.phase !== 'discard' || !hand.pendingDiscards.includes(seat)) return
            table.discard(seat, decideDiscard(hand, seat, rng))
          }, Math.max(240, pace.bot * 0.6))
          return
        }
        case 'street': {
          timer = setTimeout(() => {
            if (hand.phase === 'street') table.advance()
          }, pace.street)
          return
        }
        case 'dexterShow': {
          const seat = hand.pendingDexter?.seat
          if (seat === undefined || table.seats[seat].isHuman) return
          // Bots always table the 7-2. Who wouldn't?
          timer = setTimeout(() => {
            if (hand.phase === 'dexterShow') table.resolveDexter(true)
          }, pace.bot)
          return
        }
        case 'showdown': {
          timer = setTimeout(nextHand, pace.handEnd)
          return
        }
      }
    }

    run()
    return () => { if (timer) clearTimeout(timer) }
  }, [version, paused, hand, pace, rng, table, nextHand])

  const act = useCallback((action: Action) => {
    if (table.hand?.actingSeat === table.human.seat) table.act(table.human.seat, action)
  }, [table])

  const discard = useCallback((cardIndex: number) => {
    if (table.hand?.pendingDiscards.includes(table.human.seat)) {
      table.discard(table.human.seat, cardIndex)
    }
  }, [table])

  const straddle = useCallback(() => table.straddle(), [table])
  const declineStraddle = useCallback(() => table.closeStraddles(), [table])
  const showDexter = useCallback((show: boolean) => table.resolveDexter(show), [table])

  const rebuy = useCallback(() => {
    table.rebuy(table.human.seat)
    setNeedsRebuy(false)
    setTableBroke(false)
    if (table.activeSeats().length >= 2) table.startHand()
  }, [table])

  const restart = useCallback((settings: Partial<TableSettings>) => {
    table.reset(settings)
    setNeedsRebuy(false)
    setTableBroke(false)
    table.startHand()
  }, [table])

  const winners = useMemo(
    () => (hand?.complete ? [...new Set(hand.awards.map((a) => a.seat))] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, hand],
  )

  return {
    table, version, speed, setSpeed, paused, setPaused, needsRebuy, tableBroke,
    act, discard, straddle, declineStraddle, showDexter, nextHand, rebuy, restart, winners,
  }
}
