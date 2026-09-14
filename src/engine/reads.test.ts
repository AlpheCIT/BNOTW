import { describe, it, expect } from 'vitest'
import {
  NEUTRAL_FOLD_RATE, READ_CONFIDENCE_AT, emptyReads, noteAction, readFor, readForMany,
} from './reads'
import { ADAPT_BY_SKILL, profileOf } from './ai'
import { personaFromArchetype } from './persona'

/** Record `n` decisions facing a bet, `folds` of which were folds. */
function facing(reads: ReturnType<typeof emptyReads>, seat: number, n: number, folds: number) {
  for (let i = 0; i < n; i++) {
    noteAction(reads, seat, i < folds ? 'fold' : 'call', true, true)
  }
}

describe('reading a seat', () => {
  it('knows nothing about a seat it has never seen', () => {
    const read = readFor(emptyReads(), 3)
    expect(read.confidence).toBe(0)
    expect(read.station).toBe(0)
    expect(read.foldRate).toBe(NEUTRAL_FOLD_RATE)
  })

  it('reads someone who never folds as a station, and the reverse as a nit', () => {
    const reads = emptyReads()
    facing(reads, 1, 40, 0)   // calls everything
    facing(reads, 2, 40, 36)  // folds almost everything

    expect(readFor(reads, 1).station).toBeGreaterThan(0.5)
    expect(readFor(reads, 2).station).toBeLessThan(-0.5)
  })

  it('trusts a read only in proportion to how much it has seen', () => {
    const few = emptyReads()
    facing(few, 1, 4, 0)
    const many = emptyReads()
    facing(many, 1, READ_CONFIDENCE_AT * 2, 0)

    // Same behaviour, very different weight behind it.
    expect(readFor(few, 1).foldRate).toBe(readFor(many, 1).foldRate)
    expect(readFor(few, 1).station).toBeLessThan(readFor(many, 1).station)
    expect(readFor(many, 1).confidence).toBe(1)
  })

  it('counts aggression only where being aggressive was an option', () => {
    const reads = emptyReads()
    // Checked to five times, bet twice.
    for (let i = 0; i < 5; i++) noteAction(reads, 1, i < 2 ? 'bet' : 'check', false, true)
    expect(readFor(reads, 1).aggression).toBeCloseTo(2 / 5)

    // Facing a bet with no raise available must not count as a missed chance:
    // you cannot decline to raise when raising is not on the table.
    const capped = emptyReads()
    for (let i = 0; i < 5; i++) noteAction(capped, 1, 'call', true, false)
    expect(readFor(capped, 1).aggression).toBeCloseTo(0.3) // untouched neutral
  })

  it('keeps a bet read even from a seat that has never faced one', () => {
    // Only ever checked to, so there is no fold data at all — but plenty
    // about how often they bet, and throwing that away would be a waste.
    const reads = emptyReads()
    for (let i = 0; i < 30; i++) noteAction(reads, 1, i < 24 ? 'bet' : 'check', false, true)

    const read = readFor(reads, 1)
    expect(read.aggression).toBeCloseTo(24 / 30)
    expect(read.confidence).toBe(1)
    // And still no opinion on whether they fold, because none has been earned.
    expect(read.station).toBe(0)
  })

  it('averages across the players still in a pot', () => {
    const reads = emptyReads()
    facing(reads, 1, 40, 0)
    facing(reads, 2, 40, 40)
    const together = readForMany(reads, [1, 2])
    // One of each cancels out to roughly nothing to exploit.
    expect(Math.abs(together.station)).toBeLessThan(0.2)
  })

  it('folds an unknown seat into the average without skewing it', () => {
    const reads = emptyReads()
    facing(reads, 1, 40, 0)
    expect(readForMany(reads, [1, 99]).station).toBeLessThan(readFor(reads, 1).station)
  })
})

describe('who is allowed to use a read', () => {
  it('rises with skill, and is nothing at the bottom', () => {
    expect(ADAPT_BY_SKILL[0]).toBe(0)
    expect(ADAPT_BY_SKILL[1]).toBe(0)
    for (let i = 2; i < ADAPT_BY_SKILL.length; i++) {
      expect(ADAPT_BY_SKILL[i], `skill ${i + 1}`).toBeGreaterThan(ADAPT_BY_SKILL[i - 1])
    }
  })

  it('is what separates the top of the ladder from the middle', () => {
    // The documented limitation was that skill 5 played like skill 3, only
    // more accurately. Adaptation is the thing that has to differ.
    const at = (skill: number) =>
      profileOf({ ...personaFromArchetype('X', 'grinder', 'x'), skill: skill as never })
    expect(at(5).adapt).toBeGreaterThan(at(3).adapt * 2)
    expect(at(4).adapt).toBeGreaterThan(at(3).adapt)
  })
})
