/**
 * The BNOTW Record Book.
 *
 * A running history of game nights that carries from game to game rather than
 * resetting. Every derived number (net profit, the High Roller Fee, who owes
 * the recap) is computed from the raw buy-ins and cash-outs, so editing a
 * cash-out re-settles the whole night.
 */

import {
  BUY_IN_CASH, BUY_IN_CHIPS, HIGH_ROLLER_FEE, HOUSE_CUT_PER_BUY_IN,
  owesHighRollerFee,
} from '../engine/bnotw'

export interface NightPlayer {
  id: string
  name: string
  /** Buy-ins including the first one, so this is never below 1. */
  buyIns: number
  /** Chips counted down at the end of the night, in cents. */
  cashOut: number
  /** Dexters this player won tonight. */
  dexterWins: number
}

export interface GameNight {
  id: string
  /** ISO date, yyyy-mm-dd. */
  date: string
  players: NightPlayer[]
  /** How high the Dexter ladder climbed by the end of the night. */
  finalDexterLevel: number
  recap: string
  createdAt: string
  updatedAt: string
  /** Whether this night came out of app play or was keyed in by hand. */
  source: 'app' | 'manual'
}

export interface PlayerSettlement extends NightPlayer {
  rebuys: number
  /** Cash handed over across the night: buy-ins x $42. */
  totalBuyInCash: number
  /** Chips received across the night: buy-ins x $40. */
  chipsIn: number
  /** The BNOTW figure: cash-out minus chips received. */
  netProfit: number
  highRollerFee: number
  /** What actually changed in their pocket, after the house's $2s and any fee. */
  pocketNet: number
  isHighRoller: boolean
  isBiggestWinner: boolean
}

export interface NightSettlement {
  night: GameNight
  players: PlayerSettlement[]
  /** Everyone tied for the largest net profit. Usually exactly one player. */
  biggestWinners: PlayerSettlement[]
  /** The player who owes the recap, or null if the night has no result yet. */
  recapAuthor: PlayerSettlement | null
  totalChipsIssued: number
  totalCashedOut: number
  /** Chips issued minus chips counted. Non-zero means the count is off. */
  chipDiscrepancy: number
  houseCut: number
  houseFees: number
  houseTotal: number
  totalDexters: number
}

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function todayISO(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function blankPlayer(name = ''): NightPlayer {
  return { id: makeId(), name, buyIns: 1, cashOut: 0, dexterWins: 0 }
}

export function blankNight(): GameNight {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    date: todayISO(),
    players: [],
    finalDexterLevel: 0,
    recap: '',
    createdAt: now,
    updatedAt: now,
    source: 'manual',
  }
}

/** Work out every derived number for a night. */
export function settleNight(night: GameNight): NightSettlement {
  const players: PlayerSettlement[] = night.players.map((p) => {
    const buyIns = Math.max(1, Math.round(p.buyIns))
    const chipsIn = buyIns * BUY_IN_CHIPS
    const netProfit = p.cashOut - chipsIn
    const isHighRoller = owesHighRollerFee(netProfit)
    const highRollerFee = isHighRoller ? HIGH_ROLLER_FEE : 0
    return {
      ...p,
      buyIns,
      rebuys: buyIns - 1,
      totalBuyInCash: buyIns * BUY_IN_CASH,
      chipsIn,
      netProfit,
      highRollerFee,
      pocketNet: p.cashOut - buyIns * BUY_IN_CASH - highRollerFee,
      isHighRoller,
      isBiggestWinner: false,
    }
  })

  // The night's winner is the largest net profit. A tie means nobody gets to
  // duck the recap, so both names come back.
  let biggestWinners: PlayerSettlement[] = []
  if (players.length > 0) {
    const best = Math.max(...players.map((p) => p.netProfit))
    biggestWinners = players.filter((p) => p.netProfit === best)
    for (const winner of biggestWinners) winner.isBiggestWinner = true
  }

  const totalChipsIssued = players.reduce((s, p) => s + p.chipsIn, 0)
  const totalCashedOut = players.reduce((s, p) => s + p.cashOut, 0)
  const houseCut = players.reduce((s, p) => s + p.buyIns * HOUSE_CUT_PER_BUY_IN, 0)
  const houseFees = players.reduce((s, p) => s + p.highRollerFee, 0)

  return {
    night,
    players,
    biggestWinners,
    recapAuthor: biggestWinners.length === 1 ? biggestWinners[0] : (biggestWinners[0] ?? null),
    totalChipsIssued,
    totalCashedOut,
    chipDiscrepancy: totalChipsIssued - totalCashedOut,
    houseCut,
    houseFees,
    houseTotal: houseCut + houseFees,
    totalDexters: players.reduce((s, p) => s + p.dexterWins, 0),
  }
}

// ---------------------------------------------------------------------------
// Lifetime standings
// ---------------------------------------------------------------------------

export interface CareerRow {
  name: string
  nights: number
  totalBuyIns: number
  rebuys: number
  totalBuyInCash: number
  totalCashOut: number
  lifetimeNet: number
  bestNight: number
  worstNight: number
  dexterWins: number
  highRollerFees: number
  nightsWon: number
  recapsOwed: number
}

/** Roll every night up into an all-time table, newest data included. */
export function careerStandings(nights: GameNight[]): CareerRow[] {
  const rows = new Map<string, CareerRow>()

  for (const night of nights) {
    const settlement = settleNight(night)
    for (const p of settlement.players) {
      const key = p.name.trim().toLowerCase()
      if (!key) continue
      const row = rows.get(key) ?? {
        name: p.name.trim(),
        nights: 0,
        totalBuyIns: 0,
        rebuys: 0,
        totalBuyInCash: 0,
        totalCashOut: 0,
        lifetimeNet: 0,
        bestNight: -Infinity,
        worstNight: Infinity,
        dexterWins: 0,
        highRollerFees: 0,
        nightsWon: 0,
        recapsOwed: 0,
      }
      row.nights += 1
      row.totalBuyIns += p.buyIns
      row.rebuys += p.rebuys
      row.totalBuyInCash += p.totalBuyInCash
      row.totalCashOut += p.cashOut
      row.lifetimeNet += p.netProfit
      row.bestNight = Math.max(row.bestNight, p.netProfit)
      row.worstNight = Math.min(row.worstNight, p.netProfit)
      row.dexterWins += p.dexterWins
      row.highRollerFees += p.highRollerFee
      if (p.isBiggestWinner) row.nightsWon += 1
      if (p.isBiggestWinner && !night.recap.trim()) row.recapsOwed += 1
      rows.set(key, row)
    }
  }

  return [...rows.values()]
    .map((r) => ({
      ...r,
      bestNight: Number.isFinite(r.bestNight) ? r.bestNight : 0,
      worstNight: Number.isFinite(r.worstNight) ? r.worstNight : 0,
    }))
    .sort((a, b) => b.lifetimeNet - a.lifetimeNet)
}

export interface BookTotals {
  nights: number
  players: number
  handsOfHistory: number
  totalDexters: number
  houseTotal: number
  biggestSingleNight: { name: string; amount: number; date: string } | null
}

export function bookTotals(nights: GameNight[]): BookTotals {
  let houseTotal = 0
  let totalDexters = 0
  let biggest: BookTotals['biggestSingleNight'] = null
  const names = new Set<string>()

  for (const night of nights) {
    const s = settleNight(night)
    houseTotal += s.houseTotal
    totalDexters += s.totalDexters
    for (const p of s.players) {
      if (p.name.trim()) names.add(p.name.trim().toLowerCase())
      if (!biggest || p.netProfit > biggest.amount) {
        biggest = { name: p.name, amount: p.netProfit, date: night.date }
      }
    }
  }

  return {
    nights: nights.length,
    players: names.size,
    handsOfHistory: 0,
    totalDexters,
    houseTotal,
    biggestSingleNight: biggest,
  }
}

/** Sort nights newest first. */
export function sortNights(nights: GameNight[]): GameNight[] {
  return [...nights].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 :
    (a.createdAt < b.createdAt ? 1 : -1)))
}
