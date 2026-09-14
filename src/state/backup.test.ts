import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NUDGE_AFTER_NIGHTS, backupIsOverdue, lastBackupAt, noteBackup } from './backup'

function nights(count: number, from = Date.UTC(2026, 0, 1)) {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(from + i * 7 * 86400000).toISOString(),
  }))
}

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
})
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

describe('deciding when to mention a backup', () => {
  it('says nothing with no nights on record', () => {
    expect(backupIsOverdue([])).toBe(false)
  })

  it('says nothing until a few nights have built up', () => {
    expect(backupIsOverdue(nights(NUDGE_AFTER_NIGHTS - 1))).toBe(false)
    expect(backupIsOverdue(nights(NUDGE_AFTER_NIGHTS))).toBe(true)
  })

  it('counts only the nights since the last copy', () => {
    const all = nights(10)
    // Copied after the sixth night.
    const at = new Date(all[5].date).getTime() + 1000
    noteBackup(at)

    // Four nights since, which is the threshold.
    expect(backupIsOverdue(all, at)).toBe(true)
    expect(backupIsOverdue(all.slice(0, 8), at)).toBe(false)
  })

  it('counts nights rather than days, so an untouched app is left alone', () => {
    // Three nights, years ago, never backed up. Nothing has been at risk since.
    const old = nights(3, Date.UTC(2020, 0, 1))
    expect(backupIsOverdue(old)).toBe(false)
  })

  it('remembers when a copy was taken', () => {
    expect(lastBackupAt()).toBe(null)
    noteBackup(1700000000000)
    expect(lastBackupAt()).toBe(1700000000000)
  })

  it('shrugs off a corrupted timestamp', () => {
    store.set('bnotw.lastbackup.v1', 'not a number')
    expect(lastBackupAt()).toBe(null)
    // And falls back to counting from the beginning.
    expect(backupIsOverdue(nights(NUDGE_AFTER_NIGHTS))).toBe(true)
  })

  it('does not throw where storage is unavailable', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(lastBackupAt()).toBe(null)
    expect(() => noteBackup()).not.toThrow()
  })
})

describe('asking the browser to keep the data', () => {
  /**
   * `navigator` is a getter on globalThis in Node, so it cannot be assigned.
   * Redefining the property is the only way to stand in for it.
   */
  function withNavigator(stub: unknown, run: () => Promise<void>) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: stub, configurable: true })
    return run().finally(() => {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else delete (globalThis as { navigator?: unknown }).navigator
    })
  }

  it('reports no rather than throwing where it is unsupported', async () => {
    const { requestPersistentStorage } = await import('./backup')

    await withNavigator({}, async () => {
      expect(await requestPersistentStorage()).toBe(false)
    })
    await withNavigator({ storage: { persist: () => { throw new Error('denied') } } }, async () => {
      expect(await requestPersistentStorage()).toBe(false)
    })
  })

  it('takes no for an answer', async () => {
    const { requestPersistentStorage } = await import('./backup')
    await withNavigator({ storage: { persisted: async () => false, persist: async () => false } }, async () => {
      expect(await requestPersistentStorage()).toBe(false)
    })
  })

  it('does not ask again once already granted', async () => {
    const { requestPersistentStorage } = await import('./backup')
    const persist = vi.fn(async () => true)
    await withNavigator({ storage: { persisted: async () => true, persist } }, async () => {
      expect(await requestPersistentStorage()).toBe(true)
      expect(persist).not.toHaveBeenCalled()
    })
  })
})
