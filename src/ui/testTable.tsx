/**
 * A real table, driven to a real decision, for tests that render the UI.
 *
 * Deliberately not a mock. The bugs worth catching here — a button that means
 * one thing where another was a moment ago, a bet thrown away by the tap meant
 * to place it — only exist in the join between the engine's state and what
 * gets drawn, so a stubbed `GameApi` would test the stub.
 */

import { Table } from '../engine/table'
import { decideAction, decideDiscard } from '../engine/ai'
import { mulberry32 } from '../engine/cards'
import { defaultRoster } from '../engine/persona'
import type { Action } from '../engine/types'
import type { GameApi } from './useGame'

export interface TestGame extends GameApi {
  /** Let the bots act until the decision is the hero's again. */
  runToHero: () => void
}

/**
 * @param until stop as soon as the hero faces this. 'bet' drives the hand on
 *   until there is something to call, which is the state where Check becomes
 *   Call and the two used to be indistinguishable.
 */
export function testGame(seed = 5, until: 'any' | 'bet' = 'any'): TestGame {
  const table = new Table(
    { opponents: defaultRoster().slice(0, 5), bombPotTrigger: 'off', straddleMultiplier: 0 },
    seed,
  )
  const rng = mulberry32(seed * 31 + 7)
  let version = 0
  const listeners = new Set<() => void>()
  const bump = () => { version++; for (const fn of listeners) fn() }

  const heroToAct = () => {
    const hand = table.hand
    if (!hand || hand.phase !== 'acting' || hand.actingSeat !== 0) return false
    if (until === 'any') return true
    return hand.currentBet > (hand.players[0]?.committedRound ?? 0)
  }

  const runToHero = () => {
    for (let guard = 0; guard < 4000; guard++) {
      if (!table.hand || table.hand.complete) {
        table.finishHand()
        for (const s of table.seats) if (s.stack < 400) table.rebuy(s.seat)
        table.startHand()
        continue
      }
      const hand = table.hand
      if (hand.phase === 'straddles') { table.closeStraddles(); continue }
      if (heroToAct()) { bump(); return }
      switch (hand.phase) {
        case 'acting': {
          const seat = hand.actingSeat!
          if (seat === 0) {
            // Hero is up but not in the state we want; play on as a bot would.
            table.act(0, decideAction({ state: hand, seats: table.seats, seat: 0, rng, reads: table.reads }))
            break
          }
          table.act(seat, decideAction({ state: hand, seats: table.seats, seat, rng, reads: table.reads }))
          break
        }
        case 'discard': {
          const s = hand.pendingDiscards[0]
          table.discard(s, decideDiscard(hand, s, rng))
          break
        }
        case 'street': table.advance(); break
        case 'dexterShow': table.resolveDexter(true); break
        default: table.finishHand(); break
      }
    }
    throw new Error('never reached a hero decision')
  }

  table.startHand()
  if (table.hand?.phase === 'straddles') table.closeStraddles()
  runToHero()

  return {
    table,
    get version() { return version },
    speed: 'fast',
    setSpeed: () => {},
    handEnd: 'wait' as const,
    setHandEnd: () => {},
    paused: true,
    setPaused: () => {},
    needsRebuy: false,
    tableBroke: false,
    act: (action: Action) => {
      if (table.hand?.actingSeat === 0) table.act(0, action)
      bump()
    },
    discard: () => {},
    straddle: () => {},
    declineStraddle: () => {},
    showDexter: () => {},
    nextHand: () => {},
    rebuy: () => {},
    restart: () => {},
    winners: [],
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
    runToHero,
  } as unknown as TestGame
}
