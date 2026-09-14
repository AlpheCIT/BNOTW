import { it } from 'vitest'
import { mulberry32 } from './cards'
import { decideAction, decideDiscard } from './ai'
import { advise, reviewDecision } from './coach'
import { archetype, personaFromArchetype, type Persona, type Skill } from './persona'
import { Table } from './table'
import { BIG_BLIND } from './bnotw'

/** EV the coach says a given skill level gives up, per 100 hands. */
function measure(skill: Skill, hands: number, seed: number) {
  const style = archetype('grinder')!.tendencies
  const make = (name: string, s: Skill): Persona => ({
    ...personaFromArchetype(name, 'grinder', name.toLowerCase()),
    skill: s,
    tendencies: { ...style, straddle: 0 },
  })
  // The subject sits in seat 1 against a fixed field of solid players.
  const table = new Table(
    {
      opponents: [make('Subject', skill), ...[2, 3, 4, 5].map((i) => make(`F${i}`, 3))],
      bombPotTrigger: 'off',
      straddleMultiplier: 0,
      botAutoRebuy: false,
    },
    seed,
  )
  table.seats[0].sittingOut = true
  const rng = mulberry32(seed * 104729 + 7)

  let evLost = 0
  let decisions = 0
  let agreed = 0

  for (let i = 0; i < hands; i++) {
    for (const s of table.seats.slice(1)) if (s.stack < 400) table.rebuy(s.seat)
    const hand = table.startHand()
    if (hand.phase === 'straddles') table.closeStraddles()
    for (let g = 0; g < 5000 && !hand.complete; g++) {
      switch (hand.phase) {
        case 'acting': {
          const seat = hand.actingSeat!
          const action = decideAction({ state: hand, seats: table.seats, seat, rng })
          if (seat === 1) {
            const advice = advise(hand, table.seats, seat, rng, 500)
            const review = reviewDecision(advice, action)
            evLost += review.evLost
            decisions++
            if (review.agreed) agreed++
          }
          table.act(seat, action)
          break
        }
        case 'discard': {
          const s = hand.pendingDiscards[0]
          table.discard(s, decideDiscard(hand, s, rng))
          break
        }
        case 'street': table.advance(); break
        case 'dexterShow': table.resolveDexter(true); break
        default: throw new Error(`Stuck in ${hand.phase}`)
      }
    }
    table.finishHand()
  }

  return {
    evLossPer100Hands: (evLost / BIG_BLIND / hands) * 100,
    decisionsPerHand: decisions / hands,
    agreement: decisions ? agreed / decisions : 0,
  }
}

/**
 * The calibration harness behind the rating constants in `playerStats.ts`.
 *
 * It takes around ten minutes, so it does not run with the suite. To re-derive
 * the numbers after changing the bots or the coach:
 *
 *   npm run calibrate
 */
declare const process: { env: Record<string, string | undefined> }
const ENABLED = process.env.BNOTW_CALIBRATE === '1'

it.skipIf(!ENABLED)('measures the EV each skill level gives up', () => {
  for (const skill of [1, 2, 3, 4, 5] as Skill[]) {
    const runs = [101, 202, 303, 404].map((seed) => measure(skill, 200, seed))
    const avg = (pick: (r: ReturnType<typeof measure>) => number) =>
      runs.reduce((s, r) => s + pick(r), 0) / runs.length
    console.log(
      `skill ${skill}  EV given up ${avg((r) => r.evLossPer100Hands).toFixed(2).padStart(7)} bb/100 hands  ` +
      `agreement ${(avg((r) => r.agreement) * 100).toFixed(1)}%  ` +
      `decisions/hand ${avg((r) => r.decisionsPerHand).toFixed(2)}`,
    )
  }
}, 1_800_000)
