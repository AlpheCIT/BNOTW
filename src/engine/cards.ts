/** Card representation, deck construction and shuffling. */

export const SUITS = ['s', 'h', 'd', 'c'] as const
export type Suit = (typeof SUITS)[number]

/** Ranks are numeric: 2..14 where 11=J, 12=Q, 13=K, 14=A. */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14

export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export interface Card {
  rank: Rank
  suit: Suit
}

const RANK_LABELS: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
}

export const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }

export const SUIT_NAMES: Record<Suit, string> = {
  s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs',
}

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank]
}

/** Short human/debug form, e.g. "As", "10h". */
export function cardCode(card: Card): string {
  return `${RANK_LABELS[card.rank]}${card.suit}`
}

/** Parse a short code such as "As", "Th", "10h", "7d" back into a Card. */
export function parseCard(code: string): Card {
  const suit = code.slice(-1).toLowerCase() as Suit
  if (!SUITS.includes(suit)) throw new Error(`Bad suit in card code: ${code}`)
  const rankPart = code.slice(0, -1).toUpperCase()
  const rank = ({ T: 10, '10': 10, J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[rankPart]
    ?? Number(rankPart)
  if (!RANKS.includes(rank as Rank)) throw new Error(`Bad rank in card code: ${code}`)
  return { rank: rank as Rank, suit }
}

export function parseCards(codes: string): Card[] {
  return codes.split(/\s+/).filter(Boolean).map(parseCard)
}

export function makeDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit })
  return deck
}

/** A seedable PRNG so games can be replayed deterministically in tests. */
export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates, in place. Returns the same array for convenience. */
export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/** A deck you draw from the top of. */
export class Shoe {
  private cards: Card[]

  constructor(rng: Rng = Math.random, cards?: Card[]) {
    this.cards = cards ? [...cards] : shuffle(makeDeck(), rng)
  }

  get remaining(): number {
    return this.cards.length
  }

  draw(): Card {
    const card = this.cards.pop()
    if (!card) throw new Error('Shoe is empty')
    return card
  }

  drawMany(count: number): Card[] {
    return Array.from({ length: count }, () => this.draw())
  }
}
