import type { Card } from './cards'
import type { HandValue } from './handEval'
import type { BombPotGame } from './bnotw'
import type { Persona } from './persona'

export type Variant = 'holdem' | 'pineapple' | 'crazyPineapple'

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise'

export interface Action {
  kind: ActionKind
  /** For bet/raise this is the total this player is at after acting. */
  amount?: number
}

/**
 * What the engine is waiting on.
 *  - `straddles`   pre-deal window for declaring straddles and re-straddles
 *  - `acting`      a player owes an action
 *  - `discard`     Crazy Pineapple: everyone still in must pitch one card
 *  - `street`      the betting round closed; the UI should deal the next street
 *  - `showdown`    cards are down, pots are awarded, hand is over
 *  - `dexterShow`  a 7-2 winner may show to collect
 */
export type Phase = 'straddles' | 'acting' | 'discard' | 'street' | 'dexterShow' | 'showdown'

export interface Seat {
  id: string
  name: string
  isHuman: boolean
  /** Seat index around the table; fixed for the life of the session. */
  seat: number
  stack: number
  /** How many buy-ins this player has taken, including the first. */
  buyIns: number
  /** Sat out because they busted and have not rebought. */
  sittingOut: boolean
  /** Who is in the seat: their face, skill and tendencies. */
  persona: Persona
}

export interface HandPlayer {
  seat: number
  hole: Card[]
  /** Card pitched in Crazy Pineapple, kept for the hand history. */
  discarded: Card | null
  folded: boolean
  allIn: boolean
  /** Has acted since the last bet or raise that reopened the action. */
  hasActed: boolean
  /** False after an all-in raise too small to reopen the betting. */
  canRaise: boolean
  /** Chips pushed in on the current street. */
  committedRound: number
  /** Chips pushed in across the whole hand. */
  committedHand: number
  /** Chips at the start of the hand, for the hand summary. */
  startingStack: number
  lastAction: string | null
  /** Cards face up at showdown. */
  revealed: boolean
  /** Posted a straddle, and for how much. */
  straddle: number
}

export interface Pot {
  amount: number
  /** Seats still eligible to win this pot. */
  eligible: number[]
  label: string
}

export interface PotAward {
  potIndex: number
  potLabel: string
  seat: number
  amount: number
  /** Null when everyone else folded and no hand was shown. */
  hand: HandValue | null
  split: boolean
}

export interface DexterClaim {
  seat: number
  /** Which Dexter of the night this is: 1st, 2nd, ... */
  dexterNumber: number
  /** What each other player at the table owes. */
  perPlayer: number
  total: number
  /** Seats paying, i.e. everyone at the table but the winner. */
  payers: number[]
  hole: Card[]
}

/**
 * One recorded event in the hand — every chip that moved and why.
 *
 * The log is prose for the player to read; this is the structured record the
 * replay is rebuilt from, so it has to be complete rather than readable.
 */
export interface JournalEntry {
  street: Street
  seat: number
  kind: ActionKind | 'blind' | 'straddle' | 'ante' | 'discard'
  /** Chips this event put into the pot. */
  amount: number
  /** What the player is at on this street once the event is done. */
  to: number
  /** Total in the middle afterwards. */
  pot: number
  /** The pitched card, for a Crazy Pineapple discard. */
  card?: string
  /** Left the player with nothing behind. */
  allIn?: boolean
}

export interface LogEntry {
  id: number
  street: Street | 'setup' | 'result'
  text: string
  /** Highlight class for the log line. */
  tone?: 'normal' | 'bnotw' | 'dexter' | 'bomb' | 'win'
}

export interface HandState {
  handNumber: number
  variant: Variant
  isBombPot: boolean
  bombGame: BombPotGame | null
  /** Why this hand is a bomb pot, shown in the banner. */
  bombReason: string | null
  buttonSeat: number
  smallBlindSeat: number | null
  bigBlindSeat: number | null
  street: Street
  phase: Phase
  board: Card[]
  players: Record<number, HandPlayer>
  /** Seat order for this hand, clockwise from the button. */
  order: number[]
  /** Total each player must have in on this street. */
  currentBet: number
  /** Size of the last full bet or raise; sets the minimum re-raise. */
  lastRaiseSize: number
  actingSeat: number | null
  /** Seats that still owe a Crazy Pineapple discard. */
  pendingDiscards: number[]
  straddles: { seat: number; amount: number }[]
  /** Seat that posted the largest forced bet; acts last preflop. */
  lastBlindSeat: number | null
  pots: Pot[]
  awards: PotAward[]
  /** Set once a 7-2 winner qualifies but has not yet chosen to show. */
  pendingDexter: DexterClaim | null
  dexter: DexterClaim | null
  /** True once the flop came monotone in a regular hand. */
  suitedFlopTriggered: boolean
  log: LogEntry[]
  /** Structured history, for replaying the hand afterwards. */
  journal: JournalEntry[]
  complete: boolean
}
