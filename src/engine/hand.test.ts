import { describe, it, expect } from 'vitest'
import { parseCards, cardCode } from './cards'
import { BIG_BLIND, SMALL_BLIND } from './bnotw'
import {
  advanceStreet, applyAction, applyDiscard, addStraddle, buildPots, dealHand,
  isDexterHand, legalActions, livePlayers, potTotal, resolveShowdown, settleDexter,
} from './hand'
import { chipsInPlay, evenSeats, makeSeats, newHand, stackedShoe } from './testkit'

const showdownOpts = (tableSeats: number[], dexterCount = 0) => ({ dexterCount, tableSeats })

describe('blinds and pre-flop action', () => {
  it('posts blinds and opens the action under the gun', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c  2d  7s 6s 5s  2h  4d  3h  2c'))

    expect(hand.smallBlindSeat).toBe(0)
    expect(hand.bigBlindSeat).toBe(1)
    expect(hand.players[0].committedRound).toBe(SMALL_BLIND)
    expect(hand.players[1].committedRound).toBe(BIG_BLIND)
    expect(hand.currentBet).toBe(BIG_BLIND)
    // Three-handed, the button is under the gun.
    expect(hand.actingSeat).toBe(2)
    expect(seats[0].stack).toBe(4000 - SMALL_BLIND)
  })

  it('gives the big blind its option when everyone limps', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c  2d  7s 6s 5s  2h  4d  3h  2c'))

    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'call' })
    expect(hand.actingSeat).toBe(1) // the big blind still gets to raise
    applyAction(hand, seats, 1, { kind: 'check' })
    expect(hand.phase).toBe('street')
  })

  it('awards the pot immediately when everyone folds to the big blind', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c  2d  7s 6s 5s  2h  4d  3h  2c'))

    applyAction(hand, seats, 2, { kind: 'fold' })
    applyAction(hand, seats, 0, { kind: 'fold' })
    expect(hand.phase).toBe('street')
    expect(livePlayers(hand)).toHaveLength(1)

    advanceStreet(hand, stackedShoe('2c 3c 4c'))
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))

    expect(hand.board).toHaveLength(0) // never reached a flop
    expect(hand.awards).toHaveLength(1)
    expect(hand.awards[0].seat).toBe(1)
    expect(hand.awards[0].amount).toBe(SMALL_BLIND + BIG_BLIND)
    expect(seats[1].stack).toBe(4000 + SMALL_BLIND)
  })

  it('acts first out of position after the flop', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c  2d  7s 6s 5s'))
    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d 7s 6s 5s'))
    expect(hand.street).toBe('flop')
    expect(hand.actingSeat).toBe(0) // small blind is first to act
  })
})

describe('raising rules', () => {
  it('enforces the minimum raise', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c  2d  7s 6s 5s'))

    const legal = legalActions(hand, seats, 2)
    expect(legal.minRaiseTo).toBe(100) // $0.50 bet, min raise to $1.00
    expect(() => applyAction(hand, seats, 2, { kind: 'raise', amount: 75 }))
      .toThrow(/Minimum is/)
    applyAction(hand, seats, 2, { kind: 'raise', amount: 150 })
    expect(hand.currentBet).toBe(150)
    expect(hand.lastRaiseSize).toBe(100)
    expect(legalActions(hand, seats, 0).minRaiseTo).toBe(250)
  })

  it('reopens the action for players who already called', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c  2d  7s 6s 5s'))

    applyAction(hand, seats, 2, { kind: 'call' })  // button limps
    applyAction(hand, seats, 0, { kind: 'raise', amount: 200 })
    expect(hand.players[2].hasActed).toBe(false)
    expect(hand.players[2].canRaise).toBe(true)
  })

  it('does not reopen betting on an under-sized all-in raise', () => {
    // Seat 2 can only shove $0.80 over a $0.50 bet: less than a full raise.
    const seats = makeSeats([4000, 4000, 80])
    const hand = newHand(seats, 0)
    // Order is [1, 2, 0]; blinds on seats 1 and 2.
    dealHand(hand, seats, stackedShoe('As Ks  Qh Jh  9c 8c'))
    expect(hand.smallBlindSeat).toBe(1)
    expect(hand.bigBlindSeat).toBe(2)

    applyAction(hand, seats, 0, { kind: 'call' })       // button calls $0.50
    applyAction(hand, seats, 1, { kind: 'call' })       // sb completes
    applyAction(hand, seats, 2, { kind: 'raise', amount: 80 }) // bb shoves $0.80

    expect(hand.players[2].allIn).toBe(true)
    expect(hand.currentBet).toBe(80)
    expect(hand.players[0].canRaise).toBe(false)
    expect(hand.players[1].canRaise).toBe(false)
    const legal = legalActions(hand, seats, 0)
    expect(legal.canRaise).toBe(false)
    expect(legal.callAmount).toBe(30)
  })
})

describe('side pots', () => {
  it('splits into a main pot and side pots by commitment level', () => {
    const seats = makeSeats([500, 1500, 4000])
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh  2c 3d'))

    applyAction(hand, seats, 2, { kind: 'raise', amount: 4000 }) // shove
    applyAction(hand, seats, 0, { kind: 'call' })                // all in for 500
    applyAction(hand, seats, 1, { kind: 'call' })                // all in for 1500

    const pots = buildPots(hand)
    expect(pots).toHaveLength(3)
    expect(pots[0]).toMatchObject({ amount: 1500, eligible: [0, 1, 2] })
    expect(pots[1]).toMatchObject({ amount: 2000, eligible: [1, 2] })
    // Seat 2's uncalled $25.00 comes back as a pot only it can win.
    expect(pots[2]).toMatchObject({ amount: 2500, eligible: [2] })
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(potTotal(hand))
  })

  it('returns an uncalled bet to the bettor', () => {
    const seats = makeSeats([4000, 4000])
    const before = chipsInPlay(seats, null)
    const hand = newHand(seats, 0)
    dealHand(hand, seats, stackedShoe('As Ah  Ks Kh'))

    applyAction(hand, seats, 0, { kind: 'raise', amount: 1000 })
    applyAction(hand, seats, 1, { kind: 'fold' })
    advanceStreet(hand, stackedShoe('2c 3d 4h'))
    resolveShowdown(hand, seats, showdownOpts([0, 1]))

    expect(seats[0].stack).toBe(4000 + BIG_BLIND)
    expect(chipsInPlay(seats, hand)).toBe(before)
  })

  it('gives each pot to the best eligible hand', () => {
    const seats = makeSeats([500, 1500, 4000])
    const hand = newHand(seats, 2)
    // Short stack has the nuts on the main pot; the deep stack takes the rest.
    dealHand(hand, seats, stackedShoe('2h 2d  3h 3d  As Ks'))
    applyAction(hand, seats, 2, { kind: 'raise', amount: 4000 })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'call' })

    // Board pairs the short stack's deuces into quads.
    hand.board = parseCards('2s 2c 9d Qh Jc')
    hand.street = 'river'
    hand.phase = 'showdown'
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))

    const mainWinner = hand.awards.find((a) => a.potIndex === 0)!
    expect(mainWinner.seat).toBe(0)
    expect(mainWinner.amount).toBe(1500)
    // Seat 1 has 3s full; seat 2 has only a pair of deuces with A-K.
    expect(hand.awards.find((a) => a.potIndex === 1)!.seat).toBe(1)
    expect(hand.awards.find((a) => a.potIndex === 2)!.seat).toBe(2)
  })

  it('chops an even pot between tied hands', () => {
    const seats = evenSeats(2)
    const hand = newHand(seats, 0)
    dealHand(hand, seats, stackedShoe('2h 3d  2c 3s'))
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })

    hand.board = parseCards('As Ks Qh Jd 10c') // board plays for both
    hand.street = 'river'
    hand.phase = 'showdown'
    resolveShowdown(hand, seats, showdownOpts([0, 1]))

    expect(hand.awards).toHaveLength(2)
    expect(hand.awards.every((a) => a.split)).toBe(true)
    expect(seats[0].stack).toBe(4000)
    expect(seats[1].stack).toBe(4000)
  })
})

describe('straddles', () => {
  it('doubles the blind and moves the action to its left', () => {
    const seats = evenSeats(5)
    const hand = newHand(seats, 4) // order [0,1,2,3,4]; blinds 0 and 1
    addStraddle(hand, seats, 2)    // under the gun straddles
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c 7d 6d 5h 4h'))

    expect(hand.players[2].committedRound).toBe(100)
    expect(hand.currentBet).toBe(100)
    expect(hand.lastBlindSeat).toBe(2)
    expect(hand.actingSeat).toBe(3)
    expect(legalActions(hand, seats, 3).minRaiseTo).toBe(200)
  })

  it('doubles again on a re-straddle and hands the option to the last straddler', () => {
    const seats = evenSeats(5)
    const hand = newHand(seats, 4)
    addStraddle(hand, seats, 2)
    addStraddle(hand, seats, 3)
    dealHand(hand, seats, stackedShoe('As Ks Qh Jh 9c 8c 7d 6d 5h 4h'))

    expect(hand.straddles.map((s) => s.amount)).toEqual([100, 200])
    expect(hand.currentBet).toBe(200)
    expect(hand.lastBlindSeat).toBe(3)
    expect(hand.actingSeat).toBe(4)

    applyAction(hand, seats, 4, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'fold' })
    applyAction(hand, seats, 1, { kind: 'fold' })
    applyAction(hand, seats, 2, { kind: 'call' })
    expect(hand.actingSeat).toBe(3) // the re-straddle still has its option
  })

  it('refuses a straddle from a blind seat or a repeat seat', () => {
    const seats = evenSeats(5)
    const hand = newHand(seats, 4)
    expect(() => addStraddle(hand, seats, 0)).toThrow()
    expect(() => addStraddle(hand, seats, 1)).toThrow()
    addStraddle(hand, seats, 2)
    expect(() => addStraddle(hand, seats, 2)).toThrow()
  })
})

describe('bomb pots', () => {
  it('antes $2, deals two cards and puts the flop out with no pre-flop betting', () => {
    const seats = evenSeats(4)
    const hand = newHand(seats, 3, 'pineapple', 'pineapple')
    dealHand(hand, seats, stackedShoe('As Ks  Qh Jh  9c 8c  7d 6d   2s 3s 4s'))

    expect(hand.street).toBe('flop')
    expect(hand.board).toHaveLength(3)
    expect(potTotal(hand)).toBe(800)
    expect(seats[0].stack).toBe(4000 - 200)
    expect(Object.values(hand.players).every((p) => p.hole.length === 2)).toBe(true)
    expect(hand.currentBet).toBe(0)
    expect(hand.phase).toBe('acting')
    expect(hand.actingSeat).toBe(0) // first seat left of the button
  })

  it('antes $3, deals three cards and waits for discards', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2, 'crazyPineapple', 'crazyPineapple')
    dealHand(hand, seats, stackedShoe('As Ks 2h  Qh Jh 3d  9c 8c 4c   5s 6s 7s'))

    expect(hand.phase).toBe('discard')
    expect(hand.pendingDiscards).toEqual([0, 1, 2])
    expect(potTotal(hand)).toBe(900)
    expect(hand.players[0].hole.map(cardCode)).toEqual(['As', 'Ks', '2h'])

    applyDiscard(hand, 0, 2)
    expect(hand.players[0].hole).toHaveLength(2)
    expect(cardCode(hand.players[0].discarded!)).toBe('2h')
    expect(hand.phase).toBe('discard')

    applyDiscard(hand, 1, 2)
    applyDiscard(hand, 2, 2)
    expect(hand.phase).toBe('acting')
    expect(hand.actingSeat).toBe(0)
  })

  it('flags a monotone flop in a regular hand', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Kd Qh Jh 9c 8c'))
    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d  7h 4h 3h'))
    expect(hand.suitedFlopTriggered).toBe(true)
  })
})

describe('the Dexter', () => {
  it('recognises 7-2 in any suits and nothing else', () => {
    expect(isDexterHand(parseCards('7s 2h'))).toBe(true)
    expect(isDexterHand(parseCards('2c 7c'))).toBe(true)
    expect(isDexterHand(parseCards('7s 3h'))).toBe(false)
    expect(isDexterHand(parseCards('7s 2h 2d'))).toBe(false)
  })

  it('pays the progressive bonus when a 7-2 wins outright and shows', () => {
    const seats = evenSeats(4)
    const hand = newHand(seats, 3)
    dealHand(hand, seats, stackedShoe('7s 2h  Ks Kh  Qs Qh  Jc Jd'))
    applyAction(hand, seats, 2, { kind: 'fold' })
    applyAction(hand, seats, 3, { kind: 'fold' })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })

    hand.board = parseCards('7h 7d 2s 9c 4d') // sevens full of deuces
    hand.street = 'river'
    hand.phase = 'showdown'
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2, 3], 2))

    expect(hand.phase).toBe('dexterShow')
    expect(hand.pendingDexter).toMatchObject({ seat: 0, dexterNumber: 3, perPlayer: 300 })

    const stacksBefore = seats.map((s) => s.stack)
    const claim = settleDexter(hand, seats, true)
    expect(claim!.total).toBe(900) // three other players at $3 each
    expect(seats[0].stack).toBe(stacksBefore[0] + 900)
    expect(seats[1].stack).toBe(stacksBefore[1] - 300)
    expect(hand.dexter).not.toBeNull()
  })

  it('pays nothing if the 7-2 winner mucks', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('7s 2h  Ks Kh  Qs Qh'))
    applyAction(hand, seats, 2, { kind: 'fold' })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    hand.board = parseCards('7h 7d 2s 9c 4d')
    hand.street = 'river'
    hand.phase = 'showdown'
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))

    const before = seats.map((s) => s.stack)
    expect(settleDexter(hand, seats, false)).toBeNull()
    expect(seats.map((s) => s.stack)).toEqual(before)
    expect(hand.dexter).toBeNull()
  })

  it('does not count a chopped pot', () => {
    const seats = evenSeats(2)
    const hand = newHand(seats, 0)
    dealHand(hand, seats, stackedShoe('7s 2h  7d 2c'))
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    hand.board = parseCards('7h 7c 2s 2d 9c')
    hand.street = 'river'
    hand.phase = 'showdown'
    resolveShowdown(hand, seats, showdownOpts([0, 1]))
    expect(hand.pendingDexter).toBeNull()
  })

  it('does not count when the hand never reached the river', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('7s 2h  Ks Kh  Qs Qh'))
    applyAction(hand, seats, 2, { kind: 'fold' })
    applyAction(hand, seats, 0, { kind: 'raise', amount: 400 })
    applyAction(hand, seats, 1, { kind: 'fold' })

    advanceStreet(hand, stackedShoe('2c 3c 4c'))
    resolveShowdown(hand, seats, showdownOpts([0, 1, 2]))
    expect(hand.board).toHaveLength(0)
    expect(hand.pendingDexter).toBeNull()
  })
})
