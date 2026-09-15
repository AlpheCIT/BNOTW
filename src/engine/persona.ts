/**
 * Player personas.
 *
 * A persona is a seat at the table with a name, a face, and a way of playing.
 * How they play is split into two independent things, because in poker they
 * really are independent:
 *
 *   skill      — how *well* they play. A high-skill player reads their own
 *                equity accurately, prices calls properly and plays position.
 *                A low-skill player misjudges hands in both directions.
 *   tendencies — how they *like* to play. Loose or tight, passive or
 *                aggressive, how far they chase, how much they gamble.
 *
 * A loose-aggressive expert and a loose-aggressive donk have the same
 * tendencies and wildly different skill, which is why one of them is a problem
 * and the other is the reason the game is good.
 */

export interface Tendencies {
  /** 0 plays almost nothing · 100 plays almost anything. */
  looseness: number
  /** 0 never bets without the nuts · 100 relentless. */
  aggression: number
  /** How often they fire with nothing. */
  bluffing: number
  /** How far past the right price they will chase a draw. */
  chasing: number
  /** How willing they are to put a whole stack at risk. */
  gamble: number
  /** How often they put out a straddle. */
  straddle: number
  /**
   * How big they bet, as distinct from how often.
   *
   * Aggression already says how readily somebody fires; this says what lands
   * when they do. They are genuinely different players: the one who bets a
   * third of the pot at everything and the one who bets the pot twice a night
   * can share an aggression score and be nothing alike at the table, and the
   * bet size is usually the thing people actually remember about them.
   *
   * 50 is the ordinary line. Below it is small-ball, above it overbets.
   */
  betSizing: number
}

/** 1 is a genuine beginner, 5 is the person you do not want to play. */
export type Skill = 1 | 2 | 3 | 4 | 5

export const SKILL_LABELS: Record<Skill, string> = {
  1: 'Beginner',
  2: 'Casual',
  3: 'Solid',
  4: 'Strong',
  5: 'Shark',
}

export type ArchetypeId =
  | 'nit' | 'rock' | 'grinder' | 'shark' | 'station' | 'gambler' | 'maniac' | 'custom'

export interface Archetype {
  id: ArchetypeId
  name: string
  blurb: string
  skill: Skill
  tendencies: Tendencies
}

const t = (
  looseness: number, aggression: number, bluffing: number,
  chasing: number, gamble: number, straddle: number,
  // Defaulted so the archetypes below read as they always did; only the ones
  // whose size is part of their character say otherwise.
  betSizing = 45,
): Tendencies => ({ looseness, aggression, bluffing, chasing, gamble, straddle, betSizing })

export const ARCHETYPES: Archetype[] = [
  {
    id: 'nit', name: 'The Nit', skill: 3,
    blurb: 'Folds and folds and folds, then shows you aces.',
    tendencies: t(12, 30, 3, 15, 15, 0, 40),
  },
  {
    id: 'rock', name: 'The Rock', skill: 3,
    blurb: 'Tight, but bets hard on the rare occasion they are in.',
    tendencies: t(22, 55, 8, 25, 35, 5, 55),
  },
  {
    id: 'grinder', name: 'The Grinder', skill: 4,
    blurb: 'Patient, positional, quietly takes your money.',
    tendencies: t(35, 65, 18, 35, 45, 12, 45),
  },
  {
    id: 'shark', name: 'The Shark', skill: 5,
    blurb: 'Reads the board, prices everything, punishes mistakes.',
    tendencies: t(42, 78, 28, 38, 60, 22, 50),
  },
  {
    id: 'station', name: 'Calling Station', skill: 2,
    blurb: 'Will pay you off. Every single time. Please keep betting.',
    tendencies: t(65, 22, 6, 88, 45, 8, 35),
  },
  {
    id: 'gambler', name: 'The Gambler', skill: 2,
    blurb: 'Here for a good time. Any two cards can win.',
    tendencies: t(72, 68, 35, 70, 85, 40, 70),
  },
  {
    id: 'maniac', name: 'The Maniac', skill: 2,
    blurb: 'Raises. Raises again. Never folding, never explaining.',
    tendencies: t(85, 92, 55, 60, 92, 55, 85),
  },
]

export function archetype(id: ArchetypeId): Archetype | undefined {
  return ARCHETYPES.find((a) => a.id === id)
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

/**
 * A face is described by indices into fixed palettes so it costs nothing to
 * store and renders identically everywhere. A persona can use a photo instead.
 */
export interface AvatarSpec {
  bg: number
  skin: number
  hair: number
  hairColor: number
  facial: number
  accessory: number
  /** A square data URL. When set it is drawn instead of the generated face. */
  photo?: string
}

export const AVATAR_BG = ['#2f6f4e', '#2b5d7a', '#6d3f6b', '#7a4a2a', '#4a4f78', '#7a2f3a', '#3f6b6b', '#6b6330']
export const AVATAR_SKIN = ['#f0c9a6', '#e0ab82', '#c98d62', '#a9683f', '#7d4a2b', '#5a341e']
export const AVATAR_HAIR_COLOR = ['#1c1712', '#3b2a1c', '#6b4a2a', '#a8792f', '#c9a227', '#8d8d8d', '#e2e2e2', '#8c3b2a']

export const HAIR_STYLES = ['Bald', 'Buzz', 'Short', 'Side part', 'Waves', 'Curls', 'Long', 'Top knot']
export const FACIAL_STYLES = ['Clean', 'Moustache', 'Goatee', 'Full beard', 'Stubble']
export const ACCESSORIES = ['None', 'Glasses', 'Shades', 'Ball cap', 'Visor', 'Headphones']

/** A stable pseudo-random face derived from a string, so a name always looks the same. */
export function faceFor(seed: string): AvatarSpec {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const pick = (n: number, salt: number) => Math.abs((h >> (salt % 24)) ^ (h * (salt + 3))) % n
  return {
    bg: pick(AVATAR_BG.length, 1),
    skin: pick(AVATAR_SKIN.length, 5),
    hair: pick(HAIR_STYLES.length, 9),
    hairColor: pick(AVATAR_HAIR_COLOR.length, 13),
    facial: pick(FACIAL_STYLES.length, 17),
    accessory: pick(ACCESSORIES.length, 21),
  }
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export interface Persona {
  id: string
  name: string
  avatar: AvatarSpec
  archetype: ArchetypeId
  skill: Skill
  tendencies: Tendencies
  /** Free-text note — a read, a catchphrase, whatever is useful. */
  note: string
}

/**
 * The BNOTW regulars.
 *
 * The archetypes and skill levels below are arbitrary starting points — they
 * are not a read on how anybody actually plays. Edit them in the Players tab.
 */
const ROSTER: [string, ArchetypeId][] = [
  ['Bob', 'rock'],
  ['Brett', 'grinder'],
  ['Ransom', 'gambler'],
  ['Dave', 'maniac'],
  ['Don', 'nit'],
  ['Hal', 'station'],
  ['Ian', 'grinder'],
  ['Eadie', 'shark'],
  ['Mark', 'rock'],
  ['Rosen', 'gambler'],
  ['Carter', 'station'],
  ['Nate', 'grinder'],
  ['Kruger', 'maniac'],
  ['Richie', 'shark'],
]

export function personaFromArchetype(name: string, id: ArchetypeId, personaId?: string): Persona {
  const preset = archetype(id) ?? ARCHETYPES[2]
  return {
    id: personaId ?? `p-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    name,
    avatar: faceFor(name),
    archetype: id,
    skill: preset.skill,
    tendencies: { ...preset.tendencies },
    note: '',
  }
}

export function defaultRoster(): Persona[] {
  return ROSTER.map(([name, id]) => personaFromArchetype(name, id))
}

/** Which preset a persona's numbers currently match, if any. */
export function matchArchetype(persona: Persona): ArchetypeId {
  const found = ARCHETYPES.find(
    (a) =>
      a.skill === persona.skill &&
      (Object.keys(a.tendencies) as (keyof Tendencies)[])
        .every((k) => a.tendencies[k] === persona.tendencies[k]),
  )
  return found?.id ?? 'custom'
}

/** A one-line summary of how a persona plays, for the roster card. */
export function styleSummary(t: Tendencies): string {
  const loose = t.looseness >= 60 ? 'Loose' : t.looseness >= 35 ? 'Balanced' : 'Tight'
  const aggro = t.aggression >= 60 ? 'aggressive' : t.aggression >= 35 ? 'measured' : 'passive'
  return `${loose}–${aggro}`
}

/**
 * What a tendency is worth when nothing says otherwise.
 *
 * Used to fill in dials that a stored persona predates: a missing value would
 * otherwise read as zero, which is not "unset" but "the most extreme setting
 * at one end".
 */
export const DEFAULT_TENDENCIES: Tendencies = {
  looseness: 40, aggression: 50, bluffing: 15, chasing: 40, gamble: 40,
  straddle: 10, betSizing: 45,
}

export const TENDENCY_META: { key: keyof Tendencies; label: string; low: string; high: string }[] = [
  { key: 'looseness', label: 'Looseness', low: 'Plays few hands', high: 'Plays anything' },
  { key: 'aggression', label: 'Aggression', low: 'Checks and calls', high: 'Bets and raises' },
  { key: 'bluffing', label: 'Bluffing', low: 'Only bets real hands', high: 'Fires with nothing' },
  { key: 'chasing', label: 'Chasing', low: 'Respects the price', high: 'Chases every draw' },
  { key: 'gamble', label: 'Gamble', low: 'Protects the stack', high: 'Happy to get it in' },
  { key: 'straddle', label: 'Straddle', low: 'Never straddles', high: 'Straddles constantly' },
  { key: 'betSizing', label: 'Bet size', low: 'Small ball', high: 'Overbets' },
]
