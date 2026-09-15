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
import { DEFAULT_PROFILE_ID } from './profiles'

const DB_NAME = 'bnotw'
/**
 * Schema version 2 added profiles.
 *
 * Version 1 kept one history for the whole device, so everything already
 * stored belongs to whoever has been using it — the default profile. The
 * upgrade stamps every existing hand with that id and moves the totals under
 * it, inside the same versionchange transaction, so a half-applied upgrade is
 * not a state the database can be left in.
 */
const DB_VERSION = 2
const HANDS = 'hands'
const META = 'meta'
const TOTALS_KEY = 'totals'
const PROFILE_INDEX = 'profile'

/** Where one profile's totals live. */
function totalsKey(profileId: string): string {
  return profileId === DEFAULT_PROFILE_ID ? TOTALS_KEY : `${TOTALS_KEY}:${profileId}`
}

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

    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction
      const from = (event as IDBVersionChangeEvent).oldVersion

      if (!db.objectStoreNames.contains(HANDS)) {
        const store = db.createObjectStore(HANDS, { keyPath: 'key', autoIncrement: true })
        // Ordered by when the hand was played, so the newest can be read
        // without loading everything.
        store.createIndex('at', 'at')
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)

      const hands = tx?.objectStore(HANDS)
      if (hands && !hands.indexNames.contains(PROFILE_INDEX)) {
        // Compound, so one profile's hands can be walked in play order without
        // reading anybody else's.
        hands.createIndex(PROFILE_INDEX, ['profileId', 'at'])
      }

      // Everything stored before profiles existed belongs to whoever has been
      // playing. Left unstamped it would belong to nobody and vanish from the
      // one history that is actually theirs.
      if (from >= 1 && from < 2 && hands) {
        const cursor = hands.openCursor()
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) return
          const row = c.value as StoredHand
          if (!row.profileId) {
            row.profileId = DEFAULT_PROFILE_ID
            c.update(row)
          }
          c.continue()
        }
      }
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

/** A hand as stored: the record, the profile it belongs to, and its key. */
interface StoredHand extends HandRecord {
  key?: number
  profileId?: string
}

/**
 * Range covering exactly one profile's hands in the compound index.
 *
 * `-Infinity` to `Infinity` on the second component, because `at` is a
 * millisecond timestamp and an open-ended bound would run into the next
 * profile's rows.
 */
function profileRange(profileId: string): IDBKeyRange {
  return IDBKeyRange.bound([profileId, -Infinity], [profileId, Infinity])
}

/** Append one hand and update the totals, in a single transaction. */
export async function appendHand(
  hand: HandRecord,
  totals: PlayerTotals,
  profileId: string,
): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  try {
    const tx = db.transaction([HANDS, META], 'readwrite')
    tx.objectStore(HANDS).add({ ...hand, profileId })
    tx.objectStore(META).put(totals, totalsKey(profileId))
    await committed(tx)
    return true
  } catch {
    // Out of quota, or the store vanished. The caller keeps the in-memory copy
    // either way; losing a write is better than losing a hand mid-play.
    return false
  }
}

/** The totals for one profile, or null when nothing has been stored yet. */
export async function readTotals(profileId: string): Promise<PlayerTotals | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(META, 'readonly')
    const value = await done<PlayerTotals | undefined>(
      tx.objectStore(META).get(totalsKey(profileId)),
    )
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
export async function readRecentHands(
  profileId: string,
  limit = RECENT_IN_MEMORY,
): Promise<HandRecord[]> {
  const db = await openDb()
  if (!db) return []
  try {
    const tx = db.transaction(HANDS, 'readonly')
    const index = tx.objectStore(HANDS).index(PROFILE_INDEX)
    const out: HandRecord[] = []
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(profileRange(profileId), 'prev')
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c || out.length >= limit) { resolve(); return }
        const { key: _key, profileId: _p, ...record } = c.value as StoredHand
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
export async function readAllHands(profileId: string): Promise<HandRecord[]> {
  const db = await openDb()
  if (!db) return []
  try {
    const tx = db.transaction(HANDS, 'readonly')
    const rows = await done<StoredHand[]>(
      tx.objectStore(HANDS).index(PROFILE_INDEX).getAll(profileRange(profileId)),
    )
    return rows
      .map(({ key: _key, profileId: _p, ...record }) => record as HandRecord)
      .sort((a, b) => a.at - b.at)
  } catch {
    return []
  }
}

/**
 * Attach or change a note on a stored hand, found by when it was played.
 *
 * Returns false when the hand is not in the store — which can happen for a
 * hand still only in memory, or one from a browser where IndexedDB is not
 * available.
 */
export async function setNote(at: number, note: string, profileId: string): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  try {
    const tx = db.transaction(HANDS, 'readwrite')
    const store = tx.objectStore(HANDS)
    const index = store.index(PROFILE_INDEX)
    const row = await done<StoredHand | undefined>(index.get([profileId, at]))
    if (!row) return false
    const trimmed = note.trim()
    if (trimmed) row.note = trimmed
    else delete row.note
    store.put(row)
    await committed(tx)
    return true
  } catch {
    return false
  }
}

/**
 * Remove specific hands, found by when they were played, and write the
 * totals the caller has already adjusted.
 *
 * Both in one transaction: a delete that landed without its totals would leave
 * the record claiming hands it no longer holds, and the next read would show
 * a VPIP computed over a denominator that no longer exists.
 *
 * `at` is a millisecond timestamp from a real hand, so collisions are not a
 * practical concern, but the cursor deletes every row it matches rather than
 * the first — a duplicated record should not survive being deleted.
 *
 * Returns how many rows went, or null when the store could not be used at all.
 */
export async function deleteHands(
  ats: number[],
  totals: PlayerTotals,
  profileId: string,
): Promise<number | null> {
  const db = await openDb()
  if (!db) return null
  if (ats.length === 0) return 0
  try {
    const wanted = new Set(ats)
    const tx = db.transaction([HANDS, META], 'readwrite')
    const index = tx.objectStore(HANDS).index(PROFILE_INDEX)
    let removed = 0
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(profileRange(profileId))
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) { resolve(); return }
        if (wanted.has((c.value as StoredHand).at)) {
          c.delete()
          removed += 1
        }
        c.continue()
      }
      cursor.onerror = () => reject(cursor.error)
    })
    tx.objectStore(META).put(totals, totalsKey(profileId))
    await committed(tx)
    return removed
  } catch {
    return null
  }
}

export async function countHands(profileId: string): Promise<number> {
  const db = await openDb()
  if (!db) return 0
  try {
    const tx = db.transaction(HANDS, 'readonly')
    return await done<number>(
      tx.objectStore(HANDS).index(PROFILE_INDEX).count(profileRange(profileId)),
    )
  } catch {
    return 0
  }
}

/**
 * Replace one profile's history. Used by the localStorage migration and by a
 * reset.
 *
 * Only this profile's rows are cleared — a reset by one player must not take
 * everyone else's hands with it, which is the whole point of scoping them.
 */
export async function replaceAll(
  hands: HandRecord[],
  totals: PlayerTotals,
  profileId: string,
): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  try {
    const tx = db.transaction([HANDS, META], 'readwrite')
    const store = tx.objectStore(HANDS)
    await new Promise<void>((resolve, reject) => {
      const cursor = store.index(PROFILE_INDEX).openCursor(profileRange(profileId))
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) { resolve(); return }
        c.delete()
        c.continue()
      }
      cursor.onerror = () => reject(cursor.error)
    })
    // Oldest first, so the store's own keys run in the same order as time.
    for (const hand of [...hands].sort((a, b) => a.at - b.at)) {
      store.add({ ...hand, profileId })
    }
    tx.objectStore(META).put(totals, totalsKey(profileId))
    await committed(tx)
    return true
  } catch {
    return false
  }
}
