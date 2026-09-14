/**
 * Persistence for the Record Book.
 *
 * Everything lives in this browser's localStorage, so the book survives
 * reloads but never leaves the device. Export to JSON to move it or back it up.
 */

import { defaultRoster, type Persona } from '../engine/persona'
import { emptyTotals, type HandRecord, type PlayerTotals } from '../engine/playerStats'
import type { GameNight } from './records'
import { sortNights } from './records'

const STORAGE_KEY = 'bnotw.recordbook.v1'
const SETTINGS_KEY = 'bnotw.settings.v1'
const ROSTER_KEY = 'bnotw.roster.v1'
const PLAYER_KEY = 'bnotw.player.v1'
const COACH_KEY_KEY = 'bnotw.coachkey.v1'
const COACH_KEY = 'bnotw.coach.v1'

export interface RecordBook {
  version: 1
  nights: GameNight[]
}

const EMPTY: RecordBook = { version: 1, nights: [] }

function safeParse(raw: string | null): RecordBook {
  if (!raw) return EMPTY
  try {
    const data = JSON.parse(raw) as RecordBook
    if (!data || !Array.isArray(data.nights)) return EMPTY
    return { version: 1, nights: data.nights }
  } catch {
    return EMPTY
  }
}

export function loadBook(): RecordBook {
  if (typeof localStorage === 'undefined') return EMPTY
  try {
    return safeParse(localStorage.getItem(STORAGE_KEY))
  } catch {
    return EMPTY
  }
}

export function saveBook(book: RecordBook): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book))
  } catch {
    // Private browsing or a full quota: the session still works, it just
    // will not be remembered.
  }
}

export function loadSettings<T>(fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

export function saveSettings<T>(settings: T): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Ignore; settings are a convenience, not data worth failing over.
  }
}

/** Merge imported nights into the book, replacing any night with the same id. */
export function mergeNights(book: RecordBook, incoming: GameNight[]): RecordBook {
  const byId = new Map(book.nights.map((n) => [n.id, n]))
  for (const night of incoming) byId.set(night.id, night)
  return { version: 1, nights: sortNights([...byId.values()]) }
}

export function parseImport(text: string): GameNight[] {
  const data = JSON.parse(text) as RecordBook | GameNight[]
  const nights = Array.isArray(data) ? data : data.nights
  if (!Array.isArray(nights)) throw new Error('That file does not look like a BNOTW record book.')
  for (const night of nights) {
    if (!night || typeof night.id !== 'string' || !Array.isArray(night.players)) {
      throw new Error('That file has a night in it that BNOTW cannot read.')
    }
  }
  return nights
}

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

export interface RosterState {
  version: 1
  players: Persona[]
  /** Persona ids currently sitting down as opponents, in seat order. */
  seated: string[]
}

export function defaultRosterState(): RosterState {
  const players = defaultRoster()
  return { version: 1, players, seated: players.slice(0, 5).map((p) => p.id) }
}

export function loadRoster(): RosterState {
  if (typeof localStorage === 'undefined') return defaultRosterState()
  try {
    const raw = localStorage.getItem(ROSTER_KEY)
    if (!raw) return defaultRosterState()
    const data = JSON.parse(raw) as RosterState
    if (!data || !Array.isArray(data.players) || data.players.length === 0) {
      return defaultRosterState()
    }
    const ids = new Set(data.players.map((p) => p.id))
    return {
      version: 1,
      players: data.players,
      seated: (data.seated ?? []).filter((id) => ids.has(id)),
    }
  } catch {
    return defaultRosterState()
  }
}

export function saveRoster(roster: RosterState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster))
  } catch {
    // Quota is the likely cause — a photo avatar is far larger than a drawn
    // one. The session keeps working, it just will not be remembered.
  }
}

// ---------------------------------------------------------------------------
// Coach mode statistics
// ---------------------------------------------------------------------------

export interface CoachStats {
  version: 1
  handsPlayed: number
  decisions: number
  /** Decisions that matched the coach's recommendation. */
  agreed: number
  /** Cents of expected value given up against the recommendation. */
  evLost: number
  /** Counts of the common ways a decision went wrong. */
  leaks: Record<string, number>
  /** Sessions started in coach mode. */
  sessions: number
}

export function emptyCoachStats(): CoachStats {
  return { version: 1, handsPlayed: 0, decisions: 0, agreed: 0, evLost: 0, leaks: {}, sessions: 0 }
}

export function loadCoachStats(): CoachStats {
  if (typeof localStorage === 'undefined') return emptyCoachStats()
  try {
    const raw = localStorage.getItem(COACH_KEY)
    if (!raw) return emptyCoachStats()
    return { ...emptyCoachStats(), ...(JSON.parse(raw) as CoachStats) }
  } catch {
    return emptyCoachStats()
  }
}

export function saveCoachStats(stats: CoachStats): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify(stats))
  } catch {
    // Ignore; coach stats are a convenience, not data worth failing over.
  }
}

// ---------------------------------------------------------------------------
// Your own game
// ---------------------------------------------------------------------------

export interface PlayerLog {
  version: 1
  totals: PlayerTotals
  /** Most recent first, capped. The totals above are never truncated. */
  hands: HandRecord[]
}

export function loadPlayerLog(): PlayerLog {
  const empty: PlayerLog = { version: 1, totals: emptyTotals(), hands: [] }
  if (typeof localStorage === 'undefined') return empty
  try {
    const raw = localStorage.getItem(PLAYER_KEY)
    if (!raw) return empty
    const data = JSON.parse(raw) as PlayerLog
    if (!data?.totals) return empty
    return {
      version: 1,
      totals: { ...emptyTotals(), ...data.totals },
      hands: Array.isArray(data.hands) ? data.hands : [],
    }
  } catch {
    return empty
  }
}

/**
 * Out of quota, give up the most expensive thing first: replays, then the hand
 * list, then everything but the totals — which are the only part that cannot
 * be rebuilt by playing more.
 */
export function savePlayerLog(log: PlayerLog): void {
  if (typeof localStorage === 'undefined') return
  const attempts: PlayerLog[] = [
    log,
    { ...log, hands: log.hands.map((h) => ({ ...h, replay: undefined })) },
    { ...log, hands: log.hands.slice(0, 50).map((h) => ({ ...h, replay: undefined })) },
    { ...log, hands: [] },
  ]
  for (const attempt of attempts) {
    try {
      localStorage.setItem(PLAYER_KEY, JSON.stringify(attempt))
      return
    } catch {
      // Try the next, smaller shape.
    }
  }
}

// ---------------------------------------------------------------------------
// The coach API key
// ---------------------------------------------------------------------------

/**
 * Stored on its own rather than inside the settings blob, so it can never ride
 * along in a Record Book export or a settings backup by accident.
 */
export function loadCoachKey(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(COACH_KEY_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveCoachKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (key) localStorage.setItem(COACH_KEY_KEY, key)
    else localStorage.removeItem(COACH_KEY_KEY)
  } catch {
    // Private browsing: the key simply will not be remembered.
  }
}
