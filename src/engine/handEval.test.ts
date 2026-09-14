import { describe, it, expect } from 'vitest'
import { parseCards, makeDeck } from './cards'
import { evaluate, rankFive, describeHand, HandCategory } from './handEval'

const cat = (codes: string) => evaluate(parseCards(codes)).category
const score = (codes: string) => evaluate(parseCards(codes)).score

describe('rankFive categories', () => {
  it('classifies every category', () => {
    expect(cat('As Ks Qs Js 10s')).toBe(HandCategory.StraightFlush)
    expect(cat('9h 8h 7h 6h 5h')).toBe(HandCategory.StraightFlush)
    expect(cat('5c 4c 3c 2c Ac')).toBe(HandCategory.StraightFlush) // steel wheel
    expect(cat('7s 7h 7d 7c 2s')).toBe(HandCategory.Quads)
    expect(cat('Ks Kh Kd 4c 4s')).toBe(HandCategory.FullHouse)
    expect(cat('As Js 9s 6s 3s')).toBe(HandCategory.Flush)
    expect(cat('9h 8s 7d 6c 5h')).toBe(HandCategory.Straight)
    expect(cat('5h 4s 3d 2c Ah')).toBe(HandCategory.Straight) // the wheel
    expect(cat('Qs Qh Qd 8c 3s')).toBe(HandCategory.Trips)
    expect(cat('Js Jh 4d 4c 9s')).toBe(HandCategory.TwoPair)
    expect(cat('2s 2h Ad Kc 9s')).toBe(HandCategory.Pair)
    expect(cat('Ah Qs 9d 6c 3s')).toBe(HandCategory.HighCard)
  })

  it('does not call A-K-Q-J-10 of mixed suits a straight flush', () => {
    expect(cat('As Ks Qs Js 10h')).toBe(HandCategory.Straight)
  })

  it('does not read K-A-2-3-4 as a straight', () => {
    expect(cat('Kh As 2d 3c 4s')).toBe(HandCategory.HighCard)
  })
})

describe('hand ordering', () => {
  it('orders categories correctly', () => {
    const ladder = [
      'Ah Qs 9d 6c 3s',   // high card
      '2s 2h Ad Kc 9s',   // pair
      'Js Jh 4d 4c 9s',   // two pair
      'Qs Qh Qd 8c 3s',   // trips
      '9h 8s 7d 6c 5h',   // straight
      'As Js 9s 6s 3s',   // flush
      'Ks Kh Kd 4c 4s',   // full house
      '7s 7h 7d 7c 2s',   // quads
      '9h 8h 7h 6h 5h',   // straight flush
    ]
    for (let i = 1; i < ladder.length; i++) {
      expect(score(ladder[i])).toBeGreaterThan(score(ladder[i - 1]))
    }
  })

  it('breaks ties on kickers', () => {
    expect(score('As Ah Kd Qc 9s')).toBeGreaterThan(score('As Ah Kd Qc 8s'))
    expect(score('Ks Kh Ad 3c 2s')).toBeGreaterThan(score('Qs Qh Ad 3c 2s'))
    expect(score('As Kh Qd Jc 9s')).toBeGreaterThan(score('As Kh Qd Jc 8s'))
  })

  it('ranks the wheel below every other straight', () => {
    expect(score('6h 5s 4d 3c 2h')).toBeGreaterThan(score('5h 4s 3d 2c Ah'))
  })

  it('treats identical hands of different suits as equal', () => {
    expect(score('As Ks Qs Js 10s')).toBe(score('Ah Kh Qh Jh 10h'))
  })

  it('ranks a higher full house above a lower one', () => {
    expect(score('3s 3h 3d 2c 2s')).toBeGreaterThan(score('2s 2h 2d Ac As'))
  })
})

describe('best five of seven', () => {
  it('finds the flush hidden in seven cards', () => {
    const v = evaluate(parseCards('2s 7s  As Ks 9s 4h 3d'))
    expect(v.category).toBe(HandCategory.Flush)
    expect(describeHand(v)).toBe('Flush, Ace high')
  })

  it('plays the board when the hole cards do not help', () => {
    const board = 'As Ks Qs Js 10s'
    expect(score(`2h 3d ${board}`)).toBe(score(`4c 5c ${board}`))
  })

  it('prefers the full house over the flush', () => {
    const v = evaluate(parseCards('Ks Kh  Kd 4c 4s 9s 2s'))
    expect(v.category).toBe(HandCategory.FullHouse)
  })

  it('picks the best of two possible straights', () => {
    const v = evaluate(parseCards('9h 5d  8s 7d 6c 5h 4s'))
    expect(v.category).toBe(HandCategory.Straight)
    expect(v.kickers[0]).toBe(9)
  })

  it('returns exactly five cards', () => {
    expect(evaluate(parseCards('9h 5d 8s 7d 6c 5h 4s')).cards).toHaveLength(5)
  })
})

describe('exhaustive sanity check', () => {
  it('agrees with rankFive on every 5-card subset it reports as best', () => {
    // Every 5-card hand out of a fixed 8-card set must score <= the reported best.
    const cards = parseCards('As Ks 7h 7d 7c 2s 2h 9d')
    const best = evaluate(cards)
    let checked = 0
    for (let a = 0; a < cards.length; a++)
      for (let b = a + 1; b < cards.length; b++)
        for (let c = b + 1; c < cards.length; c++)
          for (let d = c + 1; d < cards.length; d++)
            for (let e = d + 1; e < cards.length; e++) {
              checked++
              expect(rankFive([cards[a], cards[b], cards[c], cards[d], cards[e]]).score)
                .toBeLessThanOrEqual(best.score)
            }
    expect(checked).toBe(56)
    expect(best.category).toBe(HandCategory.FullHouse)
  })

  it('scores all 2,598,960 five-card hands into the expected category counts', () => {
    const deck = makeDeck()
    const counts = new Array(9).fill(0)
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++)
              counts[rankFive([deck[a], deck[b], deck[c], deck[d], deck[e]]).category]++

    // Textbook frequencies for 5-card poker hands.
    expect(counts[HandCategory.StraightFlush]).toBe(40)
    expect(counts[HandCategory.Quads]).toBe(624)
    expect(counts[HandCategory.FullHouse]).toBe(3744)
    expect(counts[HandCategory.Flush]).toBe(5108)
    expect(counts[HandCategory.Straight]).toBe(10200)
    expect(counts[HandCategory.Trips]).toBe(54912)
    expect(counts[HandCategory.TwoPair]).toBe(123552)
    expect(counts[HandCategory.Pair]).toBe(1098240)
    expect(counts[HandCategory.HighCard]).toBe(1302540)
    expect(counts.reduce((s, n) => s + n, 0)).toBe(2598960)
  }, 60_000)
})
