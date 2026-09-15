import { describe, it, expect } from 'vitest'
import { mulberry32, Shoe } from './cards'
import { profileOf, decideAction } from './ai'
import {
  ARCHETYPES, DEFAULT_TENDENCIES, TENDENCY_META, archetype, defaultRoster, faceFor,
  matchArchetype, personaFromArchetype, styleSummary, type Persona, type Skill,
} from './persona'
import { dealHand } from './hand'
import { Table } from './table'
import { evenSeats, newHand } from './testkit'
import { BUY_IN_CHIPS } from './bnotw'

describe('the roster', () => {
  it('seats the fourteen BNOTW regulars with unique ids', () => {
    const roster = defaultRoster()
    expect(roster).toHaveLength(14)
    expect(roster.map((p) => p.name)).toEqual([
      'Bob', 'Brett', 'Ransom', 'Dave', 'Don', 'Hal', 'Ian',
      'Eadie', 'Mark', 'Rosen', 'Carter', 'Nate', 'Kruger', 'Richie',
    ])
    expect(new Set(roster.map((p) => p.id)).size).toBe(14)
  })

  it('gives every regular a face and a recognised archetype', () => {
    for (const persona of defaultRoster()) {
      expect(archetype(persona.archetype)).toBeDefined()
      expect(matchArchetype(persona)).toBe(persona.archetype)
      expect(persona.avatar.hair).toBeGreaterThanOrEqual(0)
    }
  })

  it('draws the same face for the same name every time', () => {
    expect(faceFor('Kruger')).toEqual(faceFor('Kruger'))
    expect(faceFor('Kruger')).not.toEqual(faceFor('Carter'))
  })

  it('reports a hand-tuned persona as custom', () => {
    const persona = personaFromArchetype('Test', 'rock')
    expect(matchArchetype(persona)).toBe('rock')
    persona.tendencies.looseness = 99
    expect(matchArchetype(persona)).toBe('custom')
  })

  it('summarises a style in words a player would use', () => {
    expect(styleSummary(archetype('maniac')!.tendencies)).toBe('Loose–aggressive')
    expect(styleSummary(archetype('nit')!.tendencies)).toBe('Tight–passive')
    expect(styleSummary(archetype('station')!.tendencies)).toBe('Loose–passive')
  })
})

describe('tendencies become numbers the bot uses', () => {
  it('turns looseness into how good a hand they need to play', () => {
    const nit = profileOf(personaFromArchetype('N', 'nit'))
    const maniac = profileOf(personaFromArchetype('M', 'maniac'))
    // A nit needs roughly pocket tens or better; a maniac needs almost nothing.
    expect(nit.openThreshold).toBeGreaterThan(11)
    expect(maniac.openThreshold).toBeLessThan(3.5)
  })

  it('turns chasing into how far past the right price they will call', () => {
    const station = profileOf(personaFromArchetype('S', 'station'))
    const nit = profileOf(personaFromArchetype('N', 'nit'))
    expect(station.callTightness).toBeLessThan(1)   // calls below the odds
    expect(nit.callTightness).toBeGreaterThan(1)    // needs better than the odds
  })

  it('sharpens the read as skill goes up, and it alone', () => {
    const base = personaFromArchetype('X', 'grinder')
    const weak = profileOf({ ...base, skill: 1 })
    const strong = profileOf({ ...base, skill: 5 })
    expect(weak.noise).toBeGreaterThan(strong.noise * 5)
    expect(strong.trials).toBeGreaterThan(weak.trials)
    expect(strong.positionAware).toBeGreaterThan(weak.positionAware)
    // Taste is untouched by skill.
    expect(weak.openThreshold).toBe(strong.openThreshold)
    expect(weak.aggression).toBe(strong.aggression)
  })

  it('covers every archetype without producing a nonsense profile', () => {
    for (const preset of ARCHETYPES) {
      const p = profileOf(personaFromArchetype('T', preset.id))
      expect(p.openThreshold).toBeGreaterThan(0)
      expect(p.aggression).toBeGreaterThan(0)
      expect(p.aggression).toBeLessThanOrEqual(1)
      expect(p.bluff).toBeGreaterThanOrEqual(0)
      expect(p.trials).toBeGreaterThan(0)
    }
  })
})

describe('skill shows up in how they act', () => {
  /**
   * Deal a seat a random hand into a fixed spot facing a pot-sized bet, and
   * see how often each profile continues. Tendencies are held identical, so
   * any difference is skill alone.
   */
  function continueRate(skill: Skill, deals: number, seed: number): number {
    const style = archetype('grinder')!.tendencies
    const persona: Persona = {
      ...personaFromArchetype('T', 'grinder', 't'),
      skill,
      tendencies: { ...style, straddle: 0 },
    }
    const rng = mulberry32(seed)
    let continued = 0

    for (let i = 0; i < deals; i++) {
      // Fresh stacks every deal, so 300 sets of blinds cannot drain the table.
      const seats = evenSeats(4)
      for (const s of seats) s.persona = persona
      const hand = newHand(seats, 3)
      const shoe = new Shoe(mulberry32(seed * 31 + i))
      dealHand(hand, seats, shoe)
      // Everybody called $2 pre-flop, so there is $8 in the middle; now one
      // opponent bets $4 into it and the decision is a normal half-pot call.
      hand.board = shoe.drawMany(3)
      hand.street = 'flop'
      for (const p of Object.values(hand.players)) {
        p.committedHand = 200
        p.committedRound = 0
        p.hasActed = false
        p.canRaise = true
        p.allIn = false
      }
      const bettor = hand.players[hand.order[hand.order.length - 1]]
      bettor.committedRound = 400
      bettor.committedHand = 600
      bettor.hasActed = true
      hand.currentBet = 400
      hand.lastRaiseSize = 400
      hand.phase = 'acting'
      const seat = hand.order[0]
      hand.actingSeat = seat

      const action = decideAction({ state: hand, seats, seat, rng })
      if (action.kind !== 'fold') continued++
    }
    return continued / deals
  }

  it('has the beginner continue more often than the shark in the same spot', () => {
    const rookie = continueRate(1, 300, 4242)
    const shark = continueRate(5, 300, 4242)
    expect(rookie, `rookie ${rookie}, shark ${shark}`).toBeGreaterThan(shark + 0.05)
  }, 120_000)

  it('moves steadily rather than jumping between skill levels', () => {
    const rates = ([1, 3, 5] as Skill[]).map((s) => continueRate(s, 200, 99))
    expect(rates[0]).toBeGreaterThanOrEqual(rates[1])
    expect(rates[1]).toBeGreaterThanOrEqual(rates[2])
  }, 120_000)
})

describe('the table seats the chosen personas', () => {
  it('puts the named opponents in the seats, in order', () => {
    const chosen = ['Eadie', 'Kruger', 'Nate'].map((n) => personaFromArchetype(n, 'shark'))
    const table = new Table({ opponents: chosen })
    expect(table.seats.map((s) => s.name)).toEqual(['You', 'Eadie', 'Kruger', 'Nate'])
    expect(table.seats[0].isHuman).toBe(true)
    expect(table.seats.every((s) => s.stack === BUY_IN_CHIPS)).toBe(true)
  })

  it('never seats more than eight opponents', () => {
    const table = new Table({ opponents: defaultRoster() })
    expect(table.seats).toHaveLength(9)
  })

  it('takes straddle appetite from the persona rather than one table-wide dial', () => {
    const keen = defaultRoster().slice(0, 4).map((p) => ({
      ...p, tendencies: { ...p.tendencies, straddle: 100 },
    }))
    const table = new Table({ opponents: keen, bombPotTrigger: 'off' }, 12)
    const hand = table.startHand()
    expect(hand.straddles.length).toBeGreaterThan(0)

    const shy = keen.map((p) => ({ ...p, tendencies: { ...p.tendencies, straddle: 0 } }))
    const quiet = new Table({ opponents: shy, bombPotTrigger: 'off' }, 12)
    expect(quiet.startHand().straddles).toHaveLength(0)
  })
})

describe('bet size as its own dial', () => {
  it('is separate from how often they bet', () => {
    // A calling station and a maniac can share an aggression score and be
    // nothing alike; the size is usually what people remember.
    const station = archetype('station')!.tendencies
    const maniac = archetype('maniac')!.tendencies
    expect(maniac.betSizing).toBeGreaterThan(station.betSizing)
  })

  it('turns the dial into a multiplier around one', () => {
    const at = (betSizing: number) =>
      profileOf({ ...personaFromArchetype('X', 'grinder', 'x'), tendencies: {
        ...archetype('grinder')!.tendencies, betSizing,
      } }).sizing

    expect(at(50)).toBeCloseTo(1.05, 1)
    expect(at(0)).toBeLessThan(at(50))
    expect(at(100)).toBeGreaterThan(at(50))
    // Bounded, so nobody bets a quarter of a blind or four times the pot.
    expect(at(0)).toBeGreaterThan(0.5)
    expect(at(100)).toBeLessThan(1.6)
  })

  it('fills in for a persona saved before the dial existed', () => {
    const { betSizing, ...older } = archetype('grinder')!.tendencies
    void betSizing
    const filled = { ...DEFAULT_TENDENCIES, ...older }
    // Not zero, which is what a missing value would otherwise mean.
    expect(filled.betSizing).toBe(DEFAULT_TENDENCIES.betSizing)
    expect(filled.looseness).toBe(older.looseness)
  })

  it('offers the dial in the Players tab like every other tendency', () => {
    expect(TENDENCY_META.some((m) => m.key === 'betSizing')).toBe(true)
  })
})
