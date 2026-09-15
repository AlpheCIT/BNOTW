/**
 * What the table calls your hand.
 *
 * The app already names bet sizes — Bob-aloo, Dave-aloo — and those are the
 * most BNOTW thing in it. Hand nicknames are the same idea: the words people
 * actually say when the cards come out.
 *
 * The list below is a starting point, not an authority. Nicknames vary by
 * region and by table, and the ones that matter at any given game are the ones
 * that game invented — so every name here can be renamed or deleted, and new
 * ones added, which is the whole point of the feature.
 */

import { rankLabel, type Card, type Rank } from './cards'

/**
 * The standard way to write a starting hand: "AKs", "AKo", "QQ".
 *
 * Higher rank first, `s` for suited and `o` for offsuit, which collapses the
 * 1,326 possible deals onto the 169 hands anybody actually talks about.
 */
export function handKey(hole: Card[]): string | null {
  if (hole.length < 2) return null
  const [a, b] = [...hole].sort((x, y) => y.rank - x.rank)
  const high = rankLabel(a.rank as Rank)
  const low = rankLabel(b.rank as Rank)
  if (a.rank === b.rank) return `${high}${low}`
  return `${high}${low}${a.suit === b.suit ? 's' : 'o'}`
}

/**
 * The names this ships with.
 *
 * Only ones that are reasonably well established. Deliberately not exhaustive:
 * a long list of names nobody says is worse than a short list of names
 * everybody does, and the gaps are where a table puts its own.
 */
export const HAND_NAMES: Record<string, string> = {
  // Pairs
  AA: 'Pocket Rockets',
  KK: 'Cowboys',
  QQ: 'Ladies',
  JJ: 'Fishhooks',
  TT: 'Dimes',
  99: 'Wayne Gretzky',
  88: 'Snowmen',
  77: 'Hockey Sticks',
  66: 'Route 66',
  55: 'Speed Limit',
  44: 'Sailboats',
  33: 'Crabs',
  22: 'Ducks',

  // Ace
  AKs: 'Big Slick',
  AKo: 'Big Slick',
  AQs: 'Big Chick',
  AQo: 'Big Chick',
  AJs: 'Ajax',
  AJo: 'Ajax',
  ATs: 'Johnny Moss',
  ATo: 'Johnny Moss',
  A8o: "Dead Man's Hand",

  // Broadway
  KQs: 'Royal Marriage',
  KQo: 'Marriage',
  KJs: 'Kojak',
  KJo: 'Kojak',
  K9o: 'Canine',
  QJs: 'Maverick',
  QJo: 'Maverick',
  Q7o: 'Computer Hand',

  // The rest
  T2s: 'Doyle Brunson',
  T2o: 'Doyle Brunson',
  T5o: 'Woolworth',
  T4o: 'Over and Out',
  J5o: 'Jackson Five',
  '95o': 'Dolly Parton',
  '95s': 'Dolly Parton',
  '87s': 'RPM',
  '72o': 'The Hammer',
  '69o': 'Big Lick',
  '54o': 'Jesse James',
  '32o': 'Dirty Diaper',
}

/** Names added or overridden by this table, keyed the same way. */
export type CustomHandNames = Record<string, string>

/**
 * What to call these two cards, or null for the vast majority that have no
 * name worth showing.
 *
 * A table's own entry wins over the shipped one, and an entry set to an empty
 * string hides a shipped name — which is how you delete something you never
 * say without the list growing a separate "removed" concept.
 */
export function handName(hole: Card[], custom: CustomHandNames = {}): string | null {
  const key = handKey(hole)
  if (!key) return null
  if (key in custom) return custom[key].trim() || null
  return HAND_NAMES[key] ?? null
}

/** Every name in play, shipped and custom merged, for the editor. */
export function allHandNames(custom: CustomHandNames = {}): {
  key: string
  name: string
  custom: boolean
}[] {
  const keys = new Set([...Object.keys(HAND_NAMES), ...Object.keys(custom)])
  return [...keys]
    .map((key) => ({
      key,
      name: (key in custom ? custom[key] : HAND_NAMES[key]) ?? '',
      custom: key in custom,
    }))
    .filter((entry) => entry.name.trim().length > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
}
