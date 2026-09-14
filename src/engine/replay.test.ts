import { describe, it, expect } from 'vitest'
import { mulberry32, parseCards, cardCode } from './cards'
import { decideAction, decideDiscard } from './ai'
import { buildReplay, replayFrames, frameEquity, frameHand, boardSizeFor } from './replay'
import { advanceStreet, applyAction, dealHand, potTotal, resolveShowdown } from './hand'
import { Table } from './table'
import { evenSeats, newHand, stackedShoe } from './testkit'

/** Play one hand out with the bots and hand back the finished state. */
function playOut(table: Table, rng: () => number) {
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
  return hand
}

describe('the journal', () => {
  it('records every chip that goes in, and nothing that does not', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c  2d  7s 6s 5s'))

    applyAction(hand, seats, 2, { kind: 'raise', amount: 150 })
    applyAction(hand, seats, 0, { kind: 'fold' })
    applyAction(hand, seats, 1, { kind: 'call' })

    expect(hand.journal.map((e) => [e.seat, e.kind, e.amount])).toEqual([
      [0, 'blind', 25],
      [1, 'blind', 50],
      [2, 'raise', 150],
      [0, 'fold', 0],
      [1, 'call', 100],
    ])
    // The running pot in the journal must match the real one at every step.
    expect(hand.journal[hand.journal.length - 1].pot).toBe(potTotal(hand))
  })

  it('records antes and a Crazy Pineapple pitch', () => {
    const table = new Table({ botCount: 3, bombPotTrigger: 'off' }, 5)
    table.settings.bombPotGameChoice = 'crazyPineapple'
    table.pendingBomb = 'test'
    const hand = table.startHand()
    expect(hand.journal.filter((e) => e.kind === 'ante')).toHaveLength(4)

    const seat = hand.pendingDiscards[0]
    const pitched = cardCode(hand.players[seat].hole[2])
    table.discard(seat, 2)
    const entry = hand.journal.find((e) => e.kind === 'discard')!
    expect(entry).toMatchObject({ seat, card: pitched, amount: 0 })
  })

  it('records a straddle at the amount actually posted', () => {
    const seats = evenSeats(5)
    const hand = newHand(seats, 4)
    hand.straddles.push({ seat: 2, amount: 100 })
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c 7d 6d 5h 4h'))
    expect(hand.journal.find((e) => e.kind === 'straddle')).toMatchObject({
      seat: 2, amount: 100, to: 100,
    })
  })
})

describe('board size by street', () => {
  it('knows a bomb pot has a flop before any betting', () => {
    expect(boardSizeFor('preflop', 'holdem')).toBe(0)
    expect(boardSizeFor('preflop', 'pineapple')).toBe(3)
    expect(boardSizeFor('flop', 'holdem')).toBe(3)
    expect(boardSizeFor('turn', 'holdem')).toBe(4)
    expect(boardSizeFor('river', 'holdem')).toBe(5)
  })
})

describe('replaying a hand', () => {
  it('walks the pot up and hands it back at the end', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh  Qs Qh'))
    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d  7s 6h 5c'))
    applyAction(hand, seats, 0, { kind: 'check' })
    applyAction(hand, seats, 1, { kind: 'bet', amount: 100 })
    applyAction(hand, seats, 2, { kind: 'fold' })
    applyAction(hand, seats, 0, { kind: 'fold' })
    advanceStreet(hand, stackedShoe('2c 3c 4c'))
    resolveShowdown(hand, seats, { dexterCount: 0, tableSeats: [0, 1, 2] })

    const frames = replayFrames(buildReplay(hand, seats, 0))

    expect(frames[0].caption).toBe('Cards in the air')
    expect(frames[0].pot).toBe(0)
    expect(frames[0].board).toHaveLength(0)

    // The pot never goes backwards until it is awarded.
    const running = frames.slice(0, -1).map((f) => f.pot)
    for (let i = 1; i < running.length; i++) {
      expect(running[i]).toBeGreaterThanOrEqual(running[i - 1])
    }

    const flopFrame = frames.find((f) => f.street === 'flop')!
    expect(flopFrame.board).toHaveLength(3)

    const last = frames[frames.length - 1]
    expect(last.settled).toBe(true)
    expect(last.caption).toContain('wins')
    expect(last.pot).toBe(0)
  })

  it('clears the chips in front of everyone when a new street starts', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh  Qs Qh'))
    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d  7s 6h 5c'))
    applyAction(hand, seats, 0, { kind: 'check' })
    applyAction(hand, seats, 1, { kind: 'check' })
    applyAction(hand, seats, 2, { kind: 'check' })

    const frames = replayFrames(buildReplay(hand, seats, 0))
    const firstFlop = frames.find((f) => f.street === 'flop')!
    expect(firstFlop.seats.every((s) => s.committed === 0)).toBe(true)
    // ...but the money is still in the middle.
    expect(firstFlop.pot).toBe(150)
  })

  it('keeps the pitched card hidden until the moment it is pitched', () => {
    const table = new Table({ botCount: 2, bombPotTrigger: 'off' }, 11)
    table.settings.bombPotGameChoice = 'crazyPineapple'
    table.pendingBomb = 'test'
    const rng = mulberry32(3)
    const hand = playOut(table, rng)

    const frames = replayFrames(buildReplay(hand, table.seats, 0))
    const hero = (f: (typeof frames)[number]) => f.seats.find((s) => s.isHero)!

    expect(hero(frames[0]).hole).toHaveLength(3)
    const afterPitch = frames.find((f) => f.entry?.kind === 'discard' && f.entry.seat === 0)!
    expect(hero(afterPitch).hole).toHaveLength(2)
    expect(hero(frames[frames.length - 1]).hole).toHaveLength(2)
  })

  it('deals out the rest of the board when everybody is already all in', () => {
    const seats = evenSeats(2)
    const hand = newHand(seats, 0)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh'))
    applyAction(hand, seats, 0, { kind: 'raise', amount: 4000 })
    applyAction(hand, seats, 1, { kind: 'call' })
    for (const deal of ['2d 7s 6h 5c', '2c Jd', '3c 4h']) {
      if (hand.phase === 'street') advanceStreet(hand, stackedShoe(deal))
    }
    resolveShowdown(hand, seats, { dexterCount: 0, tableSeats: [0, 1] })

    const frames = replayFrames(buildReplay(hand, seats, 0))
    expect(frames[frames.length - 1].board).toHaveLength(5)
    expect(frames.some((f) => f.street === 'river')).toBe(true)
  })
})

describe('what your chances really were', () => {
  it('counts the true equity with every hand face up', () => {
    const seats = evenSeats(2)
    const hand = newHand(seats, 0)
    // Heads up the button is the small blind and acts first, so the cards go
    // to the big blind first: seat 1 holds the aces.
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh'))
    applyAction(hand, seats, 0, { kind: 'raise', amount: 4000 })
    applyAction(hand, seats, 1, { kind: 'call' })

    const frames = replayFrames(buildReplay(hand, seats, 0))
    const equity = frameEquity(frames[1], mulberry32(9))!
    // Aces over kings, all in pre-flop.
    expect(equity.bySeat.get(1)!.equity).toBeGreaterThan(0.78)
    expect(equity.bySeat.get(0)!.equity).toBeLessThan(0.22)
  })

  it('is exact once the flop is out', () => {
    const seats = evenSeats(2)
    const hand = newHand(seats, 0)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh'))
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d  7s 6h 5c'))
    applyAction(hand, seats, 1, { kind: 'check' })
    applyAction(hand, seats, 0, { kind: 'check' })

    const frames = replayFrames(buildReplay(hand, seats, 0))
    const flop = frames.filter((f) => f.street === 'flop').pop()!
    expect(frameEquity(flop, mulberry32(1))!.exact).toBe(true)
  })

  it('says nothing when only one player is left', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh  Qs Qh'))
    applyAction(hand, seats, 2, { kind: 'fold' })
    applyAction(hand, seats, 0, { kind: 'fold' })
    const frames = replayFrames(buildReplay(hand, seats, 0))
    expect(frameEquity(frames[frames.length - 1], mulberry32(1))).toBeNull()
  })

  it('names the hand each player is holding at a frame', () => {
    const seats = evenSeats(2)
    const hand = newHand(seats, 0)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh'))
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d  Ad 7s 6h'))

    const frames = replayFrames(buildReplay(hand, seats, 0))
    const flop = frames.filter((f) => f.street === 'flop').pop()!
    expect(frameHand(flop, 1)).toBe('Three of a Kind, Aces')
    expect(frameHand(flop, 0)).toBe('Pair of Kings')
  })
})

describe('replays survive real hands', () => {
  it('rebuilds two hundred bot hands without losing a chip', () => {
    const table = new Table(
      { botCount: 5, bombPotTrigger: 'hands', bombPotHands: 7, straddleMultiplier: 1 },
      4242,
    )
    const rng = mulberry32(77)

    for (let i = 0; i < 200; i++) {
      for (const s of table.seats) if (s.stack < 400) table.rebuy(s.seat)
      const hand = playOut(table, rng)
      const replay = buildReplay(hand, table.seats, 0)
      const frames = replayFrames(replay)

      expect(frames.length).toBeGreaterThan(1)
      expect(frames[frames.length - 1].settled).toBe(true)

      // The journal has to account for every chip in the middle.
      const journalled = replay.journal.reduce((sum, e) => sum + e.amount, 0)
      expect(journalled, `hand #${hand.handNumber}`).toBe(potTotal(hand))

      // Board growth is monotonic and never exceeds what was dealt.
      let seen = 0
      for (const frame of frames) {
        expect(frame.board.length).toBeGreaterThanOrEqual(seen)
        seen = frame.board.length
      }
      expect(seen).toBe(parseCards(replay.board).length)

      table.finishHand()
    }
  }, 180_000)
})
