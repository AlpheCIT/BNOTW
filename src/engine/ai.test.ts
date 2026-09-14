import { describe, it, expect } from 'vitest'
import { mulberry32 } from './cards'
import { parseCards } from './cards'
import { money } from './bnotw'
import { chenScore, decideAction, decideDiscard, equity } from './ai'
import { potTotal } from './hand'
import { Table } from './table'

describe('pre-flop hand strength', () => {
  it('scores premium hands above trash', () => {
    expect(chenScore(parseCards('As Ah'))).toBeGreaterThan(chenScore(parseCards('Ks Kh')))
    expect(chenScore(parseCards('Ks Kh'))).toBeGreaterThan(chenScore(parseCards('As Ks')))
    expect(chenScore(parseCards('As Ks'))).toBeGreaterThan(chenScore(parseCards('7s 2h')))
    // The Dexter really is the worst hand in the deck.
    expect(chenScore(parseCards('7s 2h'))).toBeLessThan(1)
  })

  it('rewards suitedness and connectedness', () => {
    expect(chenScore(parseCards('9s 8s'))).toBeGreaterThan(chenScore(parseCards('9s 8h')))
    expect(chenScore(parseCards('9s 8h'))).toBeGreaterThan(chenScore(parseCards('9s 4h')))
  })

  it('scores a Crazy Pineapple holding on its best two cards', () => {
    expect(chenScore(parseCards('As Ah 2c'))).toBe(chenScore(parseCards('As Ah')))
  })
})

describe('equity estimates', () => {
  const rng = mulberry32(31337)

  it('puts a made flush miles ahead on the river', () => {
    const e = equity(parseCards('As Ks'), parseCards('Qs Js 4s 7h 2d'), 1, 500, rng)
    expect(e).toBeGreaterThan(0.97)
  })

  it('knows the worst hand on the board is behind', () => {
    const e = equity(parseCards('7c 2d'), parseCards('As Ks Qh 9h 3s'), 2, 500, rng)
    expect(e).toBeLessThan(0.15)
  })

  it('drops as opponents are added', () => {
    const board = parseCards('Ah 9d 4c')
    const heads = equity(parseCards('Ks Kd'), board, 1, 600, rng)
    const six = equity(parseCards('Ks Kd'), board, 5, 600, rng)
    expect(heads).toBeGreaterThan(six)
  })
})

describe('bot decisions', () => {
  const rng = mulberry32(4242)

  it('throws away the worst of three in Crazy Pineapple', () => {
    const table = new Table({ botCount: 2, bombPotTrigger: 'off' }, 5)
    table.pendingBomb = 'test'
    table.settings.bombPotGameChoice = 'crazyPineapple'
    const hand = table.startHand()
    // Give a known holding: two spades that flush with the board, plus a brick.
    hand.board = parseCards('Qs Js 4s')
    hand.players[hand.order[0]].hole = parseCards('As Ks 2d')
    expect(decideDiscard(hand, hand.order[0], rng)).toBe(2)
  })

  it('folds the worst hand in poker to a big raise', () => {
    const table = new Table({ botCount: 3, bombPotTrigger: 'off', straddleMultiplier: 0 }, 8)
    const hand = table.startHand()
    table.closeStraddles()
    const seat = hand.actingSeat!
    hand.players[seat].hole = parseCards('7s 2h')
    hand.currentBet = 800 // a $8.00 raise into a $0.50 game
    hand.lastRaiseSize = 750
    const action = decideAction({ state: hand, seats: table.seats, seat, rng, trials: 60 })
    expect(action.kind).toBe('fold')
  })
})

describe('table dynamics', () => {
  it('keeps a long session in the range a $0.25/$0.50 home game lives in', () => {
    const HANDS = 250
    const table = new Table(
      { botCount: 5, bombPotTrigger: 'hands', bombPotHands: 12, straddleMultiplier: 1 },
      777,
    )
    const rng = mulberry32(1234)
    let pots = 0

    for (let i = 0; i < HANDS; i++) {
      for (const s of table.seats) if (s.stack < 100) table.rebuy(s.seat)
      const hand = table.startHand()
      if (hand.phase === 'straddles') table.closeStraddles()
      for (let g = 0; g < 5000 && !hand.complete; g++) {
        switch (hand.phase) {
          case 'acting': {
            const seat = hand.actingSeat!
            table.act(seat, decideAction({ state: hand, seats: table.seats, seat, rng, trials: 40 }))
            break
          }
          case 'discard': {
            const s = hand.pendingDiscards[0]
            table.discard(s, decideDiscard(hand, s, rng))
            break
          }
          case 'street': table.advance(); break
          case 'dexterShow': table.resolveDexter(true); break
          default: throw new Error(`Stuck in ${hand.phase}`)
        }
      }
      pots += potTotal(hand)
      table.finishHand()
    }

    const avgPot = pots / HANDS
    const rebuys = table.seats.reduce((s, x) => s + x.buyIns, 0) - table.seats.length
    const rebuysPer100 = (rebuys / HANDS) * 100

    // Loose and social, but not a table that gets it all in every hand. These
    // bounds are deliberately wide; they exist to catch the bots going
    // haywire, not to pin down exact play. Seeded, so they are deterministic.
    expect(avgPot, `average pot was ${money(Math.round(avgPot))}`).toBeLessThan(4000)
    expect(avgPot).toBeGreaterThan(200)
    expect(rebuysPer100, `rebuys per 100 hands: ${rebuysPer100}`).toBeLessThan(8)
  }, 180_000)
})
