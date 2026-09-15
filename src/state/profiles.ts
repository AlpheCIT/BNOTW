/**
 * Who is playing.
 *
 * The crew share devices. Somebody hands their iPad over, Dave plays four
 * hands to see what it is, and those four hands are now in the owner's record,
 * moving their VPIP and their rating exactly as hard as hands they meant. That
 * is the same problem the hand-deletion work was asked for — this is the
 * version that prevents it rather than cleaning up after it.
 *
 * ### What this is not
 *
 * Not accounts. No password, no login, no server, nothing leaves the device.
 * A profile is a name and a colour that scopes some storage keys, and anybody
 * holding the device can pick any of them. That is the correct amount of
 * security for a six-person home game and any more would be a thing to
 * maintain forever in exchange for nothing.
 *
 * ### Guest
 *
 * The guest is not stored and never persists. It exists so that "let me show
 * you" has somewhere to go that does not end in somebody deleting hands out of
 * their history afterwards.
 *
 * ### The default profile is special on purpose
 *
 * Its records live under the *unscoped* storage keys — `bnotw.player.v1` and
 * the rest, exactly where they already are. So the person who has been playing
 * this app since before profiles existed keeps every hand without a migration
 * running over their history. New profiles get suffixed keys.
 */

import { allLayers, STARTING_LAYERS, type LayerId } from '../engine/layers'

const PROFILES_KEY = 'bnotw.profiles.v1'
const ACTIVE_KEY = 'bnotw.activeprofile.v1'

/** The profile that owns everything recorded before profiles existed. */
export const DEFAULT_PROFILE_ID = 'default'

/** Not a profile: a session that is never written down. */
export const GUEST_ID = 'guest'

export type Experience = 'new' | 'casual' | 'regular' | 'serious'

export interface ExperienceMeta {
  id: Experience
  label: string
  blurb: string
  /** Which coaching layers this experience starts with. */
  layers: LayerId[]
}

/**
 * Experience is not a difficulty setting and does not touch the bots.
 *
 * All it does is choose how much of the coach is on at the start, which is a
 * decision somebody new should not have to discover through a settings dialog.
 * Every one of them can change it afterwards and the app never revisits it.
 */
export const EXPERIENCE: ExperienceMeta[] = [
  {
    id: 'new',
    label: 'New to poker',
    blurb: 'Start with one question at a time: is the price right?',
    layers: [...STARTING_LAYERS],
  },
  {
    id: 'casual',
    label: 'I play sometimes',
    blurb: 'The price and the hand. Equity, outs and what you have made.',
    layers: ['price', 'hand'],
  },
  {
    id: 'regular',
    label: 'I play most weeks',
    blurb: 'Adds who you are up against and what they have been doing.',
    layers: ['price', 'hand', 'player'],
  },
  {
    id: 'serious',
    label: 'Show me everything',
    blurb: 'The whole panel from the first hand.',
    layers: allLayers(),
  },
]

export function experienceMeta(id: Experience): ExperienceMeta {
  return EXPERIENCE.find((e) => e.id === id) ?? EXPERIENCE[1]
}

/** Chip colours, distinct enough to tell apart across a table at a glance. */
export const PROFILE_COLOURS = [
  '#d9a441', '#5fd08a', '#6fd3e8', '#c96be0', '#ff8c42', '#e8736f', '#9aa8ff', '#7bd3a0',
]

export interface LocalProfile {
  id: string
  name: string
  /** What the table calls them, if that is different. */
  nickname: string
  /** Up to three characters on the chip. Derived from the name when blank. */
  initials: string
  colour: string
  experience: Experience
  /** Which tab this player lands on. */
  opensOn: 'table' | 'coach' | 'drill'
  createdAt: number
  lastPlayedAt: number
}

/** The letters on the chip: what was typed, or the name's own initials. */
export function initialsFor(profile: { name: string; initials?: string }): string {
  const typed = profile.initials?.trim()
  if (typed) return typed.slice(0, 3).toUpperCase()
  const words = profile.name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** What the table calls them: the nickname if there is one, else the name. */
export function displayName(profile: LocalProfile): string {
  return profile.nickname.trim() || profile.name.trim() || 'Player'
}

export function makeProfile(
  partial: Partial<LocalProfile> & { name: string },
  existing: readonly LocalProfile[] = [],
): LocalProfile {
  const now = Date.now()
  const taken = new Set(existing.map((p) => p.colour))
  const colour = PROFILE_COLOURS.find((c) => !taken.has(c)) ?? PROFILE_COLOURS[existing.length % PROFILE_COLOURS.length]
  return {
    id: partial.id ?? `p${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: partial.name,
    nickname: partial.nickname ?? '',
    initials: partial.initials ?? '',
    colour: partial.colour ?? colour,
    experience: partial.experience ?? 'casual',
    opensOn: partial.opensOn ?? 'table',
    createdAt: partial.createdAt ?? now,
    lastPlayedAt: partial.lastPlayedAt ?? now,
  }
}

/** The guest, built fresh every time so nothing about them can persist. */
export function guestProfile(): LocalProfile {
  return {
    id: GUEST_ID,
    name: 'Guest',
    nickname: '',
    initials: 'G',
    colour: '#8a9a92',
    experience: 'casual',
    opensOn: 'table',
    createdAt: 0,
    lastPlayedAt: 0,
  }
}

export function isGuest(profile: LocalProfile | null): boolean {
  return profile?.id === GUEST_ID
}

/** The same question, when all you have is the id. */
export function isGuestId(profileId: string): boolean {
  return profileId === GUEST_ID
}

/**
 * Where a profile's records live.
 *
 * The default profile uses the bare key, which is what keeps the existing
 * player's history exactly where it already is. A guest is given no key at all
 * — the caller must not write — and asking for one is a bug worth failing on
 * rather than quietly writing a guest's hands to disk.
 */
export function scopedKey(base: string, profileId: string): string {
  if (profileId === GUEST_ID) {
    throw new Error('A guest has no storage. Check isGuest before writing.')
  }
  return profileId === DEFAULT_PROFILE_ID ? base : `${base}:${profileId}`
}

function sane(value: unknown): LocalProfile | null {
  const p = value as Partial<LocalProfile>
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return null
  if (p.id === GUEST_ID) return null
  return makeProfile({ ...p, name: p.name, id: p.id })
}

export function loadProfiles(): LocalProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.map(sane).filter((p): p is LocalProfile => p !== null)
  } catch {
    return []
  }
}

export function saveProfiles(profiles: readonly LocalProfile[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
  } catch {
    // Quota. The session keeps working; the list just will not be remembered.
  }
}

/** Who was playing last, or null for nobody yet and for a guest. */
export function loadActiveProfile(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(ACTIVE_KEY) || null
  } catch {
    return null
  }
}

export function saveActiveProfile(id: string | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    // A guest is never remembered: the next open should ask again rather than
    // drop whoever picks the device up into somebody else's throwaway session.
    if (!id || id === GUEST_ID) localStorage.removeItem(ACTIVE_KEY)
    else localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // Nothing to do. Worst case the picker asks again next time.
  }
}

/**
 * Whether there is already a history sitting under the unscoped keys.
 *
 * True means somebody has been playing this app since before profiles, and
 * their hands belong to the default profile rather than to nobody.
 */
export function hasLegacyHistory(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem('bnotw.player.v1') !== null
  } catch {
    return false
  }
}

/**
 * Erase everything one profile owns.
 *
 * Both halves matter. Their hands live in IndexedDB and their preferences in
 * `localStorage`, and a delete that took only the name would leave a history
 * with no owner — which the next person to use that id would silently
 * inherit.
 *
 * The default profile is refused. Its records live under the unscoped keys,
 * shared with every version of this app that predates profiles, so deleting
 * "it" would mean erasing the device's whole history under the impression you
 * were removing one player from a list.
 */
export async function forgetProfile(profileId: string): Promise<void> {
  if (profileId === DEFAULT_PROFILE_ID || profileId === GUEST_ID) return

  if (typeof localStorage !== 'undefined') {
    for (const base of [
      'bnotw.player.v1', 'bnotw.drill.v1', 'bnotw.coach.v1', 'bnotw.layers.v1',
    ]) {
      try {
        localStorage.removeItem(scopedKey(base, profileId))
      } catch {
        // Nothing to do; the key simply stays.
      }
    }
  }

  // Imported here rather than at the top: `db` reaches for IndexedDB, and this
  // module is read by code paths that must work without it.
  const { replaceAll } = await import('./db')
  const { emptyTotals } = await import('../engine/playerStats')
  await replaceAll([], emptyTotals(), profileId)
}
