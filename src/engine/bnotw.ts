/**
 * BNOTW house rules, expressed as constants and small pure helpers.
 *
 * All money is handled as whole cents. Every amount in the game is a multiple
 * of 25 cents (the green chip), so integer cents keeps arithmetic exact and
 * avoids floating-point drift on things like a $1.75 Bob-aloo.
 */

export const CENTS = 100

/** Chip denominations issued at buy-in. */
export interface ChipDenomination {
  color: string
  label: string
  /** Chip value in cents. */
  value: number
  /** How many are in a fresh buy-in stack. */
  quantity: number
  /** CSS colours for the chip graphic. */
  face: string
  edge: string
  ink: string
}

export const CHIP_SET: ChipDenomination[] = [
  { color: 'black', label: 'Black', value: 500, quantity: 5, face: '#17181c', edge: '#3c3f46', ink: '#f5f5f5' },
  { color: 'white', label: 'White', value: 100, quantity: 10, face: '#f2f2ef', edge: '#c9c9c2', ink: '#1c1c1c' },
  { color: 'red', label: 'Red', value: 50, quantity: 6, face: '#b3272d', edge: '#7d1a1f', ink: '#fff6f6' },
  { color: 'green', label: 'Green', value: 25, quantity: 8, face: '#1f7a4d', edge: '#125635', ink: '#f2fff8' },
]

/** $42 leaves the pocket. */
export const BUY_IN_CASH = 42 * CENTS
/** $40 of it comes back as chips. */
export const BUY_IN_CHIPS = 40 * CENTS
/** The other $2 goes to the house for game-night expenses. */
export const HOUSE_CUT_PER_BUY_IN = BUY_IN_CASH - BUY_IN_CHIPS

export const SMALL_BLIND = 25
export const BIG_BLIND = 50

/** The smallest chip in play; every bet is a multiple of it. */
export const CHIP_INCREMENT = 25

/** Named bets. These are nicknames for amounts, nothing more. */
export interface NamedBet {
  name: string
  amount: number
  breakdown: string
}

export const NAMED_BETS: NamedBet[] = [
  { name: 'Bob-aloo', amount: 175, breakdown: '1 White + 1 Red + 1 Green' },
  { name: 'Dave-aloo', amount: 675, breakdown: '1 Black + 1 White + 1 Red + 1 Green' },
]

/** Profit above this earns the High Roller Fee. Strictly greater than $100. */
export const HIGH_ROLLER_THRESHOLD = 100 * CENTS
export const HIGH_ROLLER_FEE = 5 * CENTS

/** Bomb pot flavours and their antes. */
export const BOMB_POT_GAMES = {
  pineapple: { name: 'Pineapple', ante: 2 * CENTS, holeCards: 2, discardAfterFlop: false },
  crazyPineapple: { name: 'Crazy Pineapple', ante: 3 * CENTS, holeCards: 3, discardAfterFlop: true },
} as const

export type BombPotGame = keyof typeof BOMB_POT_GAMES

/** Scheduled bomb pots run roughly every 30 minutes of table time. */
export const BOMB_POT_INTERVAL_MINUTES = 30

/** The Dexter: hole cards of 7 and 2, named for Dexter Manley's #72. */
export const DEXTER_RANKS: [number, number] = [7, 2]

/**
 * What each *other* player owes the winner of the nth successful Dexter.
 * 1st is $1, 2nd is $2, and so on with no cap.
 */
export function dexterPayPerPlayer(dexterNumber: number): number {
  return Math.max(0, dexterNumber) * CENTS
}

/** Total the table hands over for the nth Dexter, with `tablePlayers` seated. */
export function dexterTotalBonus(dexterNumber: number, tablePlayers: number): number {
  return dexterPayPerPlayer(dexterNumber) * Math.max(0, tablePlayers - 1)
}

/** Does this net profit owe the House the High Roller Fee? */
export function owesHighRollerFee(netProfitCents: number): boolean {
  return netProfitCents > HIGH_ROLLER_THRESHOLD
}

/** Format cents as a dollar string: 175 -> "$1.75". */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Same as `money` but keeps an explicit + for positive results. */
export function signedMoney(cents: number): string {
  return cents > 0 ? `+${money(cents)}` : money(cents)
}

/** Parse "12", "$12.50", "1.75" into cents. Returns null if unparseable. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

/** Round a bet down to a whole number of the smallest chip in play. */
export function toChipIncrement(cents: number): number {
  return Math.floor(cents / CHIP_INCREMENT) * CHIP_INCREMENT
}

/** Greedy breakdown of an amount into BNOTW chips, largest first. */
export function chipBreakdown(cents: number): { chip: ChipDenomination; count: number }[] {
  let left = cents
  const out: { chip: ChipDenomination; count: number }[] = []
  for (const chip of CHIP_SET) {
    const count = Math.floor(left / chip.value)
    if (count > 0) {
      out.push({ chip, count })
      left -= count * chip.value
    }
  }
  return out
}

/** Name a bet if BNOTW has one for that exact amount. */
export function namedBetFor(cents: number): NamedBet | undefined {
  return NAMED_BETS.find((b) => b.amount === cents)
}
