/**
 * Where the hand history actually lives.
 *
 * `localStorage` holds about 5 MB, which is why the tracker used to cap itself
 * at 600 hands and throw the replays away after 150. A year of play with every
 * replay kept is roughly 10 MB — twenty times what fits — so the ninth night
 * of a season silently evicted the first, which is exactly the data you need
 * to see whether you are getting better.
 *
 * IndexedDB holds orders of magnitude more, so hands are appended one record
 * at a time and nothing is thrown away. One record per hand matters: keeping
 * the whole history as a single blob would mean rewriting every megabyte of it
 * after every hand.
 *
 * Everything here degrades. If IndexedDB is missing or blocked — private
 * browsing, a locked-down profile — the caller falls back to the old
 * `localStorage` path and the app works exactly as it did before.
 */

import type { HandRecord, PlayerTotals } from '../engine/playerStats'

const DB_NAME = 'bnotw'
const DB_VERSION = 1
const HANDS = 'hands'
const META = 'meta'
const TOTALS_KEY = 'totals'

/** How many hands to hold in memory for the UI. The rest stay on disk. */
export const RECENT_IN_MEMORY = 600

let opening: Promise<IDBDatabase | null> | null = null

/** Open the database, once. Null means IndexedDB is not usable here. */
export function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // Safari throws rather than returning null in some locked-down modes.
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDS)) {
        const store = db.createObjectStore(HANDS, { keyPath: 'key', autoIncrement: true })
        // Ordered by when the hand was played, so the newest can be read
        // without loading everything.
        store.createIndex('at', 'at')
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return opening
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** A hand as stored: the record, plus the key the store assigns it. */
interface StoredHand extends HandRecord {
  key?: number
}

/** Append one hand and update the totals, in a single transaction. */
export async function appendHand(hand: HandRecord, totals: PlayerTotals): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  try {
    const tx = db.transaction([HANDS, META], 'readwrite')
    tx.objectStore(HANDS).add({ ...hand })
    tx.objectStore(META).put(totals, TOTALS_KEY)
    await committed(tx)
    return true
  } catch {
    // Out of quota, or the store vanished. The caller keeps the in-memory copy
    // either way; losing a write is better than losing a hand mid-play.
    return false
  }
}

/** The totals, or null when nothing has been stored yet. */
export async function readTotals(): Promise<PlayerTotals | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(META, 'readonly')
    const value = await done<PlayerTotals | undefined>(tx.objectStore(META).get(TOTALS_KEY))
    return value ?? null
  } catch {
    return null
  }
}

/**
 * The newest `limit` hands, newest first.
 *
 * Read backwards through the `at` index rather than loading everything and
 * sorting: the whole history is the thing this store exists to keep, and it is
 * not something to pull into memory on every startup.
 */
export async function readRecentHands(limit = RECENT_IN_MEMORY): Promise<HandRecord[]> {
  const db = await openDb()
  if (!db) return []
  try {
    const tx = db.transaction(HANDS, 'readonly')
    const index = tx.objectStore(HANDS).index('at')
    const out: HandRecord[] = []
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(null, 'prev')
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c || out.length >= limit) { resolve(); return }
        const { key: _key, ...record } = c.value as StoredHand
        out.push(record as HandRecord)
        c.continue()
      }
      cursor.onerror = () => reject(cursor.error)
    })
    return out
  } catch {
    return []
  }
}

/** Every hand ever stored, oldest first. For export only — this can be large. */
export async function readAllHands(): Promise<HandRecord[]> {
  const db = await openDb()
  if (!db) return []
  try {
    const tx = db.transaction(HANDS, 'readonly')
    const rows = await done<StoredHand[]>(tx.objectStore(HANDS).getAll())
    return rows
      .map(({ key: _key, ...record }) => record as HandRecord)
      .sort((a, b) => a.at - b.at)
  } catch {
    return []
  }
}

export async function countHands(): Promise<number> {
  const db = await openDb()
  if (!db) return 0
  try {
    const tx = db.transaction(HANDS, 'readonly')
    return await done<number>(tx.objectStore(HANDS).count())
  } catch {
    return 0
  }
}

/** Replace everything. Used by the one-time migration and by a reset. */
export async function replaceAll(hands: HandRecord[], totals: PlayerTotals): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  try {
    const tx = db.transaction([HANDS, META], 'readwrite')
    const store = tx.objectStore(HANDS)
    store.clear()
    // Oldest first, so the store's own keys run in the same order as time.
    for (const hand of [...hands].sort((a, b) => a.at - b.at)) store.add({ ...hand })
    tx.objectStore(META).put(totals, TOTALS_KEY)
    await committed(tx)
    return true
  } catch {
    return false
  }
}
