/**
 * Poker hand evaluation: pick the best five-card hand out of any set of cards.
 *
 * A hand is scored as a single integer so hands can be compared with `<`/`>`.
 * The score packs the category and five kicker ranks into base-16 digits:
 *   category * 16^5 + k1 * 16^4 + k2 * 16^3 + k3 * 16^2 + k4 * 16 + k5
 * Ranks are 2..14, so each fits in one base-16 digit.
 */

import type { Card, Rank } from './cards'
import { rankLabel } from './cards'

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.Trips]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.Quads]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
}

export interface HandValue {
  /** Comparable score; higher is better. */
  score: number
  category: HandCategory
  /** Ranks that break ties, most significant first. */
  kickers: number[]
  /** The exact five cards that make the hand. */
  cards: Card[]
}

const BASE = 16

function pack(category: HandCategory, kickers: number[]): number {
  let score = category
  for (let i = 0; i < 5; i++) score = score * BASE + (kickers[i] ?? 0)
  return score
}

/**
 * Score exactly five cards.
 */
export function rankFive(cards: Card[]): HandValue {
  if (cards.length !== 5) throw new Error(`rankFive needs 5 cards, got ${cards.length}`)

  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a)
  const isFlush = cards.every((c) => c.suit === cards[0].suit)

  // Straight detection, including the wheel (5-4-3-2-A) where the ace plays low.
  const distinct = [...new Set(ranks)]
  let straightHigh = 0
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straightHigh = distinct[0]
    else if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) straightHigh = 5
  }

  if (straightHigh && isFlush) {
    return {
      score: pack(HandCategory.StraightFlush, [straightHigh]),
      category: HandCategory.StraightFlush,
      kickers: [straightHigh],
      cards,
    }
  }

  // Group ranks by count, ordering by count first then by rank.
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const shape = groups.map(([, n]) => n).join('')
  const byCount = groups.map(([r]) => r)

  let category: HandCategory
  let kickers: number[]

  if (shape === '41') {
    category = HandCategory.Quads
    kickers = byCount
  } else if (shape === '32') {
    category = HandCategory.FullHouse
    kickers = byCount
  } else if (isFlush) {
    category = HandCategory.Flush
    kickers = ranks
  } else if (straightHigh) {
    category = HandCategory.Straight
    kickers = [straightHigh]
  } else if (shape === '311') {
    category = HandCategory.Trips
    kickers = byCount
  } else if (shape === '221') {
    category = HandCategory.TwoPair
    kickers = byCount
  } else if (shape === '2111') {
    category = HandCategory.Pair
    kickers = byCount
  } else {
    category = HandCategory.HighCard
    kickers = ranks
  }

  return { score: pack(category, kickers), category, kickers, cards }
}

/** All 5-card combinations of `cards`, as index tuples. */
function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield idx
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

/**
 * Best five-card hand from any 5+ cards. Used for Hold'em (7 cards) and, while
 * a Crazy Pineapple hand is still pre-discard, for 6- and 8-card sets.
 */
export function evaluate(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error(`evaluate needs at least 5 cards, got ${cards.length}`)
  if (cards.length === 5) return rankFive(cards)

  let best: HandValue | null = null
  for (const idx of combinations(cards.length, 5)) {
    const value = rankFive(idx.map((i) => cards[i]))
    if (!best || value.score > best.score) best = value
  }
  return best!
}

/** Human-readable description, e.g. "Full House, Kings full of Sevens". */
export function describeHand(value: HandValue): string {
  const name = (r: number, plural = true) => {
    const labels: Record<number, string> = {
      2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
      9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
    }
    const base = labels[r] ?? String(r)
    if (!plural) return base
    return base === 'Six' ? 'Sixes' : `${base}s`
  }
  const k = value.kickers

  switch (value.category) {
    case HandCategory.StraightFlush:
      return k[0] === 14 ? 'Royal Flush' : `Straight Flush, ${name(k[0], false)} high`
    case HandCategory.Quads:
      return `Four of a Kind, ${name(k[0])}`
    case HandCategory.FullHouse:
      return `Full House, ${name(k[0])} full of ${name(k[1])}`
    case HandCategory.Flush:
      return `Flush, ${name(k[0], false)} high`
    case HandCategory.Straight:
      return `Straight, ${name(k[0], false)} high`
    case HandCategory.Trips:
      return `Three of a Kind, ${name(k[0])}`
    case HandCategory.TwoPair:
      return `Two Pair, ${name(k[0])} and ${name(k[1])}`
    case HandCategory.Pair:
      return `Pair of ${name(k[0])}`
    default:
      return `${name(k[0], false)} High`
  }
}

/** Compact label for the seat badge, e.g. "A♠ K♠". */
export function kickerLabels(value: HandValue): string {
  return value.kickers.map((r) => rankLabel(r as Rank)).join(' ')
}
