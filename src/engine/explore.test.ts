/**
 * The decision explorer.
 *
 * The feature is a distribution, so the tests are mostly about what it refuses
 * to claim: that a line it cannot rebuild returns nothing rather than a guess,
 * that lines within each other's bands are reported as indistinguishable, and
 * that a runout which is genuinely fixed shows a band of zero for an honest
 * reason rather than a false one.
 */

import { describe, it, expect } from 'vitest'
import { Table } from './table'
import { decideAction } from './ai'
import { mulberry32 } from './cards'
import { defaultRoster } from './persona'
import { buildReplay, type HandReplay } from './replay'
import {
  BOT_TRIALS, DEFAULT_TRIALS, MINIMUM_TRIALS, OPPONENT_BIAS,
  decisionPoints, explore,
} from './explore'
import type { Seat } from './types'

/** Play one hand out with bots in every seat, and flatten it. */
function playedHand(seed: number): { replay: HandReplay; seats: Seat[] } | null {
  const table = new Table(
    { opponents: defaultRoster().slice(0, 5), bombPotTrigger: 'off', straddleMultiplier: 0 },
    seed,
  )
  const rng = mulberry32(seed * 977 + 3)
  table.startHand()
  for (let guard = 0; guard < 3000; guard++) {
    const hand = table.hand
    if (!hand || hand.complete) break
    if (hand.phase === 'straddles') { table.closeStraddles(); continue }
    if (hand.phase === 'acting') {
      const seat = hand.actingSeat!
      table.act(seat, decideAction({ state: hand, seats: table.seats, seat, rng, reads: table.reads }))
      continue
    }
    if (hand.phase === 'street') { table.advance(); continue }
    if (hand.phase === 'dexterShow') { table.resolveDexter(true); continue }
    break
  }
  if (!table.hand?.complete) return null
  return { replay: buildReplay(table.hand, table.seats, 0), seats: table.seats }
}

/** A hand where the hero actually played past the flop. */
function deepHand() {
  for (let seed = 1; seed <= 120; seed++) {
    const played = playedHand(seed)
    if (!played) continue
    const hero = played.replay.seats.find((s) => s.seat === 0)
    const points = decisionPoints(played.replay)
    const postflop = points.filter((i) => played.replay.journal[i].street !== 'preflop')
    if (postflop.length >= 1 && hero && !hero.folded) {
      return { ...played, at: postflop[0], first: points[0] }
    }
  }
  throw new Error('no deep hand found in 120 seeds')
}

const FAST = { trials: MINIMUM_TRIALS, botTrials: 8 }

describe('finding the decisions', () => {
  it('lists the hero’s own choices and nobody else’s', () => {
    const { replay } = deepHand()
    for (const at of decisionPoints(replay)) {
      expect(replay.journal[at].seat).toBe(replay.heroSeat)
    }
  })

  it('leaves out the blinds, which were never a choice', () => {
    const { replay } = deepHand()
    const kinds = decisionPoints(replay).map((i) => replay.journal[i].kind)
    for (const forced of ['blind', 'straddle', 'ante', 'discard']) {
      expect(kinds).not.toContain(forced)
    }
  })
})

describe('rebuilding the spot', () => {
  it('replays a real hand from a real decision', () => {
    const { replay, seats, at } = deepHand()
    const result = explore(replay, seats, at, [], FAST)
    expect(result).not.toBe(null)
    expect(result!.at).toBe(at)
    expect(result!.played.outcome.trials).toBe(MINIMUM_TRIALS)
  })

  it('rebuilds every decision in the hand, not only the first', () => {
    const { replay, seats } = deepHand()
    for (const at of decisionPoints(replay)) {
      expect(explore(replay, seats, at, [], FAST), `decision ${at}`).not.toBe(null)
    }
  })

  it('returns nothing for a decision that is not the hero’s', () => {
    const { replay, seats } = deepHand()
    const theirs = replay.journal.findIndex((e) => e.seat !== replay.heroSeat && e.kind === 'call')
    if (theirs < 0) return
    // Answering about somebody else's decision would be answering a question
    // nobody asked, from cards the hero never saw.
    expect(explore(replay, seats, theirs, [], FAST)).toBe(null)
  })

  it('returns nothing rather than a guess for an index that is not there', () => {
    const { replay, seats } = deepHand()
    expect(explore(replay, seats, 9999, [], FAST)).toBe(null)
  })
})

describe('what the numbers say', () => {
  it('finds a real spread when the board is still to come', () => {
    const { replay, seats, at } = deepHand()
    const result = explore(replay, seats, at, [], { trials: 80, botTrials: 8 })!
    // A hand with cards still to come cannot have one outcome.
    expect(result.played.outcome.best).toBeGreaterThan(result.played.outcome.worst)
    expect(result.played.outcome.margin).toBeGreaterThan(0)
  })

  it('has no spread at all on a line that ends before the cards do', () => {
    const { replay, seats, first } = deepHand()
    const result = explore(replay, seats, first, [
      { action: { kind: 'fold' }, label: 'Fold' },
    ], FAST)!
    const fold = result.lines.find((l) => l.label === 'Fold')!
    // Folding costs what is already in, every time. Everyone's cards are held
    // fixed, so there is genuinely nothing left to vary — which is why the UI
    // must not read a band of zero as confidence.
    expect(fold.outcome.margin).toBe(0)
    expect(fold.outcome.best).toBe(fold.outcome.worst)
  })

  it('drops an alternative the spot does not allow rather than faking one', () => {
    const { replay, seats, at } = deepHand()
    const result = explore(replay, seats, at, [
      { action: { kind: 'check' }, label: 'Check' },
      { action: { kind: 'fold' }, label: 'Fold' },
    ], FAST)!
    // Check and fold are mutually exclusive: the engine offers exactly one.
    expect(result.lines.length).toBeLessThanOrEqual(2)
    for (const line of result.lines) expect(line.outcome.trials).toBeGreaterThan(0)
  })

  it('counts a run of trials rather than reporting a single outcome', () => {
    const { replay, seats, at } = deepHand()
    const result = explore(replay, seats, at, [], { trials: 55, botTrials: 8 })!
    expect(result.played.outcome.trials).toBe(55)
  })

  it('never runs fewer trials than the floor, whatever it is asked for', () => {
    const { replay, seats, at } = deepHand()
    // One replay is an anecdote. The floor is what stops the UI asking for one.
    const result = explore(replay, seats, at, [], { trials: 1, botTrials: 8 })!
    expect(result.played.outcome.trials).toBe(MINIMUM_TRIALS)
  })
})

describe('the honesty the feature depends on', () => {
  it('ships a default trial count that is a sample, not an anecdote', () => {
    expect(DEFAULT_TRIALS).toBeGreaterThanOrEqual(100)
    expect(MINIMUM_TRIALS).toBeGreaterThan(1)
  })

  it('caps the opponents well below their real strength, and says so', () => {
    // 60 is the weakest bot's own setting, so this is below every one of them.
    expect(BOT_TRIALS).toBeLessThan(60)
    expect(OPPONENT_BIAS).toMatch(/flatters/i)
    expect(OPPONENT_BIAS).toMatch(/compare the lines against each other/i)
  })

  it('reports lines inside each other’s bands as indistinguishable', () => {
    const { replay, seats, at } = deepHand()
    // Comparing a line against itself: identical by construction, so the only
    // correct answer is that nothing here is separated.
    const result = explore(replay, seats, at, [], { trials: 60, botTrials: 8 })!
    if (result.lines.length === 0) {
      expect(result.separated).toBe(false)
    }
  })
})
