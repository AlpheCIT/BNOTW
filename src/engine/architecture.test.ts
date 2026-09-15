/**
 * The boundaries, checked rather than trusted.
 *
 * Every rule here is one somebody wrote down as an intention first. Intentions
 * about imports erode one convenient line at a time — nothing breaks, no test
 * goes red, and a year later the rules of poker cannot be read without the
 * house rules wrapped around them. So they are assertions now.
 *
 * Each one exists because of something real:
 *
 * - **Core knows no house rules.** Bomb pots deal the flop before anyone acts
 *   and the Dexter pays a bounty for winning with 7-2. Letting either settle
 *   into betting or showdown would mean poker could not be tested without
 *   them — and drill mode already shipped a bug from exactly that, dealing
 *   practice spots into bomb pots because the trigger fired inside the core.
 *
 * - **The engine has no React, no DOM, no storage.** It is why the coach
 *   could move into a worker, why the calibration runs in Node, and why a
 *   server could run it unchanged.
 *
 * - **A hand is plain data.** `structuredClone` is what carries it to the
 *   worker. A class or a closure inside `HandState` would break that, and it
 *   would break it at runtime in the browser rather than here.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { applyAction, createHand, dealHand, legalActions, livePlayers } from './hand'
import { Shoe, mulberry32 } from './cards'
import { evenSeats, dealOrder } from './testkit'

const ENGINE = join(process.cwd(), 'src/engine')

/** Every non-test source file under a directory, recursively. */
function sources(dir: string, prefix = ''): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...sources(full, rel))
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      out.push({ path: rel, text: readFileSync(full, 'utf8') })
    }
  }
  return out
}

/** Module specifiers a file imports from, ignoring anything in a comment. */
function importsOf(text: string): string[] {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [...withoutComments.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
}

describe('the rules of poker do not know the house rules', () => {
  const core = sources(join(ENGINE, 'core'))

  it('has core files to check in the first place', () => {
    // A rule that silently checks nothing is worse than no rule.
    expect(core.length).toBeGreaterThanOrEqual(5)
  })

  it('never imports a house rule into the core', () => {
    for (const file of core) {
      const bad = importsOf(file.text).filter((spec) => spec.includes('rules/'))
      expect(bad, `core/${file.path} imports ${bad.join(', ')}`).toEqual([])
    }
  })

  it('does not reach for house-rule state from the core either', () => {
    // An import is the obvious way in. Reading `state.pendingDexter` directly
    // is the quiet one, and does the same damage.
    const houseOnly = ['pendingDexter', 'suitedFlopTriggered', 'straddles', 'bombGame']
    for (const file of core) {
      const code = file.text.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const field of houseOnly) {
        expect(code.includes(field), `core/${file.path} uses ${field}`).toBe(false)
      }
    }
  })

  it('lets the house rules build on the core, which is the allowed direction', () => {
    const rules = sources(join(ENGINE, 'rules'))
    expect(rules.length).toBeGreaterThanOrEqual(3)
    const usesCore = rules.some((f) => importsOf(f.text).some((s) => s.includes('core/')))
    expect(usesCore).toBe(true)
  })
})

describe('the engine runs anywhere', () => {
  const engine = sources(ENGINE).filter((f) => !f.path.startsWith('providers/'))

  it('imports no React', () => {
    for (const file of engine) {
      const bad = importsOf(file.text).filter((s) => s === 'react' || s.startsWith('react/'))
      expect(bad, `${file.path} imports React`).toEqual([])
    }
  })

  it('imports nothing from the UI or the storage layer', () => {
    for (const file of engine) {
      const bad = importsOf(file.text)
        .filter((s) => s.includes('/ui/') || s.includes('/state/') || s.startsWith('../state'))
      expect(bad, `${file.path} imports ${bad.join(', ')}`).toEqual([])
    }
  })

  it('touches no browser global', () => {
    // The coach worker has no `document`, Node has no `window`, and a private
    // window can have neither `localStorage` nor `indexedDB`.
    const globals = ['document.', 'window.', 'localStorage', 'indexedDB', 'navigator.']
    for (const file of engine) {
      // `coachWorker` is a worker entry point; `self` is its whole job.
      if (file.path === 'coachWorker.ts') continue
      const code = file.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const g of globals) {
        expect(code.includes(g), `${file.path} touches ${g}`).toBe(false)
      }
    }
  })
})

describe('a hand is plain data', () => {
  /** A hand mid-way through a betting round, with real cards in it. */
  function inProgress() {
    const seats = evenSeats(4)
    const state = createHand({
      handNumber: 1,
      seats,
      order: dealOrder(seats, 3),
      buttonSeat: 3,
      variant: 'holdem',
      bombGame: null,
      bombReason: null,
    })
    dealHand(state, seats, new Shoe(mulberry32(7)))
    applyAction(state, seats, state.actingSeat!, { kind: 'call' })
    return { state, seats }
  }

  it('survives the trip to a worker and back', () => {
    const { state } = inProgress()
    // This is the actual mechanism `useAdvice` uses to hand a spot to the
    // coach worker. A class or a closure anywhere in the tree throws here.
    const clone = structuredClone(state)
    expect(clone).toEqual(state)
  })

  it('is still a working hand on the other side', () => {
    const { state, seats } = inProgress()
    const clone = structuredClone(state)

    // Not just equal — usable. A shape that survives cloning but has lost its
    // behaviour would pass the test above and fail in the worker.
    expect(livePlayers(clone).length).toBe(livePlayers(state).length)
    const legal = legalActions(clone, seats, clone.actingSeat!)
    expect(legal.canFold || legal.canCheck).toBe(true)
  })

  it('carries no functions anywhere in it', () => {
    const { state } = inProgress()
    const seen = new WeakSet<object>()
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'function') throw new Error(`function at ${path}`)
      if (!value || typeof value !== 'object') return
      if (seen.has(value)) return
      seen.add(value)
      // A prototype other than Object/Array means a class instance, which is
      // the thing structuredClone silently flattens.
      const proto = Object.getPrototypeOf(value)
      expect(
        proto === Object.prototype || proto === Array.prototype || proto === null,
        `class instance at ${path}`,
      ).toBe(true)
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
    }
    expect(() => walk(state, 'state')).not.toThrow()
  })
})
