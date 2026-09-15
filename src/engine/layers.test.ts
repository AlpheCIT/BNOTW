/**
 * The learning path.
 *
 * Two things matter here. The leak names have to match the ones the coach
 * actually records — a typo would show up as a layer that never settles,
 * which is invisible rather than loud. And a suggestion must never appear
 * before it has been earned: the whole point is one question at a time.
 */

import { describe, it, expect } from 'vitest'
import {
  LAYERS, LAYER_LEAKS, SETTLED_AFTER, SETTLED_UNDER, STARTING_LAYERS,
  allLayers, layer, layerProgress, suggestLayer, type LayerId,
} from './layers'
import { accumulate, emptyTotals, type HandRecord, type PlayerTotals } from './playerStats'
import { reviewDecision, type CoachAdvice } from './coach'

function totalsWith(decisions: number, leaks: Record<string, number> = {}): PlayerTotals {
  return { ...emptyTotals(), decisions, leaks: { ...leaks } }
}

describe('the layers themselves', () => {
  it('runs price, hand, player, table in that order', () => {
    expect(LAYERS.map((l) => l.id)).toEqual(['price', 'hand', 'player', 'table'])
  })

  it('starts a new player on one question rather than four', () => {
    expect(STARTING_LAYERS).toEqual(['price'])
    expect(allLayers()).toHaveLength(LAYERS.length)
  })

  it('gives every layer a question and something to show', () => {
    for (const l of LAYERS) {
      expect(l.question.endsWith('?'), l.id).toBe(true)
      expect(l.shows.length, l.id).toBeGreaterThan(30)
    }
  })

  it('admits the table layer cannot be measured', () => {
    // Reading a room happens between the hands, where the app cannot see.
    expect(layer('table').measurable).toBe(false)
    expect(LAYERS.filter((l) => l.measurable)).toHaveLength(3)
    expect(LAYER_LEAKS.table).toEqual([])
  })

  it('falls back to the first layer rather than undefined', () => {
    expect(layer('nonsense' as LayerId).id).toBe('price')
  })
})

describe('the leak names match the ones the coach records', () => {
  /**
   * Every leak `reviewDecision` can produce, found by driving it rather than
   * by reading it — a list copied by hand is a list that goes stale.
   */
  function everyLeak(): Set<string> {
    const found = new Set<string>()
    const actions = ['fold', 'check', 'call', 'bet', 'raise'] as const
    for (const want of actions) {
      for (const did of actions) {
        for (const callEV of [-500, 0, 500]) {
          for (const boardLen of [0, 3]) {
            // Sizes as well as actions: a bet far off the coach's line is its
            // own leak, and a driver that never varies the amount would report
            // that leak as one nothing can produce.
            for (const [wantAmount, didAmount] of [[0, 0], [600, 600], [600, 100], [600, 5000]]) {
            const advice = {
              board: Array(boardLen).fill({ rank: 2, suit: 's' }),
              equity: { equity: 0.4, exact: true, runouts: 1, wins: 0, ties: 0 },
              outs: { count: 0, groups: [] },
              madeLabel: 'Ace high',
              opponents: 2,
              breakEven: 0.3,
              callEV,
              pot: 1000,
              toCall: 200,
              starting: { label: 'A-K', chen: 10, grade: 'Strong', note: '' },
              recommendation: {
                action: want, headline: 'x', reasons: [], confidence: 'clear',
                amount: wantAmount || undefined,
              },
            } as unknown as CoachAdvice
            const review = reviewDecision(advice, { kind: did, amount: didAmount || undefined })
            if (review.leak) found.add(review.leak)
            }
          }
        }
      }
    }
    return found
  }

  it('assigns every leak the coach can record to exactly one layer', () => {
    const assigned = Object.values(LAYER_LEAKS).flat()
    expect(new Set(assigned).size, 'a leak in two layers').toBe(assigned.length)

    const unassigned = [...everyLeak()].filter((leak) => !assigned.includes(leak))
    // A leak belonging to no layer is one no layer can ever be settled against.
    expect(unassigned, `unassigned leaks: ${unassigned.join(', ')}`).toEqual([])
  })

  it('names no leak the coach cannot produce', () => {
    const real = everyLeak()
    const phantom = Object.values(LAYER_LEAKS).flat().filter((leak) => !real.has(leak))
    // A renamed leak leaves a string here that nothing will ever match, and a
    // layer that silently never settles.
    expect(phantom, `leaks nothing records: ${phantom.join(', ')}`).toEqual([])
  })
})

describe('when a layer counts as settled', () => {
  it('says nothing at all below the sample size', () => {
    const totals = totalsWith(SETTLED_AFTER - 1)
    const progress = layerProgress(totals, 'price')
    expect(progress.rate).toBe(null)
    expect(progress.settled).toBe(false)
  })

  it('settles a clean record once there is enough of it', () => {
    const progress = layerProgress(totalsWith(SETTLED_AFTER), 'price')
    expect(progress.rate).toBe(0)
    expect(progress.settled).toBe(true)
  })

  it('counts every leak the layer owns, not just the first', () => {
    const totals = totalsWith(100, { 'Called too light': 3, 'Folded a good price': 4 })
    expect(layerProgress(totals, 'price').slips).toBe(7)
  })

  it('does not settle a layer still making its own mistakes', () => {
    const totals = totalsWith(100, { 'Called too light': 20 })
    expect(layerProgress(totals, 'price').settled).toBe(false)
    // Another layer's mistakes are not this layer's problem.
    expect(layerProgress(totals, 'hand').settled).toBe(true)
  })

  it('sits right on the threshold the way the constant says', () => {
    const under = totalsWith(100, { 'Called too light': Math.floor(SETTLED_UNDER * 100) - 1 })
    const over = totalsWith(100, { 'Called too light': Math.ceil(SETTLED_UNDER * 100) + 1 })
    expect(layerProgress(under, 'price').settled).toBe(true)
    expect(layerProgress(over, 'price').settled).toBe(false)
  })

  it('never settles the layer it cannot measure', () => {
    const spotless = totalsWith(10_000)
    expect(layerProgress(spotless, 'table').settled).toBe(false)
  })
})

describe('suggesting the next layer', () => {
  const clean = totalsWith(200)

  it('suggests nothing to someone with everything on', () => {
    expect(suggestLayer(clean, allLayers())).toBe(null)
  })

  it('suggests nothing before the first layer has been earned', () => {
    // A brand new player: no evidence of anything, so no prompt.
    expect(suggestLayer(emptyTotals(), STARTING_LAYERS)).toBe(null)
  })

  it('offers the hand once the price has settled', () => {
    const suggestion = suggestLayer(clean, ['price'])
    expect(suggestion?.layer.id).toBe('hand')
    // The evidence goes in the prompt: a suggestion you cannot check is an ad.
    expect(suggestion?.because).toMatch(/0 slips in 200 decisions/)
  })

  it('holds the next layer back while the current one is still slipping', () => {
    const slipping = totalsWith(200, { 'Called too light': 40 })
    expect(suggestLayer(slipping, ['price'])).toBe(null)
  })

  it('only ever offers the next one, never two at a time', () => {
    const suggestion = suggestLayer(clean, ['price'])
    expect(suggestion?.layer.id).toBe('hand')
    expect(suggestion?.layer.id).not.toBe('player')
  })

  it('fills the gap rather than skipping past it', () => {
    // 'player' is on but 'hand' was never turned on. The offer is the one that
    // is missing, not the one after it — the path has an order for a reason.
    expect(suggestLayer(clean, ['price', 'player'])?.layer.id).toBe('hand')
  })

  it('offers the table layer without pretending to have measured it', () => {
    const suggestion = suggestLayer(clean, ['price', 'hand', 'player'])
    expect(suggestion?.layer.id).toBe('table')
    expect(suggestion?.because).toMatch(/\?$/)
  })

  it('walks the whole path as a record improves', () => {
    let active: LayerId[] = [...STARTING_LAYERS]
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      const next = suggestLayer(clean, active)
      if (!next) break
      seen.push(next.layer.id)
      active = [...active, next.layer.id]
    }
    expect(seen).toEqual(['hand', 'player', 'table'])
  })
})

/** The record the layers read is the one the tracker actually writes. */
describe('against a real record', () => {
  function hand(leak: string | null): HandRecord {
    return {
      at: 1, mode: 'coach', handNumber: 1, bomb: false, position: 'other',
      hole: 'As Kd', couldStraddle: true, straddled: false, vpip: true, pfr: false,
      facedRaise: false, threeBet: false, sawFlop: true, showdown: false,
      wonShowdown: false, net: 0, aggressive: 0, passive: 1,
      dexterHeld: false, dexterWon: false,
      decisions: [{
        street: 'flop', action: 'call', recommended: leak ? 'fold' : 'call',
        agreed: !leak, evLost: leak ? 300 : 0, leak,
      }],
    }
  }

  it('reads slips straight out of accumulated totals', () => {
    const hands = [
      ...Array.from({ length: 90 }, () => hand(null)),
      ...Array.from({ length: 10 }, () => hand('Called too light')),
    ]
    const totals = hands.reduce(accumulate, emptyTotals())

    expect(totals.decisions).toBe(100)
    expect(layerProgress(totals, 'price').slips).toBe(10)
    // 10% is over the 8% bar, so the price is not settled yet.
    expect(layerProgress(totals, 'price').settled).toBe(false)
    expect(suggestLayer(totals, ['price'])).toBe(null)
  })
})
