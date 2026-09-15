/**
 * Everything this app stores, in one list.
 *
 * Written because deleting a player had a hand-typed list of keys in it. Add a
 * per-player key, forget to update that list, and removing somebody leaves
 * their records behind for whoever reuses the id — a bug that produces no
 * error, no failing test and no symptom until somebody else's hands turn up in
 * a new player's history. The list is now derived from here, and a test checks
 * that every key the app defines appears in it.
 *
 * ### Device or player
 *
 * The distinction is not "personal versus shared", it is **whose record is it
 * a record of**:
 *
 *   `player` — a record *of somebody's play*. Their hands, their practice,
 *     their rating, the table they were sitting at. Two people using one iPad
 *     must not be able to see or affect each other's, and deleting one must
 *     take all of it.
 *
 *   `device` — a fact about this table rather than about a person. The Record
 *     Book is the crew's money. The roster is the crew's bots. The hand names
 *     are the crew's vocabulary. Scoping those per player would mean Dave
 *     opening the app and finding nobody owes anybody anything.
 */

export type KeyScope = 'device' | 'player'

export interface StoredThing {
  /** The `localStorage` key, unsuffixed. */
  key: string
  scope: KeyScope
  /** What it holds, and why it is scoped the way it is. */
  what: string
}

export const STORED: StoredThing[] = [
  {
    key: 'bnotw.player.v1',
    scope: 'player',
    what: 'Your tracked hands and totals — the localStorage fallback for when IndexedDB cannot be opened.',
  },
  {
    key: 'bnotw.drill.v1',
    scope: 'player',
    what: 'How you have scored on practice spots, street by street.',
  },
  {
    key: 'bnotw.coach.v1',
    scope: 'player',
    what: 'How often your decisions matched the coach, and what the gap cost.',
  },
  {
    key: 'bnotw.layers.v1',
    scope: 'player',
    what: 'Which coaching layers you have switched on.',
  },
  {
    key: 'bnotw.table.v1',
    scope: 'player',
    what: 'The table you were sitting at, so a reclaimed tab does not cost you the session. Per player, because a stack and a buy-in count belong to whoever built them.',
  },
  {
    key: 'bnotw.table.coach.v1',
    scope: 'player',
    what: 'The same, for the coach-mode table.',
  },
  {
    key: 'bnotw.recordbook.v1',
    scope: 'device',
    what: 'The Record Book: real money owed between real people. The crew’s, not any one player’s.',
  },
  {
    key: 'bnotw.roster.v1',
    scope: 'device',
    what: 'The bots and who is seated. The crew’s table, the same whoever is holding the iPad.',
  },
  {
    key: 'bnotw.handnames.v1',
    scope: 'device',
    what: 'The nicknames this table gives hands. Shared vocabulary, like the bet names.',
  },
  {
    key: 'bnotw.voices.v1',
    scope: 'device',
    what: 'The coaches and what this table calls them. Their names are the crew’s, the same way hand names are.',
  },
  {
    key: 'bnotw.settings.v1',
    scope: 'device',
    what: 'Speed, blinds, bomb-pot trigger and the rest of the table setup.',
  },
  {
    key: 'bnotw.coachcreds.v1',
    scope: 'device',
    what: 'Which model narrates, and its key. Never exported, never per player.',
  },
  {
    key: 'bnotw.coachkey.v1',
    scope: 'device',
    what: 'An API key from an older release, read once and migrated.',
  },
  {
    key: 'bnotw.profiles.v1',
    scope: 'device',
    what: 'The list of players on this device.',
  },
  {
    key: 'bnotw.activeprofile.v1',
    scope: 'device',
    what: 'Who was playing last. Never a guest.',
  },
]

/** The keys that belong to one player, and go when that player does. */
export function playerKeys(): string[] {
  return STORED.filter((t) => t.scope === 'player').map((t) => t.key)
}

export function scopeOf(key: string): KeyScope | null {
  return STORED.find((t) => t.key === key)?.scope ?? null
}
