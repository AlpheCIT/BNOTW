import { describe, it, expect } from 'vitest'
import { mulberry32 } from './cards'
import { decideAction, decideDiscard } from './ai'
import { archetype, personaFromArchetype, type Persona, type Skill } from './persona'
import { Table } from './table'
import { money } from './bnotw'

/**
 * Does the skill dial actually move money?
 *
 * Measuring this needs care. Straight self-play is far too noisy: over 7,200
 * hands the seat-to-seat swing swamped any skill effect entirely. These tests
 * use duplicate scoring instead — the same decks are played twice with the
 * skills swapped between the seats, and the higher-skilled profile's results
 * are added across both runs, so card luck and any seat advantage appear in
 * both halves and cancel. The control below confirms that cancellation is
 * exact.
 */

/**
 * Yield to the event loop. These sessions run tens of seconds of solid CPU in
 * one test, which starves Vitest's worker RPC and makes the run report an
 * unhandled "Timeout calling onTaskUpdate" alongside passing tests. Pausing
 * occasionally costs nothing and keeps the reporter fed.
 */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Net result of seat 1 and seat 2 over `hands`, from a fixed deck seed. */
async function session(seed: number, hands: number, skills: [Skill, Skill]): Promise<[number, number]> {
  const style = archetype('grinder')!.tendencies
  const make = (name: string, skill: Skill): Persona => ({
    ...personaFromArchetype(name, 'grinder', name.toLowerCase()),
    skill,
    tendencies: { ...style, straddle: 0 },
  })
  const table = new Table(
    {
      opponents: [make('A', skills[0]), make('B', skills[1])],
      bombPotTrigger: 'off',
      straddleMultiplier: 0,
      // The table's own auto-rebuy drops $40 into a stack after the hand and
      // would read as profit. Rebuys happen below, before each snapshot.
      botAutoRebuy: false,
    },
    seed,
  )
  table.seats[0].sittingOut = true // heads up between the two bots
  const rng = mulberry32(seed * 7919 + 13)
  const net: [number, number] = [0, 0]

  for (let i = 0; i < hands; i++) {
    if (i % 50 === 0) await breathe()
    for (const s of table.seats.slice(1)) if (s.stack < 200) table.rebuy(s.seat)
    const before = [table.seats[1].stack, table.seats[2].stack]
    const hand = table.startHand()
    if (hand.phase === 'straddles') table.closeStraddles()
    for (let g = 0; g < 5000 && !hand.complete; g++) {
      switch (hand.phase) {
        case 'acting': {
          const seat = hand.actingSeat!
          table.act(seat, decideAction({
            state: hand, seats: table.seats, seat, rng, reads: table.reads,
          }))
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
    net[0] += table.seats[1].stack - before[0]
    net[1] += table.seats[2].stack - before[1]
  }
  return net
}

/** The stronger profile's total across both halves, in cents and in bb/100. */
async function duplicate(seeds: number[], hands: number, strong: Skill, weak: Skill) {
  const perSeed: number[] = []
  for (const seed of seeds) {
    const [a] = await session(seed, hands, [strong, weak])
    const [, b] = await session(seed, hands, [weak, strong])
    perSeed.push(a + b)
  }
  const total = perSeed.reduce((x, y) => x + y, 0)
  return { total, perSeed, bbPer100: (total / (seeds.length * hands * 2) / 50) * 100 }
}

describe('duplicate scoring', () => {
  it('cancels to exactly nothing when both seats play identically', async () => {
    const r = await duplicate([11, 23], 200, 3, 3)
    // Same profile in both seats means the two halves are mirror images, so
    // anything other than zero here is a leak in the measurement itself, not
    // a result. This caught the auto-rebuy landing in the books as profit.
    expect(r.total, `control was ${money(r.total)} [${r.perSeed.join(', ')}]`).toBe(0)
  }, 180_000)
})

describe('the skill dial moves money', () => {
  it('has a solid player beat a beginner over a long session', async () => {
    const r = await duplicate([11, 23, 37], 250, 3, 1)
    // Measured at roughly +33 bb/100 over 3,000 hands; the floor here is set
    // well below that so an unrelated change to the bots does not fail it.
    expect(
      r.bbPer100,
      `solid vs beginner: ${r.bbPer100.toFixed(1)} bb/100 [${r.perSeed.map((x) => x / 100).join(', ')}]`,
    ).toBeGreaterThan(5)
  }, 300_000)
})
