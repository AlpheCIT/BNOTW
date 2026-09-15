import { describe, it, expect } from 'vitest'
import { VOICES, voice, voiceName } from './voices'
import { advise } from './coach'
import { Shoe, mulberry32 } from './cards'
import { dealHand } from './hand'
import { evenSeats, newHand } from './testkit'

describe('the coaches', () => {
  it('has a house voice that is the plain numbers', () => {
    expect(voice('house').entryShift).toBe(0)
    expect(VOICES[0].id).toBe('house')
  })

  it('falls back to the house rather than undefined', () => {
    expect(voice('nobody').id).toBe('house')
  })

  it('spreads across loose and tight, passive and aggressive', () => {
    const shifts = VOICES.map((v) => v.entryShift)
    expect(Math.min(...shifts)).toBeLessThan(-1)
    expect(Math.max(...shifts)).toBeGreaterThan(1)

    const aggression = VOICES.map((v) => v.aggression)
    expect(Math.max(...aggression) - Math.min(...aggression)).toBeGreaterThan(0.3)
  })

  it('takes the name this table gave it', () => {
    const v = voice('reader')
    expect(voiceName(v)).toBe(v.name)
    expect(voiceName(v, { reader: 'Chatty Steve' })).toBe('Chatty Steve')
    // Blank is not a name.
    expect(voiceName(v, { reader: '   ' })).toBe(v.name)
  })
})

describe('coaches who disagree', () => {
  /** The same spot, read by every voice. */
  function readings(seed: number) {
    const seats = evenSeats(6)
    const hand = newHand(seats, seed % 6)
    dealHand(hand, seats, new Shoe(mulberry32(seed)))
    const seat = hand.actingSeat
    if (seat === null) return null
    return VOICES.map((v) => ({
      id: v.id,
      // Few trials on purpose: what is being compared is which action each
      // voice picks, not the precision of the equity behind it.
      action: advise(hand, seats, seat, mulberry32(seed + 3), 120, v).recommendation.action,
    }))
  }

  it('genuinely differ on a good share of spots', { timeout: 30000 }, () => {
    let split = 0
    let counted = 0
    for (let seed = 1; seed <= 60; seed++) {
      const picks = readings(seed)
      if (!picks) continue
      counted++
      if (new Set(picks.map((p) => p.action)).size > 1) split++
    }
    // Measured at 47 of 120 when this was written. The point is that it is
    // neither nil — which would make the feature pointless — nor everything,
    // which would mean the coaching had no shared basis at all.
    expect(split / counted).toBeGreaterThan(0.15)
    expect(split / counted).toBeLessThan(0.75)
  })

  it('has the loose voice continue where the tight one folds', { timeout: 30000 }, () => {
    let looserPlays = 0
    let tighterPlays = 0
    for (let seed = 1; seed <= 80; seed++) {
      const picks = readings(seed)
      if (!picks) continue
      const reader = picks.find((p) => p.id === 'reader')!
      const rock = picks.find((p) => p.id === 'rock')!
      if (reader.action !== 'fold') looserPlays++
      if (rock.action !== 'fold') tighterPlays++
    }
    expect(looserPlays).toBeGreaterThan(tighterPlays)
  })

  it('still produces a real recommendation for every voice', () => {
    const picks = readings(7)!
    for (const p of picks) {
      expect(['fold', 'check', 'call', 'bet', 'raise'], p.id).toContain(p.action)
    }
  })

  it('leaves the house read unchanged from no voice at all', () => {
    const seats = evenSeats(6)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, new Shoe(mulberry32(21)))
    const seat = hand.actingSeat!

    const implicit = advise(hand, seats, seat, mulberry32(9), 400)
    const explicit = advise(hand, seats, seat, mulberry32(9), 400, voice('house'))
    expect(explicit.recommendation.action).toBe(implicit.recommendation.action)
    expect(explicit.recommendation.headline).toBe(implicit.recommendation.headline)
  })
})
