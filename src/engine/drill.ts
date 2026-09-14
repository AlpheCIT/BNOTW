/**
 * Drill mode: one decision at a time.
 *
 * Playing whole hands is a slow way to practise a single spot. Ten minutes at
 * the table might put four turn decisions in front of you; this puts forty.
 *
 * Spots are *generated*, not replayed from your history. A spot you have seen
 * before is one you can remember the answer to, which trains recall rather
 * than judgement. So a real hand is dealt and played out by the bots — through
 * the same engine, with the same rules — and handed over at the moment the
 * decision you are weakest at arrives.
 */

import { mulberry32, type Rng } from './cards'
import { decideAction, decideDiscard } from './ai'
import { advise, type CoachAdvice } from './coach'
import { Table, type TableSettings } from './table'
import type { Persona } from './persona'
import type { PlayerTotals } from './playerStats'
import type { HandState, Seat, Street } from './types'

export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

/** A decision, frozen at the moment it is yours. */
export interface DrillSpot {
  /** Live state — the same shape the table uses, so the coach works unchanged. */
  hand: HandState
  seats: Seat[]
  seat: number
  street: Street
  /** What the coach makes of it. Computed once, here, so the UI never blocks. */
  advice: CoachAdvice
}

/**
 * Which streets to drill, weakest first.
 *
 * Weakness is the rate at which your decisions disagree with the coach, not
 * the money lost: money on a street is dominated by how big the pots get
 * there, so measured by money the river would always look worst.
 *
 * A street needs a real sample before it can be called weak — three bad river
 * decisions are not evidence of anything. Streets without one go *after* every
 * measured street rather than being given a made-up middling score: a guessed
 * rate of "wrong half the time" beats any street a competent player is
 * actually on, which would quietly turn this into "drill what you have not
 * measured" instead of "drill what you get wrong". They still get drilled —
 * `pickStreet` never excludes anything — and doing so is what measures them.
 */
export function weakestStreets(totals: PlayerTotals, minimum = 20): Street[] {
  const measured: { street: Street; rate: number }[] = []
  const unmeasured: Street[] = []

  for (const street of STREETS) {
    const row = totals.byStreet?.[street]
    if (!row || row.decisions < minimum) unmeasured.push(street)
    else measured.push({ street, rate: 1 - row.agreed / row.decisions })
  }

  measured.sort((a, b) => b.rate - a.rate)
  return [...measured.map((m) => m.street), ...unmeasured]
}

/**
 * Pick a street to deal, biased towards the weakest but never only that one.
 *
 * Drilling one street exclusively would be both boring and wrong: the streets
 * are not independent, and a turn decision you reach by a different flop is a
 * different decision.
 */
export function pickStreet(order: Street[], rng: Rng): Street {
  // Weights 4:3:2:1 over the ranking — the weakest street comes up four times
  // as often as the strongest, not to the exclusion of it.
  const weights = [4, 3, 2, 1]
  const total = order.reduce((sum, _, i) => sum + (weights[i] ?? 1), 0)
  let roll = rng() * total
  for (let i = 0; i < order.length; i++) {
    roll -= weights[i] ?? 1
    if (roll <= 0) return order[i]
  }
  return order[order.length - 1]
}

export interface DealOptions {
  opponents: Persona[]
  playerName?: string
  /** Monte Carlo trials behind the coach's verdict. */
  trials?: number
  /** How many hands to burn looking for the target street before giving up. */
  attempts?: number
}

/**
 * Deal until a decision on `street` lands on you, and hand it over.
 *
 * Your own seat is played by the bots up to that point. That is deliberate:
 * the spot has to be *arrived at* by plausible play, or it is not a spot you
 * would ever face. A hand where you would have folded pre-flop is not a turn
 * decision you needed to practise.
 *
 * Returns null when the street could not be reached inside `attempts` hands,
 * which is normal for the river — most hands do not get there.
 */
export function dealSpot(street: Street, rng: Rng, options: DealOptions): DrillSpot | null {
  const { opponents, playerName = 'You', trials = 1500, attempts = 40 } = options

  const settings: Partial<TableSettings> = {
    playerName,
    opponents,
    // A bomb pot is its own kind of spot and would muddle a street drill, and
    // a straddle changes the price of everything for reasons unrelated to the
    // decision being practised.
    bombPotTrigger: 'off',
    straddleMultiplier: 0,
    botAutoRebuy: true,
  }
  const table = new Table(settings, Math.floor(rng() * 2 ** 31))
  const seat = table.human.seat

  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const s of table.seats) if (s.stack < 400) table.rebuy(s.seat)
    if (table.activeSeats().length < 2) return null
    // The suited-flop rule forces a bomb pot on the next hand regardless of
    // the trigger setting, so turning the schedule off is not enough on its
    // own. A bomb pot is a different game with a different price; drilling one
    // as if it were a Hold'em street decision would be teaching the wrong
    // lesson.
    table.pendingBomb = null

    const hand = table.startHand()
    if (hand.phase === 'straddles') table.closeStraddles()

    for (let guard = 0; guard < 5000 && !hand.complete; guard++) {
      if (hand.phase === 'acting' && hand.actingSeat === seat) {
        if (hand.street === street) {
          return {
            hand,
            seats: table.seats,
            seat,
            street,
            advice: advise(hand, table.seats, seat, rng, trials),
          }
        }
        // Not there yet: play our own seat as a bot would and carry on.
        table.act(seat, decideAction({ state: hand, seats: table.seats, seat, rng }))
        continue
      }

      switch (hand.phase) {
        case 'acting': {
          const other = hand.actingSeat!
          table.act(other, decideAction({ state: hand, seats: table.seats, seat: other, rng }))
          break
        }
        case 'discard': {
          const d = hand.pendingDiscards[0]
          table.discard(d, decideDiscard(hand, d, rng))
          break
        }
        case 'street': table.advance(); break
        case 'dexterShow': table.resolveDexter(true); break
        default: return null
      }
    }
    table.finishHand()
  }

  return null
}

/**
 * Deal a spot, falling back through the ranking when a street will not come.
 *
 * The river is the reason this exists: most hands end before it, so asking for
 * one and taking null for an answer would leave the drill stalling on exactly
 * the street people most want to practise.
 */
export function nextSpot(
  totals: PlayerTotals,
  rng: Rng,
  options: DealOptions,
): DrillSpot | null {
  const order = weakestStreets(totals)
  const wanted = pickStreet(order, rng)
  // Try what was asked for first, then everything else, hardest to easiest.
  const queue = [wanted, ...STREETS.filter((s) => s !== wanted).reverse()]
  for (const street of queue) {
    const spot = dealSpot(street, rng, options)
    if (spot) return spot
  }
  return null
}

/** A deterministic generator, for tests and for reproducing a reported spot. */
export function seededRng(seed: number): Rng {
  return mulberry32(seed)
}
