/**
 * One hand of poker, start to finish: posting, dealing, betting, side pots,
 * showdown, and the BNOTW extras (straddles, bomb pots, the Dexter).
 *
 * State is mutated in place. The table layer owns the `Seat[]` array (stacks
 * live there, because they outlive a hand) and passes it into every call.
 */

import type { Card } from './cards'
import { cardCode, type Shoe } from './cards'
import { evaluate, describeHand, type HandValue } from './handEval'
import {
  BIG_BLIND, SMALL_BLIND, CHIP_INCREMENT, BOMB_POT_GAMES, DEXTER_RANKS,
  dexterPayPerPlayer, money, namedBetFor, type BombPotGame,
} from './bnotw'
import type {
  Action, HandPlayer, HandState, JournalEntry, LogEntry, Phase, Pot, PotAward, Seat,
  Street, Variant,
} from './types'

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown']

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function handPlayers(state: HandState): HandPlayer[] {
  return state.order.map((seat) => state.players[seat])
}

/** Everyone who has not folded. */
export function livePlayers(state: HandState): HandPlayer[] {
  return handPlayers(state).filter((p) => !p.folded)
}

/** Everyone who has not folded and still has chips to bet. */
export function contenders(state: HandState): HandPlayer[] {
  return handPlayers(state).filter((p) => !p.folded && !p.allIn)
}

function orderIndex(state: HandState, seat: number): number {
  return state.order.indexOf(seat)
}

/** Walk clockwise from `afterSeat`, returning seats in order (excluding it). */
function seatsAfter(state: HandState, afterSeat: number): number[] {
  const start = orderIndex(state, afterSeat)
  const out: number[] = []
  for (let i = 1; i <= state.order.length; i++) {
    out.push(state.order[(start + i) % state.order.length])
  }
  return out
}

function log(state: HandState, text: string, tone: LogEntry['tone'] = 'normal') {
  state.log.push({ id: state.log.length, street: state.street, text, tone })
}

/** Record a chip movement in the structured history. Call it after the commit. */
function record(
  state: HandState,
  seat: number,
  kind: JournalEntry['kind'],
  amount: number,
  extra: Partial<JournalEntry> = {},
) {
  state.journal.push({
    street: state.street,
    seat,
    kind,
    amount,
    to: state.players[seat]?.committedRound ?? 0,
    pot: potTotal(state),
    ...extra,
  })
}

function name(seats: Seat[], seat: number): string {
  return seats[seat]?.name ?? `Seat ${seat + 1}`
}

/** Move chips from a stack into the pot. Returns the amount actually moved. */
function commit(seats: Seat[], p: HandPlayer, toTotal: number): number {
  const seatObj = seats[p.seat]
  const delta = Math.max(0, Math.min(toTotal - p.committedRound, seatObj.stack))
  seatObj.stack -= delta
  p.committedRound += delta
  p.committedHand += delta
  if (seatObj.stack === 0) p.allIn = true
  return delta
}

export function potTotal(state: HandState): number {
  return handPlayers(state).reduce((sum, p) => sum + p.committedHand, 0)
}

// ---------------------------------------------------------------------------
// Setting up a hand
// ---------------------------------------------------------------------------

export interface HandSetup {
  handNumber: number
  seats: Seat[]
  /** Seats dealt into this hand, clockwise starting left of the button. */
  order: number[]
  buttonSeat: number
  variant: Variant
  bombGame: BombPotGame | null
  bombReason: string | null
}

export function createHand(setup: HandSetup): HandState {
  const players: Record<number, HandPlayer> = {}
  for (const seat of setup.order) {
    players[seat] = {
      seat,
      hole: [],
      discarded: null,
      folded: false,
      allIn: false,
      hasActed: false,
      canRaise: true,
      committedRound: 0,
      committedHand: 0,
      startingStack: setup.seats[seat].stack,
      lastAction: null,
      revealed: false,
      straddle: 0,
    }
  }

  const isBomb = setup.variant !== 'holdem'

  const state: HandState = {
    handNumber: setup.handNumber,
    variant: setup.variant,
    isBombPot: isBomb,
    bombGame: setup.bombGame,
    bombReason: setup.bombReason,
    buttonSeat: setup.buttonSeat,
    smallBlindSeat: null,
    bigBlindSeat: null,
    street: 'preflop',
    // Bomb pots have no pre-flop action, so there is no straddle window.
    phase: isBomb ? 'street' : 'straddles',
    board: [],
    players,
    order: setup.order,
    currentBet: 0,
    lastRaiseSize: BIG_BLIND,
    actingSeat: null,
    pendingDiscards: [],
    straddles: [],
    lastBlindSeat: null,
    pots: [],
    awards: [],
    pendingDexter: null,
    dexter: null,
    suitedFlopTriggered: false,
    log: [],
    journal: [],
    complete: false,
  }

  state.log.push({
    id: 0,
    street: 'setup',
    text: isBomb
      ? `Hand #${setup.handNumber} — BOMB POT (${BOMB_POT_GAMES[setup.bombGame!].name})${setup.bombReason ? ` · ${setup.bombReason}` : ''}`
      : `Hand #${setup.handNumber} — $0.25/$0.50 No-Limit Hold'em`,
    tone: isBomb ? 'bomb' : 'normal',
  })

  return state
}

/**
 * The next straddle amount: double the largest forced bet already out there.
 * The first straddle is twice the big blind.
 */
export function nextStraddleAmount(state: HandState): number {
  const last = state.straddles[state.straddles.length - 1]
  return last ? last.amount * 2 : BIG_BLIND * 2
}

/**
 * Seats that could still put out a straddle. BNOTW allows a straddle from any
 * position, so the only constraints are that a seat straddles at most once,
 * that it is not one of the blinds, and that it can cover the amount.
 */
export function straddleCandidates(state: HandState, seats: Seat[]): number[] {
  const amount = nextStraddleAmount(state)
  const taken = new Set(state.straddles.map((s) => s.seat))
  const blinds = blindSeats(state)
  return state.order.filter(
    (seat) => !taken.has(seat) && !blinds.includes(seat) && seats[seat].stack >= amount,
  )
}

/** Which seats will post the small and big blind this hand. */
function blindSeats(state: HandState): number[] {
  const after = seatsAfter(state, state.buttonSeat)
  // Heads-up: the button is the small blind.
  if (state.order.length === 2) return [state.buttonSeat, after[0]]
  return [after[0], after[1]]
}

export function addStraddle(state: HandState, seats: Seat[], seat: number): void {
  if (state.phase !== 'straddles') throw new Error('Straddles are closed')
  if (!straddleCandidates(state, seats).includes(seat)) {
    throw new Error(`Seat ${seat} cannot straddle right now`)
  }
  state.straddles.push({ seat, amount: nextStraddleAmount(state) })
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

/** Close the straddle window, post the money, deal the cards, open the action. */
export function dealHand(state: HandState, seats: Seat[], shoe: Shoe): void {
  if (state.isBombPot) dealBombPot(state, seats, shoe)
  else dealHoldem(state, seats, shoe)
}

function dealHoldem(state: HandState, seats: Seat[], shoe: Shoe): void {
  const [sbSeat, bbSeat] = blindSeats(state)
  state.smallBlindSeat = sbSeat
  state.bigBlindSeat = bbSeat

  const sb = state.players[sbSeat]
  const bb = state.players[bbSeat]
  const sbPaid = commit(seats, sb, SMALL_BLIND)
  record(state, sbSeat, 'blind', sbPaid, { allIn: sb.allIn })
  const bbPaid = commit(seats, bb, BIG_BLIND)
  record(state, bbSeat, 'blind', bbPaid, { allIn: bb.allIn })
  log(state, `${name(seats, sbSeat)} posts the small blind ${money(sb.committedRound)}`)
  log(state, `${name(seats, bbSeat)} posts the big blind ${money(bb.committedRound)}`)

  state.currentBet = bb.committedRound
  state.lastRaiseSize = BIG_BLIND
  state.lastBlindSeat = bbSeat

  // Straddles are ordered the way they were declared; each one doubles the
  // previous forced bet and takes over as the last live blind.
  for (const straddle of state.straddles) {
    const p = state.players[straddle.seat]
    const paid = commit(seats, p, straddle.amount)
    p.straddle = p.committedRound
    record(state, straddle.seat, 'straddle', paid, { allIn: p.allIn })
    const label = state.straddles.indexOf(straddle) === 0 ? 'straddles' : 're-straddles'
    log(state, `${name(seats, straddle.seat)} ${label} ${money(p.committedRound)}`, 'bnotw')
    if (p.committedRound > state.currentBet) {
      state.currentBet = p.committedRound
      // A straddle is a live blind: it plays as the big blind for this hand,
      // so the next raise has to double it rather than merely top it up.
      state.lastRaiseSize = p.committedRound
      state.lastBlindSeat = straddle.seat
    }
  }

  for (const seat of state.order) {
    state.players[seat].hole = shoe.drawMany(2)
  }

  // Everyone who posted has money out but has not yet acted, so the last live
  // blind still gets its option when the action comes back around.
  state.phase = 'acting'
  state.actingSeat = findNextToAct(state, state.lastBlindSeat!)
  if (state.actingSeat === null) closeBettingRound(state)
}

function dealBombPot(state: HandState, seats: Seat[], shoe: Shoe): void {
  const game = BOMB_POT_GAMES[state.bombGame!]
  log(state, `Everyone antes ${money(game.ante)} — no pre-flop betting`, 'bomb')

  for (const seat of state.order) {
    const p = state.players[seat]
    const paid = commit(seats, p, game.ante)
    record(state, seat, 'ante', paid, { allIn: p.allIn })
  }
  for (const seat of state.order) {
    state.players[seat].hole = shoe.drawMany(game.holeCards)
  }

  // Antes are dead money: they belong to the pot, not to this street's bet.
  for (const seat of state.order) {
    state.players[seat].committedRound = 0
  }
  state.currentBet = 0
  state.lastRaiseSize = BIG_BLIND

  state.street = 'flop'
  state.board = shoe.drawMany(3)
  log(state, `Flop: ${state.board.map(cardCode).join(' ')}`, 'bomb')

  if (game.discardAfterFlop) {
    state.phase = 'discard'
    state.pendingDiscards = [...state.order]
  } else {
    openBettingRound(state)
  }
}

/** Crazy Pineapple: pitch one of the three hole cards after the flop. */
export function applyDiscard(state: HandState, seat: number, cardIndex: number): void {
  if (state.phase !== 'discard') throw new Error('Not a discard phase')
  if (!state.pendingDiscards.includes(seat)) throw new Error(`Seat ${seat} has no discard due`)
  const p = state.players[seat]
  if (cardIndex < 0 || cardIndex >= p.hole.length) throw new Error('Bad discard index')

  p.discarded = p.hole.splice(cardIndex, 1)[0]
  record(state, seat, 'discard', 0, { card: cardCode(p.discarded) })
  state.pendingDiscards = state.pendingDiscards.filter((s) => s !== seat)

  if (state.pendingDiscards.length === 0) {
    log(state, 'Everyone pitches a card. Betting is open.', 'bomb')
    openBettingRound(state)
  }
}

// ---------------------------------------------------------------------------
// Betting rounds
// ---------------------------------------------------------------------------

/** Start a post-flop betting round: no bet yet, first live seat left of button. */
function openBettingRound(state: HandState): void {
  for (const p of handPlayers(state)) {
    p.committedRound = 0
    p.hasActed = false
    p.canRaise = true
    p.lastAction = null
  }
  state.currentBet = 0
  state.lastRaiseSize = BIG_BLIND
  state.phase = 'acting'
  state.actingSeat = findNextToAct(state, state.buttonSeat)
  if (state.actingSeat === null) closeBettingRound(state)
}

/**
 * Is the current betting round finished? It is once every player who can still
 * act has acted since the last raise and has matched the current bet.
 */
export function roundComplete(state: HandState): boolean {
  if (livePlayers(state).length <= 1) return true
  const able = contenders(state)
  if (able.length === 0) return true
  if (able.length === 1) return able[0].committedRound >= state.currentBet
  return able.every((p) => p.hasActed && p.committedRound === state.currentBet)
}

function findNextToAct(state: HandState, afterSeat: number): number | null {
  if (roundComplete(state)) return null
  for (const seat of seatsAfter(state, afterSeat)) {
    const p = state.players[seat]
    if (p.folded || p.allIn) continue
    if (!p.hasActed || p.committedRound < state.currentBet) return seat
  }
  return null
}

function closeBettingRound(state: HandState): void {
  state.actingSeat = null
  state.phase = 'street'
}

export interface LegalActions {
  seat: number
  canFold: boolean
  canCheck: boolean
  /** Extra chips needed to call; 0 when checking is free. */
  callAmount: number
  callIsAllIn: boolean
  /** True when no one has bet yet this street. */
  canBet: boolean
  canRaise: boolean
  /** Total this player would be at after a minimum bet/raise. */
  minRaiseTo: number
  /** Total this player would be at if they shoved. */
  maxRaiseTo: number
  /** True when the only legal raise is an under-sized all-in. */
  raiseIsAllInOnly: boolean
}

export function legalActions(state: HandState, seats: Seat[], seat: number): LegalActions {
  const p = state.players[seat]
  const stack = seats[seat].stack
  const owed = state.currentBet - p.committedRound
  const maxRaiseTo = p.committedRound + stack
  const facingBet = owed > 0

  const minRaiseTo = facingBet
    ? state.currentBet + state.lastRaiseSize
    : Math.max(state.currentBet + state.lastRaiseSize, BIG_BLIND)

  // You can always shove; you just may not be able to make a *full* raise.
  const hasRaiseRoom = maxRaiseTo > state.currentBet
  const allowedToRaise = p.canRaise && hasRaiseRoom

  return {
    seat,
    canFold: facingBet,
    canCheck: !facingBet,
    callAmount: Math.min(owed, stack),
    callIsAllIn: facingBet && owed >= stack,
    canBet: !facingBet && allowedToRaise,
    canRaise: facingBet && allowedToRaise,
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
    raiseIsAllInOnly: allowedToRaise && maxRaiseTo < minRaiseTo,
  }
}

export function applyAction(
  state: HandState,
  seats: Seat[],
  seat: number,
  action: Action,
): void {
  if (state.phase !== 'acting') throw new Error(`Cannot act during phase "${state.phase}"`)
  if (state.actingSeat !== seat) throw new Error(`It is not seat ${seat}'s turn`)

  const p = state.players[seat]
  const legal = legalActions(state, seats, seat)
  const who = name(seats, seat)
  const before = p.committedRound

  switch (action.kind) {
    case 'fold': {
      p.folded = true
      p.hasActed = true
      p.lastAction = 'Fold'
      log(state, `${who} folds`)
      break
    }
    case 'check': {
      if (!legal.canCheck) throw new Error(`${who} cannot check facing a bet`)
      p.hasActed = true
      p.lastAction = 'Check'
      log(state, `${who} checks`)
      break
    }
    case 'call': {
      if (legal.callAmount <= 0) throw new Error(`${who} has nothing to call`)
      const paid = commit(seats, p, state.currentBet)
      p.hasActed = true
      p.lastAction = p.allIn ? `Call ${money(paid)} (all in)` : `Call ${money(paid)}`
      log(state, `${who} calls ${money(paid)}${p.allIn ? ' and is all in' : ''}`)
      break
    }
    case 'bet':
    case 'raise': {
      const target = action.amount ?? 0
      if (!legal.canBet && !legal.canRaise) throw new Error(`${who} cannot raise`)
      if (target > legal.maxRaiseTo) throw new Error(`${who} cannot cover ${money(target)}`)
      if (target <= state.currentBet) throw new Error('Raise must exceed the current bet')
      if (target < legal.minRaiseTo && target !== legal.maxRaiseTo) {
        throw new Error(`Minimum is ${money(legal.minRaiseTo)}`)
      }
      // An all-in for less than a full raise is legal, but it does not reopen
      // the betting for players who have already acted this round.
      const isFullRaise = target - state.currentBet >= state.lastRaiseSize

      const increment = target - state.currentBet
      const previousBet = state.currentBet
      commit(seats, p, target)
      state.currentBet = p.committedRound

      if (isFullRaise) {
        state.lastRaiseSize = increment
        for (const other of contenders(state)) {
          if (other.seat === seat) continue
          other.hasActed = false
          other.canRaise = true
        }
      } else {
        for (const other of contenders(state)) {
          if (other.seat === seat) continue
          if (other.hasActed) other.canRaise = false
          else other.canRaise = true
        }
      }

      p.hasActed = true
      const named = namedBetFor(p.committedRound)
      const label = named ? `${named.name} (${money(p.committedRound)})` : money(p.committedRound)
      const verb = previousBet === 0 ? 'bets' : 'raises to'
      p.lastAction = `${previousBet === 0 ? 'Bet' : 'Raise'} ${money(p.committedRound)}`
      log(
        state,
        `${who} ${verb} ${label}${p.allIn ? ' and is all in' : ''}`,
        named ? 'bnotw' : 'normal',
      )
      break
    }
  }

  record(state, seat, action.kind, p.committedRound - before, { allIn: p.allIn })

  if (livePlayers(state).length <= 1) {
    closeBettingRound(state)
    return
  }

  const next = findNextToAct(state, seat)
  if (next === null) closeBettingRound(state)
  else state.actingSeat = next
}

// ---------------------------------------------------------------------------
// Street advancement
// ---------------------------------------------------------------------------

/** True once no further betting is possible and the board should just run out. */
export function isRunout(state: HandState): boolean {
  return livePlayers(state).length > 1 && contenders(state).length <= 1
}

/**
 * Deal the next street (or move to showdown). Call this when `phase === 'street'`.
 * Returns the street that was dealt, or 'showdown'.
 */
export function advanceStreet(state: HandState, shoe: Shoe): Street {
  if (state.phase !== 'street') throw new Error(`Cannot advance during phase "${state.phase}"`)

  if (livePlayers(state).length <= 1) {
    state.street = 'showdown'
    state.phase = 'showdown'
    return 'showdown'
  }

  const next = STREET_ORDER[STREET_ORDER.indexOf(state.street) + 1]
  state.street = next

  if (next === 'showdown') {
    state.phase = 'showdown'
    return next
  }

  shoe.draw() // burn card
  if (next === 'flop') {
    state.board = shoe.drawMany(3)
    log(state, `Flop: ${state.board.map(cardCode).join(' ')}`)
    if (!state.isBombPot && isMonotone(state.board)) {
      state.suitedFlopTriggered = true
      log(state, 'All three flop cards are the same suit — next hand is a BOMB POT!', 'bomb')
    }
  } else {
    state.board.push(shoe.draw())
    log(state, `${next === 'turn' ? 'Turn' : 'River'}: ${cardCode(state.board[state.board.length - 1])}`)
  }

  if (isRunout(state)) {
    // Nobody can bet; keep dealing until the board is out.
    state.phase = 'street'
    for (const p of handPlayers(state)) p.lastAction = null
  } else {
    openBettingRound(state)
  }
  return next
}

export function isMonotone(board: Card[]): boolean {
  return board.length >= 3 && board.slice(0, 3).every((c) => c.suit === board[0].suit)
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------

/** Split the money into a main pot and any side pots. */
export function buildPots(state: HandState): Pot[] {
  const players = handPlayers(state).filter((p) => p.committedHand > 0)
  if (players.length === 0) return []

  const levels = [...new Set(players.map((p) => p.committedHand))].sort((a, b) => a - b)
  const pots: Pot[] = []
  let previous = 0

  for (const level of levels) {
    let amount = 0
    for (const p of players) {
      amount += Math.min(p.committedHand, level) - Math.min(p.committedHand, previous)
    }
    const eligible = players.filter((p) => !p.folded && p.committedHand >= level).map((p) => p.seat)
    previous = level
    if (amount === 0) continue

    const last = pots[pots.length - 1]
    // Fold dead levels and identical-eligibility levels into the pot below them.
    if (last && (eligible.length === 0 || sameSeats(last.eligible, eligible))) {
      last.amount += amount
    } else {
      pots.push({ amount, eligible, label: '' })
    }
  }

  pots.forEach((pot, i) => {
    pot.label = i === 0 ? 'Main pot' : `Side pot ${i}`
  })
  return pots
}

function sameSeats(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

/** Best hand for a seat given the current board. */
export function bestHand(state: HandState, seat: number): HandValue | null {
  const p = state.players[seat]
  const cards = [...p.hole, ...state.board]
  if (cards.length < 5) return null
  return evaluate(cards)
}

// ---------------------------------------------------------------------------
// Showdown
// ---------------------------------------------------------------------------

export interface DexterCandidate {
  seat: number
  hole: Card[]
  dexterNumber: number
  perPlayer: number
  total: number
  payers: number[]
}

/**
 * Award the pots. `tableSeats` is every seat at the table (not just this hand)
 * because a Dexter is paid by everyone in the game, not only the hand.
 */
export function resolveShowdown(
  state: HandState,
  seats: Seat[],
  options: { dexterCount: number; tableSeats: number[] },
): void {
  state.pots = buildPots(state)
  const live = livePlayers(state)
  const awards: PotAward[] = []

  // Reveal rules: at a real showdown everyone still in turns their hand over.
  const isShowdown = live.length > 1
  if (isShowdown) for (const p of live) p.revealed = true

  for (const [index, pot] of state.pots.entries()) {
    const eligible = pot.eligible.filter((seat) => !state.players[seat].folded)
    if (eligible.length === 0) continue

    let winners: number[]
    let handValue: HandValue | null = null

    if (eligible.length === 1) {
      winners = eligible
      handValue = bestHand(state, eligible[0])
    } else {
      const scored = eligible.map((seat) => ({ seat, value: bestHand(state, seat)! }))
      const best = Math.max(...scored.map((s) => s.value.score))
      winners = scored.filter((s) => s.value.score === best).map((s) => s.seat)
      handValue = scored.find((s) => s.value.score === best)!.value
    }

    for (const [seat, amount] of splitPot(state, pot.amount, winners)) {
      seats[seat].stack += amount
      awards.push({
        potIndex: index,
        potLabel: pot.label,
        seat,
        amount,
        hand: winners.length > 1 || isShowdown ? handValue : null,
        split: winners.length > 1,
      })
    }
  }

  state.awards = awards

  for (const award of awards) {
    const who = name(seats, award.seat)
    const suffix = award.hand && (isShowdown || award.split)
      ? ` with ${describeHand(award.hand)}`
      : ''
    log(
      state,
      `${who} wins ${money(award.amount)}${state.pots.length > 1 ? ` (${award.potLabel})` : ''}${suffix}`,
      'win',
    )
  }

  const dexter = findDexter(state, seats, options)
  if (dexter) {
    state.pendingDexter = dexter
    state.phase = 'dexterShow'
  } else {
    state.phase = 'showdown'
    state.complete = true
  }
}

/** Even split down to the smallest chip; odd chips go left of the button first. */
function splitPot(state: HandState, amount: number, winners: number[]): [number, number][] {
  if (winners.length === 1) return [[winners[0], amount]]

  const units = Math.floor(amount / CHIP_INCREMENT)
  const each = Math.floor(units / winners.length) * CHIP_INCREMENT
  let remainder = amount - each * winners.length

  // Order winners clockwise from the button so the odd chip goes to the
  // first of them to the button's left, as in a live game.
  const clockwise = seatsAfter(state, state.buttonSeat).filter((s) => winners.includes(s))
  const result: [number, number][] = clockwise.map((seat) => [seat, each])

  let i = 0
  while (remainder > 0) {
    const step = Math.min(CHIP_INCREMENT, remainder)
    result[i % result.length][1] += step
    remainder -= step
    i++
  }
  return result
}

/**
 * Did somebody just win a Dexter? Requires 7-2 in the hole, a board that got
 * to the river, and a sole winner of the whole hand. A chop never counts.
 */
function findDexter(
  state: HandState,
  seats: Seat[],
  options: { dexterCount: number; tableSeats: number[] },
): DexterCandidate | null {
  if (state.board.length < 5) return null
  if (state.awards.some((a) => a.split)) return null

  const winners = new Set(state.awards.map((a) => a.seat))
  if (winners.size !== 1) return null

  const seat = [...winners][0]
  const hole = state.players[seat].hole
  if (!isDexterHand(hole)) return null
  if (seats[seat].sittingOut) return null

  const dexterNumber = options.dexterCount + 1
  const payers = options.tableSeats.filter((s) => s !== seat)
  const perPlayer = dexterPayPerPlayer(dexterNumber)

  return { seat, hole: [...hole], dexterNumber, perPlayer, total: perPlayer * payers.length, payers }
}

/** Exactly a 7 and a 2, any suits. */
export function isDexterHand(hole: Card[]): boolean {
  if (hole.length !== 2) return false
  const ranks = hole.map((c) => c.rank).sort((a, b) => b - a)
  return ranks[0] === DEXTER_RANKS[0] && ranks[1] === DEXTER_RANKS[1]
}

/**
 * The 7-2 winner either shows and collects, or mucks and waives the bonus.
 * Returns the claim if it was collected.
 */
export function settleDexter(state: HandState, seats: Seat[], show: boolean): DexterCandidate | null {
  const claim = state.pendingDexter
  state.pendingDexter = null
  state.phase = 'showdown'
  state.complete = true
  if (!claim) return null

  if (!show) {
    log(state, `${name(seats, claim.seat)} mucks and lets the Dexter go`, 'normal')
    return null
  }

  state.players[claim.seat].revealed = true

  // A short stack can only pay what it has in front of it.
  let collected = 0
  for (const payer of claim.payers) {
    const paid = Math.min(claim.perPlayer, seats[payer].stack)
    seats[payer].stack -= paid
    collected += paid
  }
  claim.total = collected
  seats[claim.seat].stack += collected
  state.dexter = claim

  const ordinal = ['', '1st', '2nd', '3rd'][claim.dexterNumber] ?? `${claim.dexterNumber}th`
  log(
    state,
    `DEXTER! ${name(seats, claim.seat)} shows ${claim.hole.map(cardCode).join(' ')} — ` +
      `${ordinal} of the night, everyone else pays ${money(claim.perPlayer)} ` +
      `(${money(claim.total)} total)`,
    'dexter',
  )
  return claim
}

export type { Phase }
