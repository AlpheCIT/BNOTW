// @vitest-environment jsdom
/**
 * Local player profiles.
 *
 * The property that matters is separation: one person's hands must never
 * appear in another's record, and a guest's must appear in nobody's. Most of
 * what is tested here is the key scoping that makes that true, plus the two
 * profiles that are special — the default, whose records are the unscoped ones
 * everybody had before profiles existed, and the guest, who has none.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_PROFILE_ID, EXPERIENCE, GUEST_ID, PROFILE_COLOURS,
  displayName, experienceMeta, guestProfile, hasLegacyHistory, initialsFor,
  isGuest, isGuestId, loadActiveProfile, loadProfiles, makeProfile,
  saveActiveProfile, saveProfiles, scopedKey,
} from './profiles'
import {
  emptyCoachStats, emptyDrillStats,
  loadCoachStats, loadDrillStats, loadLayers, loadPlayerLog,
  saveCoachStats, saveDrillStats, saveLayers, savePlayerLog,
} from './storage'
import { accumulate, emptyTotals, type HandRecord } from '../engine/playerStats'

beforeEach(() => { localStorage.clear() })

function hand(at: number): HandRecord {
  return {
    at, mode: 'table', handNumber: at, bomb: false, position: 'btn',
    hole: 'As Kd', couldStraddle: true, straddled: false, vpip: true, pfr: false,
    facedRaise: false, threeBet: false, sawFlop: true, showdown: false,
    wonShowdown: false, net: 100, aggressive: 0, passive: 0,
    dexterHeld: false, dexterWon: false, decisions: [],
  }
}

const logOf = (hands: HandRecord[]) =>
  ({ version: 1 as const, totals: hands.reduce(accumulate, emptyTotals()), hands })

describe('where a profile keeps things', () => {
  it('gives the default profile the keys everyone already had', () => {
    // This is what stops an upgrade looking like a wiped history.
    expect(scopedKey('bnotw.player.v1', DEFAULT_PROFILE_ID)).toBe('bnotw.player.v1')
  })

  it('suffixes everybody else', () => {
    expect(scopedKey('bnotw.player.v1', 'dave')).toBe('bnotw.player.v1:dave')
    expect(scopedKey('bnotw.drill.v1', 'dave')).toBe('bnotw.drill.v1:dave')
  })

  it('refuses to hand a guest a key at all', () => {
    // Failing loudly beats quietly writing a guest's hands to disk.
    expect(() => scopedKey('bnotw.player.v1', GUEST_ID)).toThrow(/guest/i)
  })
})

describe('keeping histories apart', () => {
  it('does not show one player another player’s hands', () => {
    savePlayerLog(logOf([hand(1), hand(2)]), DEFAULT_PROFILE_ID)
    savePlayerLog(logOf([hand(3)]), 'dave')

    expect(loadPlayerLog(DEFAULT_PROFILE_ID).hands).toHaveLength(2)
    expect(loadPlayerLog('dave').hands).toHaveLength(1)
    expect(loadPlayerLog('dave').totals.hands).toBe(1)
  })

  it('leaves somebody who has never played with an empty record', () => {
    savePlayerLog(logOf([hand(1)]), DEFAULT_PROFILE_ID)
    expect(loadPlayerLog('nobody').hands).toEqual([])
    expect(loadPlayerLog('nobody').totals.hands).toBe(0)
  })

  it('separates practice, the coach scorecard and the layers too', () => {
    saveDrillStats({ ...emptyDrillStats(), spots: 9, agreed: 4 }, 'dave')
    saveCoachStats({ ...emptyCoachStats(), decisions: 5, agreed: 3 }, 'dave')
    saveLayers(['price'], 'dave')

    expect(loadDrillStats('dave').spots).toBe(9)
    expect(loadDrillStats(DEFAULT_PROFILE_ID).spots).toBe(0)
    expect(loadCoachStats('dave').decisions).toBe(5)
    expect(loadCoachStats(DEFAULT_PROFILE_ID).decisions).toBe(0)
    expect(loadLayers('dave')).toEqual(['price'])
    expect(loadLayers(DEFAULT_PROFILE_ID)).toBe(null)
  })
})

describe('the guest', () => {
  it('writes nothing, whatever it is asked to save', () => {
    savePlayerLog(logOf([hand(1), hand(2)]), GUEST_ID)
    saveDrillStats({ ...emptyDrillStats(), spots: 4, agreed: 2 }, GUEST_ID)
    saveCoachStats({ ...emptyCoachStats(), decisions: 3 }, GUEST_ID)
    saveLayers(['price', 'hand'], GUEST_ID)

    // Not one key. Not under the guest's name and not under anybody else's.
    expect(localStorage.length).toBe(0)
  })

  it('reads back empty rather than somebody else’s history', () => {
    savePlayerLog(logOf([hand(1)]), DEFAULT_PROFILE_ID)
    // The failure this guards is a guest inheriting the device owner's record
    // by falling through to the unscoped key.
    expect(loadPlayerLog(GUEST_ID).hands).toEqual([])
    expect(loadDrillStats(GUEST_ID).spots).toBe(0)
    expect(loadLayers(GUEST_ID)).toBe(null)
  })

  it('is never remembered as the active player', () => {
    saveActiveProfile('dave')
    saveActiveProfile(GUEST_ID)
    // Otherwise the next person to open the app lands in a stranger's
    // throwaway session rather than being asked who they are.
    expect(loadActiveProfile()).toBe(null)
  })

  it('is built fresh every time, so nothing carries between guests', () => {
    const a = guestProfile()
    const b = guestProfile()
    expect(a).toEqual(b)
    expect(isGuest(a)).toBe(true)
    expect(isGuestId(a.id)).toBe(true)
    expect(isGuest(makeProfile({ name: 'Dave' }))).toBe(false)
  })
})

describe('making a player', () => {
  it('gives each new player a colour nobody has taken', () => {
    const made: ReturnType<typeof makeProfile>[] = []
    for (let i = 0; i < 4; i++) made.push(makeProfile({ name: `P${i}` }, made))
    expect(new Set(made.map((p) => p.colour)).size).toBe(4)
    for (const p of made) expect(PROFILE_COLOURS).toContain(p.colour)
  })

  it('gives each one an id of its own', () => {
    const ids = Array.from({ length: 20 }, () => makeProfile({ name: 'Same' }).id)
    expect(new Set(ids).size).toBe(20)
  })

  it('works out the letters on the chip', () => {
    expect(initialsFor({ name: 'Richard Helms' })).toBe('RH')
    expect(initialsFor({ name: 'Dave' })).toBe('DA')
    expect(initialsFor({ name: 'Dave', initials: 'dd' })).toBe('DD')
    expect(initialsFor({ name: '  ' })).toBe('?')
    // Three characters is the most the chip can hold.
    expect(initialsFor({ name: 'X', initials: 'abcdef' })).toBe('ABC')
  })

  it('shows the nickname when there is one', () => {
    expect(displayName(makeProfile({ name: 'Richard', nickname: 'Rich' }))).toBe('Rich')
    expect(displayName(makeProfile({ name: 'Richard' }))).toBe('Richard')
    expect(displayName(makeProfile({ name: 'Richard', nickname: '  ' }))).toBe('Richard')
  })
})

describe('experience', () => {
  it('only decides how much of the coach starts switched on', () => {
    expect(experienceMeta('new').layers).toEqual(['price'])
    expect(experienceMeta('serious').layers.length).toBe(4)
    // Strictly widening as experience grows: a level that hid something the
    // one below it showed would read as a punishment.
    let last = 0
    for (const level of EXPERIENCE) {
      expect(level.layers.length, level.id).toBeGreaterThanOrEqual(last)
      last = level.layers.length
    }
  })

  it('falls back rather than throwing on a value it does not know', () => {
    expect(experienceMeta('nonsense' as never).id).toBe('casual')
  })
})

describe('reading the list back', () => {
  it('round-trips', () => {
    const list = [makeProfile({ name: 'Richard' }), makeProfile({ name: 'Dave' })]
    saveProfiles(list)
    expect(loadProfiles().map((p) => p.name)).toEqual(['Richard', 'Dave'])
  })

  it('survives nonsense in storage', () => {
    localStorage.setItem('bnotw.profiles.v1', '{"not":"an array"}')
    expect(loadProfiles()).toEqual([])
    localStorage.setItem('bnotw.profiles.v1', 'not json at all')
    expect(loadProfiles()).toEqual([])
  })

  it('drops entries that are not profiles, keeping the ones that are', () => {
    localStorage.setItem('bnotw.profiles.v1', JSON.stringify([
      { id: 'a', name: 'Real' },
      { id: 'b' },
      null,
      { id: GUEST_ID, name: 'Sneaky' },
    ]))
    // A stored guest would be a guest whose hands persist, which is a guest
    // that does not do the one thing a guest is for.
    expect(loadProfiles().map((p) => p.id)).toEqual(['a'])
  })

  it('fills in fields added since a profile was written', () => {
    localStorage.setItem('bnotw.profiles.v1', JSON.stringify([{ id: 'a', name: 'Old' }]))
    const [restored] = loadProfiles()
    expect(restored.experience).toBe('casual')
    expect(restored.colour).toBeTruthy()
    expect(restored.nickname).toBe('')
  })
})

describe('a history from before profiles existed', () => {
  it('is noticed, so it can be handed to the person who made it', () => {
    expect(hasLegacyHistory()).toBe(false)
    savePlayerLog(logOf([hand(1)]), DEFAULT_PROFILE_ID)
    expect(hasLegacyHistory()).toBe(true)
  })

  it('is not confused with somebody else’s scoped history', () => {
    savePlayerLog(logOf([hand(1)]), 'dave')
    expect(hasLegacyHistory()).toBe(false)
  })
})
