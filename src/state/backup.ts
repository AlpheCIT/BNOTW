/**
 * Getting a copy of everything off the device, with as little ceremony as
 * possible.
 *
 * There is already an export button, but it only helps someone who remembers
 * to press it — and the person most likely to lose the data is the person who
 * did not. So this does three things: makes saving a copy one tap on a phone,
 * asks the browser not to throw the data away, and keeps track of how long it
 * has been so the app can say something rather than waiting to be asked.
 *
 * Worth being straight about the limit: none of this survives losing the
 * device. That needs somewhere off it to put the copy, which needs a server.
 */

import { downloadText } from './export'

const LAST_BACKUP_KEY = 'bnotw.lastbackup.v1'

/** Nights between nudges. A season is weekly, so this is about a month. */
export const NUDGE_AFTER_NIGHTS = 4

export function lastBackupAt(): number | null {
  if (typeof localStorage === 'undefined') return null
  const raw = Number(localStorage.getItem(LAST_BACKUP_KEY))
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

export function noteBackup(at = Date.now()): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(at))
  } catch {
    // Nothing worth failing a backup over.
  }
}

/**
 * Whether to mention backing up.
 *
 * Counted in nights recorded rather than days elapsed, because the thing worth
 * protecting is nights: an app left alone for a month has lost nothing, and
 * one played hard for a week has plenty to lose.
 */
export function backupIsOverdue(nights: { date: string }[], lastAt = lastBackupAt()): boolean {
  if (nights.length === 0) return false
  if (lastAt === null) return nights.length >= NUDGE_AFTER_NIGHTS
  const since = nights.filter((n) => new Date(n.date).getTime() > lastAt).length
  return since >= NUDGE_AFTER_NIGHTS
}

/**
 * Hand the file to whatever the device does with files.
 *
 * On a phone the share sheet reaches Files, iCloud Drive, Mail and everything
 * else in one tap, which is the difference between a backup that happens and
 * one that does not. Where sharing a file is unsupported — most desktops —
 * this falls back to a download, which is the same thing with more steps.
 *
 * Returns how it went so the caller can say something true about it: `shared`
 * when the sheet accepted it, `downloaded` when it fell back, `cancelled` when
 * the sheet was dismissed.
 */
export async function shareBackup(
  filename: string,
  json: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const file = typeof File === 'undefined'
    ? null
    : new File([json], filename, { type: 'application/json' })

  if (file && nav?.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: 'BNOTW backup' })
      noteBackup()
      return 'shared'
    } catch (error) {
      // Dismissing the sheet rejects. That is a choice, not a failure, and
      // quietly downloading instead would be the opposite of what was asked.
      if ((error as Error)?.name === 'AbortError') return 'cancelled'
      // Anything else: fall through and download.
    }
  }

  downloadText(filename, json, 'application/json')
  noteBackup()
  return 'downloaded'
}

/**
 * Ask the browser to keep this origin's storage rather than evicting it under
 * pressure.
 *
 * Best-effort and nothing more: support varies, the answer can be no, and a
 * yes is not a promise. Never tell anyone their data is safe because of this.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
