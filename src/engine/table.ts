/**
 * The table: everything that outlives a single hand.
 *
 * Owns the seats and their stacks, the dealer button (including the special
 * BNOTW bomb-pot button rules), bomb-pot scheduling, the progressive Dexter
 * counter, and the night's running ledger.
 */

import { Shoe, mulberry32, type Rng } from './cards'
import {
  BOMB_POT_GAMES, BUY_IN_CHIPS, BOMB_POT_INTERVAL_MINUTES, type BombPotGame,
} from './bnotw'
import {
  addStraddle, advanceStreet, applyAction, applyDiscard, createHand, dealHand,
  livePlayers, resolveShowdown, settleDexter, straddleCandidates,
} from './hand'
import { defaultRoster, personaFromArchetype, type Persona } from './persona'
import type { PlayMode } from './playerStats'
import type { Action, HandState, Seat, Street, Variant } from './types'

export type BombPotTrigger = 'time' | 'hands' | 'off'

export interface TableSettings {
  playerName: string
  /** Your own face at the table. */
  playerPersona?: Persona
  /**
   * Who is sitting down as an opponent. When empty, the first `botCount`
   * regulars from the default roster take the seats.
   */
  opponents: Persona[]
  /** Fallback table size when no opponents are named. */
  botCount: number
  bombPotTrigger: BombPotTrigger
  bombPotMinutes: number
  bombPotHands: number
  /** Whose call the bomb-pot game is. 'dealer' lets the app pick at random. */
  bombPotGameChoice: 'dealer' | 'pineapple' | 'crazyPineapple'
  /** Scales every persona's own straddle tendency; 0 turns straddles off. */
  straddleMultiplier: number
  /** Bots rebuy without being asked; there is no shame in a rebuy. */
  botAutoRebuy: boolean
}

export const DEFAULT_SETTINGS: TableSettings = {
  playerName: 'You',
  opponents: [],
  botCount: 5,
  bombPotTrigger: 'hands',
  bombPotMinutes: BOMB_POT_INTERVAL_MINUTES,
  bombPotHands: 12,
  bombPotGameChoice: 'dealer',
  straddleMultiplier: 1,
  botAutoRebuy: true,
}

export interface DexterRecord {
  handNumber: number
  seat: number
  playerName: string
  dexterNumber: number
  perPlayer: number
  total: number
}

/**
 * A session, frozen between hands.
 *
 * Everything here outlives a hand; a hand in progress deliberately does not
 * survive. Restoring mid-hand would mean rebuilding the shoe, the betting
 * round and whose turn it is from a serialised form — far more machinery, and
 * more ways to be subtly wrong, than dropping one hand is worth. The stacks
 * are as they were before it was dealt, so nothing is lost but the deal.
 */
export interface TableSnapshot {
  version: 1
  savedAt: number
  /**
   * Which table this was. Coach mode keeps its own session and must never be
   * mistaken for a night that owes anybody money, so the record says what it
   * is rather than relying on which key it happened to be filed under.
   */
  mode: PlayMode
  seats: Seat[]
  handNumber: number
  handsPlayed: number
  dexterCount: number
  dexterLog: DexterRecord[]
  regularButtonSeat: number
  bombRunLength: number
  pendingBomb: string | null
  handsSinceBomb: number
  startedAt: number
}

export class Table {
  seats: Seat[] = []
  hand: HandState | null = null
  handNumber = 0
  settings: TableSettings
  /** How many Dexters have been paid tonight; sets the next bonus level. */
  dexterCount = 0
  dexterLog: DexterRecord[] = []
  /** Button position for the regular rotation. Bomb pots never advance it. */
  regularButtonSeat = 0
  /** How many bomb pots have run back to back without a regular hand between. */
  bombRunLength = 0
  /** Set when the next hand must be a bomb pot, with the reason why. */
  pendingBomb: string | null = null
  handsSinceBomb = 0
  lastBombAt: number = Date.now()
  startedAt: number = Date.now()
  handsPlayed = 0

  private shoe: Shoe | null = null
  private rng: Rng
  private version = 0
  private listeners = new Set<() => void>()

  constructor(settings: Partial<TableSettings> = {}, seed?: number) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    this.rng = seed === undefined ? Math.random : mulberry32(seed)
    this.reset()
  }

  // -- store plumbing -------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = (): number => this.version

  /** Bump the version so React re-renders against the mutated state. */
  private touch() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  // -- setup ----------------------------------------------------------------

  reset(settings?: Partial<TableSettings>) {
    if (settings) this.settings = { ...this.settings, ...settings }
    const named = this.settings.opponents ?? []
    const bots = (named.length > 0 ? named : defaultRoster())
      .slice(0, Math.max(1, Math.min(8, named.length || this.settings.botCount)))

    const you = this.settings.playerPersona
      ?? personaFromArchetype(this.settings.playerName || 'You', 'grinder', 'you')

    this.seats = [
      {
        id: 'you',
        name: this.settings.playerName || you.name,
        isHuman: true,
        seat: 0,
        stack: BUY_IN_CHIPS,
        buyIns: 1,
        sittingOut: false,
        persona: { ...you, name: this.settings.playerName || you.name },
      },
      ...bots.map((persona, i) => ({
        id: persona.id,
        name: persona.name,
        isHuman: false,
        seat: i + 1,
        stack: BUY_IN_CHIPS,
        buyIns: 1,
        sittingOut: false,
        persona,
      })),
    ]

    this.hand = null
    this.handNumber = 0
    this.handsPlayed = 0
    this.dexterCount = 0
    this.dexterLog = []
    this.regularButtonSeat = this.seats.length - 1
    this.bombRunLength = 0
    this.pendingBomb = null
    this.handsSinceBomb = 0
    this.lastBombAt = Date.now()
    this.startedAt = Date.now()
    this.touch()
  }

  get human(): Seat {
    return this.seats[0]
  }

  /** Seats with chips in front of them, ready to be dealt in. */
  activeSeats(): number[] {
    return this.seats.filter((s) => !s.sittingOut && s.stack > 0).map((s) => s.seat)
  }

  // -- bomb pot scheduling --------------------------------------------------

  /** Is the next hand due to be a bomb pot, and why? */
  bombPotDue(): string | null {
    if (this.pendingBomb) return this.pendingBomb
    const { bombPotTrigger, bombPotMinutes, bombPotHands } = this.settings
    if (bombPotTrigger === 'off') return null
    if (bombPotTrigger === 'time') {
      const elapsed = (Date.now() - this.lastBombAt) / 60000
      return elapsed >= bombPotMinutes ? `Scheduled — every ${bombPotMinutes} minutes` : null
    }
    return this.handsSinceBomb >= bombPotHands
      ? `Scheduled — every ${bombPotHands} hands`
      : null
  }

  private chooseBombGame(): BombPotGame {
    const choice = this.settings.bombPotGameChoice
    if (choice !== 'dealer') return choice
    return this.rng() < 0.5 ? 'pineapple' : 'crazyPineapple'
  }

  /** Can everyone dealt in actually cover the ante? */
  private canAffordBomb(game: BombPotGame, seats: number[]): boolean {
    const ante = BOMB_POT_GAMES[game].ante
    return seats.filter((s) => this.seats[s].stack >= ante).length >= 2
  }

  // -- the button -----------------------------------------------------------

  private nextOccupied(from: number, steps: number, active: number[]): number {
    if (active.length === 0) return from
    // Find the first active seat at or after `from`, then step forward.
    let index = active.findIndex((s) => s > from)
    if (index === -1) index = 0
    return active[(index + steps) % active.length]
  }

  /**
   * Where the button sits for the hand about to be dealt.
   *
   * A bomb pot is an extra hand: it never consumes a turn on the button. The
   * first bomb pot of a run keeps the button exactly where the last regular
   * hand left it; each back-to-back bomb pot after that moves it forward one,
   * and once the run ends the regular rotation carries on from where it was.
   */
  private buttonForHand(isBomb: boolean, active: number[]): number {
    if (isBomb) {
      const anchor = active.includes(this.regularButtonSeat)
        ? this.regularButtonSeat
        : this.nextOccupied(this.regularButtonSeat, 0, active)
      if (this.bombRunLength === 0) return anchor
      const index = active.indexOf(anchor)
      return active[(index + this.bombRunLength) % active.length]
    }
    return this.nextOccupied(this.regularButtonSeat, 0, active)
  }

  // -- running a hand -------------------------------------------------------

  /** Deal the next hand. Returns the new hand state. */
  startHand(): HandState {
    const active = this.activeSeats()
    if (active.length < 2) throw new Error('Need at least two players with chips')

    const reason = this.bombPotDue()
    let variant: Variant = 'holdem'
    let bombGame: BombPotGame | null = null
    let bombReason: string | null = null

    if (reason) {
      const game = this.chooseBombGame()
      if (this.canAffordBomb(game, active)) {
        variant = game
        bombGame = game
        bombReason = reason
      }
    }

    const isBomb = variant !== 'holdem'
    const buttonSeat = this.buttonForHand(isBomb, active)
    if (!isBomb) this.regularButtonSeat = buttonSeat

    // Deal clockwise starting to the button's left.
    const buttonIndex = active.indexOf(buttonSeat)
    const order = [
      ...active.slice(buttonIndex + 1),
      ...active.slice(0, buttonIndex + 1),
    ]

    this.handNumber++
    this.shoe = new Shoe(this.rng)
    this.hand = createHand({
      handNumber: this.handNumber,
      seats: this.seats,
      order,
      buttonSeat,
      variant,
      bombGame,
      bombReason,
    })

    if (isBomb) {
      this.bombRunLength++
      this.pendingBomb = null
      this.handsSinceBomb = 0
      this.lastBombAt = Date.now()
      // Bomb pots skip the straddle window and deal straight away.
      dealHand(this.hand, this.seats, this.shoe)
    } else {
      this.bombRunLength = 0
      this.handsSinceBomb++
      this.declareBotStraddles()
    }

    this.touch()
    return this.hand
  }

  /**
   * Bots decide on straddles before anybody looks at a card. Each one rolls
   * against their own straddle tendency, so the table's appetite for a
   * straddle follows from who is actually sitting in it.
   */
  private declareBotStraddles() {
    const hand = this.hand!
    const multiplier = this.settings.straddleMultiplier
    if (multiplier <= 0) return
    // Cap the chain so a run of re-straddles cannot eat the whole table.
    for (let round = 0; round < 3; round++) {
      const candidates = straddleCandidates(hand, this.seats).filter(
        (seat) => !this.seats[seat].isHuman,
      )
      if (candidates.length === 0) return
      const keen = candidates.filter((seat) => {
        const appetite = this.seats[seat].persona.tendencies.straddle / 100
        // Each re-straddle is a bigger ask than the last.
        return this.rng() < (appetite * multiplier) / (round + 1)
      })
      if (keen.length === 0) return
      addStraddle(hand, this.seats, keen[Math.floor(this.rng() * keen.length)])
    }
  }

  humanCanStraddle(): boolean {
    const hand = this.hand
    if (!hand || hand.phase !== 'straddles') return false
    return straddleCandidates(hand, this.seats).includes(this.human.seat)
  }

  straddle() {
    const hand = this.hand
    if (!hand) return
    addStraddle(hand, this.seats, this.human.seat)
    this.declareBotStraddles()
    this.touch()
  }

  /** Close the straddle window and put the cards in the air. */
  closeStraddles() {
    const hand = this.hand
    if (!hand || hand.phase !== 'straddles') return
    dealHand(hand, this.seats, this.shoe!)
    this.touch()
  }

  act(seat: number, action: Action) {
    applyAction(this.hand!, this.seats, seat, action)
    this.touch()
  }

  discard(seat: number, cardIndex: number) {
    applyDiscard(this.hand!, seat, cardIndex)
    this.touch()
  }

  /** Deal the next street, or run the showdown when the river is done. */
  advance(): Street | 'showdown' {
    const hand = this.hand!
    const street = advanceStreet(hand, this.shoe!)
    if (hand.phase === 'showdown') {
      resolveShowdown(hand, this.seats, {
        dexterCount: this.dexterCount,
        tableSeats: this.seats.filter((s) => !s.sittingOut).map((s) => s.seat),
      })
      // A hand that never reached a showdown still resolves; the last player
      // standing simply takes it down.
      if (livePlayers(hand).length === 1 && hand.awards.length === 0) {
        throw new Error('Pot was not awarded')
      }
    }
    this.touch()
    return street
  }

  /** The 7-2 winner shows (and collects) or mucks (and waives the bonus). */
  resolveDexter(show: boolean) {
    const hand = this.hand!
    const claim = settleDexter(hand, this.seats, show)
    if (claim) {
      this.dexterCount++
      this.dexterLog.push({
        handNumber: hand.handNumber,
        seat: claim.seat,
        playerName: this.seats[claim.seat].name,
        dexterNumber: claim.dexterNumber,
        perPlayer: claim.perPlayer,
        total: claim.total,
      })
    }
    this.touch()
  }

  /** Book-keeping once a hand is fully settled. */
  finishHand() {
    const hand = this.hand
    if (!hand) return
    this.handsPlayed++
    if (hand.suitedFlopTriggered) {
      this.pendingBomb = 'Suited flop — all three the same suit'
    }
    for (const seat of this.seats) {
      if (seat.stack <= 0) seat.sittingOut = true
    }
    if (this.settings.botAutoRebuy) {
      for (const seat of this.seats) {
        if (!seat.isHuman && seat.sittingOut) this.rebuy(seat.seat)
      }
    }
    this.touch()
  }

  rebuy(seat: number) {
    const player = this.seats[seat]
    player.stack += BUY_IN_CHIPS
    player.buyIns++
    player.sittingOut = false
    this.touch()
  }

  /** Sit a busted player out for good rather than rebuying. */
  sitOut(seat: number) {
    this.seats[seat].sittingOut = true
    this.touch()
  }

  elapsedMinutes(): number {
    return (Date.now() - this.startedAt) / 60000
  }

  // -- surviving the app being closed ---------------------------------------

  /** Freeze what outlives a hand. Safe to call at any time; the hand is not kept. */
  snapshot(mode: PlayMode = 'table'): TableSnapshot {
    return {
      version: 1,
      savedAt: Date.now(),
      mode,
      // Structured-cloned rather than referenced: the caller is about to
      // serialise this, and the live seats keep mutating underneath it.
      seats: this.seats.map((seat) => ({ ...seat, persona: { ...seat.persona } })),
      handNumber: this.handNumber,
      handsPlayed: this.handsPlayed,
      dexterCount: this.dexterCount,
      dexterLog: this.dexterLog.map((d) => ({ ...d })),
      regularButtonSeat: this.regularButtonSeat,
      bombRunLength: this.bombRunLength,
      pendingBomb: this.pendingBomb,
      handsSinceBomb: this.handsSinceBomb,
      startedAt: this.startedAt,
    }
  }

  /**
   * Put a frozen session back. Returns false if the snapshot is unusable, in
   * which case the table is untouched and play starts fresh — a corrupt
   * restore that half-applies would be worse than no restore at all.
   */
  restore(snapshot: TableSnapshot | null | undefined, expect: PlayMode = 'table'): boolean {
    if (!snapshot || snapshot.version !== 1) return false
    // Snapshots written before coach mode was saved carry no mode; they were
    // all real tables, so that is what an absent one means.
    if ((snapshot.mode ?? 'table') !== expect) return false
    if (!Array.isArray(snapshot.seats) || snapshot.seats.length < 2) return false

    const seats = snapshot.seats.map((seat, i) => ({
      id: String(seat?.id ?? `seat-${i}`),
      name: String(seat?.name ?? `Seat ${i}`),
      isHuman: seat?.isHuman === true,
      seat: i,
      stack: num(seat?.stack, 0),
      buyIns: Math.max(1, Math.round(num(seat?.buyIns, 1))),
      sittingOut: seat?.sittingOut === true,
      persona: seat?.persona,
    }))
    // Seat 0 is the human everywhere else in the engine; a snapshot that does
    // not agree is not one of ours.
    if (!seats[0].isHuman || seats.some((s) => !s.persona)) return false

    this.seats = seats as Seat[]
    this.hand = null
    this.handNumber = Math.max(0, Math.round(num(snapshot.handNumber, 0)))
    this.handsPlayed = Math.max(0, Math.round(num(snapshot.handsPlayed, 0)))
    this.dexterCount = Math.max(0, Math.round(num(snapshot.dexterCount, 0)))
    this.dexterLog = Array.isArray(snapshot.dexterLog) ? snapshot.dexterLog : []
    this.regularButtonSeat = clampSeat(snapshot.regularButtonSeat, seats.length)
    this.bombRunLength = Math.max(0, Math.round(num(snapshot.bombRunLength, 0)))
    this.pendingBomb = typeof snapshot.pendingBomb === 'string' ? snapshot.pendingBomb : null
    this.handsSinceBomb = Math.max(0, Math.round(num(snapshot.handsSinceBomb, 0)))
    this.startedAt = num(snapshot.startedAt, Date.now())
    // Deliberately re-anchored to now rather than restored. A time-triggered
    // bomb pot measures from the last one, and reopening the app a day later
    // should not owe you a bomb pot on the first hand back.
    this.lastBombAt = Date.now()
    this.touch()
    return true
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampSeat(value: unknown, count: number): number {
  const n = Math.round(num(value, 0))
  return n >= 0 && n < count ? n : 0
}
