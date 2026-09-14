/**
 * Persistence for the Record Book.
 *
 * Everything lives in this browser's localStorage, so the book survives
 * reloads but never leaves the device. Export to JSON to move it or back it up.
 */

import type { GameNight } from './records'
import { sortNights } from './records'

const STORAGE_KEY = 'bnotw.recordbook.v1'
const SETTINGS_KEY = 'bnotw.settings.v1'

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
