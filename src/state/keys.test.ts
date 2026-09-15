// @vitest-environment jsdom
/**
 * The storage registry.
 *
 * This file exists to make one specific bug impossible: adding a per-player
 * key and forgetting that deleting a player has to remove it. That failure is
 * completely silent — no error, no failing test, no symptom at all until
 * somebody else's hands turn up in a new player's history — so the check has
 * to come from the source rather than from remembering.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORED, playerKeys, scopeOf } from './keys'
import { DEFAULT_PROFILE_ID, scopedKey } from './profiles'

/** Every `bnotw.*` key literal the app defines, found in the source. */
function keysInSource(): string[] {
  const files = ['src/state/storage.ts', 'src/state/profiles.ts', 'src/state/db.ts']
  const found = new Set<string>()
  for (const file of files) {
    const text = readFileSync(join(process.cwd(), file), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const m of code.matchAll(/'(bnotw\.[a-z.]+v\d)'/g)) found.add(m[1])
  }
  return [...found]
}

describe('nothing stored is left off the list', () => {
  it('finds keys in the source at all', () => {
    // A scan that matches nothing would pass every test below while checking
    // exactly nothing.
    expect(keysInSource().length).toBeGreaterThan(8)
  })

  it('registers every key the app defines', () => {
    const registered = new Set(STORED.map((t) => t.key))
    const missing = keysInSource().filter((k) => !registered.has(k))
    expect(missing, `unregistered keys: ${missing.join(', ')}`).toEqual([])
  })

  it('registers nothing the app does not actually use', () => {
    const inSource = new Set(keysInSource())
    const stale = STORED.map((t) => t.key).filter((k) => !inSource.has(k))
    expect(stale, `registry mentions keys nothing uses: ${stale.join(', ')}`).toEqual([])
  })

  it('says of each one what it is and whose it is', () => {
    for (const thing of STORED) {
      expect(['device', 'player'], thing.key).toContain(thing.scope)
      expect(thing.what.length, thing.key).toBeGreaterThan(20)
    }
    expect(new Set(STORED.map((t) => t.key)).size).toBe(STORED.length)
  })
})

describe('what belongs to a player', () => {
  it('covers the four records of somebody’s play', () => {
    const player = playerKeys()
    for (const key of [
      'bnotw.player.v1', 'bnotw.drill.v1', 'bnotw.coach.v1', 'bnotw.layers.v1',
    ]) {
      expect(player, `${key} should follow the player`).toContain(key)
    }
  })

  it('counts a table in progress as the player’s', () => {
    // Shared, handing the iPad over would sit the next person behind your
    // chips — and cashing out would record your night under their name.
    expect(scopeOf('bnotw.table.v1')).toBe('player')
    expect(scopeOf('bnotw.table.coach.v1')).toBe('player')
  })

  it('keeps the crew’s own things on the device', () => {
    // The Record Book is money owed between real people; the roster and the
    // hand names are this table's, not any one player's.
    expect(scopeOf('bnotw.recordbook.v1')).toBe('device')
    expect(scopeOf('bnotw.roster.v1')).toBe('device')
    expect(scopeOf('bnotw.handnames.v1')).toBe('device')
    expect(scopeOf('bnotw.voices.v1')).toBe('device')
  })

  it('never scopes the credentials to a player', () => {
    // One key configured once. Per player it would be asked for again on every
    // new profile, which is how a key ends up written down somewhere worse.
    expect(scopeOf('bnotw.coachcreds.v1')).toBe('device')
  })

  it('has nothing to say about a key it has never heard of', () => {
    expect(scopeOf('bnotw.invented.v1')).toBe(null)
  })
})

describe('the keys a player actually writes', () => {
  it('leaves the default profile on the bare keys', () => {
    for (const key of playerKeys()) {
      expect(scopedKey(key, DEFAULT_PROFILE_ID)).toBe(key)
    }
  })

  it('gives everybody else their own, with no two colliding', () => {
    const mine = playerKeys().map((k) => scopedKey(k, 'dave'))
    const yours = playerKeys().map((k) => scopedKey(k, 'eadie'))
    expect(new Set([...mine, ...yours]).size).toBe(mine.length + yours.length)
  })
})
