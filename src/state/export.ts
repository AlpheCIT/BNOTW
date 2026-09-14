/** Turning the Record Book into things you can email, print or open in Excel. */

import { money, signedMoney } from '../engine/bnotw'
import { careerStandings, settleNight, sortNights, type GameNight } from './records'

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRows(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

/** Dollars without the sign fuss, for spreadsheet columns. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** One row per player per night — the running record, in full. */
export function recordBookCsv(nights: GameNight[]): string {
  const header = [
    'Date', 'Player', 'Buy-Ins', 'Rebuys', 'Total Buy-In (cash)', 'Chips Received',
    'Final Cash-Out', 'Net Profit/Loss', 'High Roller Fee', 'Biggest Winner',
    'Dexter Wins', 'Final Dexter Level', 'Game Recap',
  ]
  const rows: (string | number)[][] = [header]

  for (const night of sortNights(nights)) {
    const settlement = settleNight(night)
    for (const p of settlement.players) {
      rows.push([
        night.date,
        p.name,
        p.buyIns,
        p.rebuys,
        dollars(p.totalBuyInCash),
        dollars(p.chipsIn),
        dollars(p.cashOut),
        dollars(p.netProfit),
        dollars(p.highRollerFee),
        p.isBiggestWinner ? 'YES' : '',
        p.dexterWins,
        night.finalDexterLevel,
        p.isBiggestWinner ? night.recap.replace(/\s+/g, ' ').trim() : '',
      ])
    }
  }
  return csvRows(rows)
}

/** The all-time standings, one row per player. */
export function careerCsv(nights: GameNight[]): string {
  const header = [
    'Player', 'Nights', 'Buy-Ins', 'Rebuys', 'Total Buy-In (cash)', 'Total Cash-Out',
    'Lifetime Net', 'Best Night', 'Worst Night', 'Dexter Wins', 'High Roller Fees',
    'Nights Won',
  ]
  const rows: (string | number)[][] = [header]
  for (const row of careerStandings(nights)) {
    rows.push([
      row.name, row.nights, row.totalBuyIns, row.rebuys, dollars(row.totalBuyInCash),
      dollars(row.totalCashOut), dollars(row.lifetimeNet), dollars(row.bestNight),
      dollars(row.worstNight), row.dexterWins, dollars(row.highRollerFees), row.nightsWon,
    ])
  }
  return csvRows(rows)
}

/** The recap email the night's biggest winner owes the group. */
export function recapEmail(night: GameNight): { subject: string; body: string } {
  const settlement = settleNight(night)
  const winner = settlement.recapAuthor

  const lines: string[] = []
  lines.push(`BNOTW — ${formatDate(night.date)}`)
  lines.push('')

  if (winner) {
    lines.push(`Biggest winner: ${winner.name} (${signedMoney(winner.netProfit)})`)
  }
  if (settlement.totalDexters > 0) {
    lines.push(
      `Dexters: ${settlement.totalDexters} — the ladder finished at $${night.finalDexterLevel}`,
    )
  }
  lines.push('')
  lines.push('RESULTS')
  lines.push('-------')

  const ranked = [...settlement.players].sort((a, b) => b.netProfit - a.netProfit)
  const width = Math.max(6, ...ranked.map((p) => p.name.length))
  for (const p of ranked) {
    const tags = [
      p.rebuys > 0 ? `${p.rebuys} rebuy${p.rebuys > 1 ? 's' : ''}` : '',
      p.dexterWins > 0 ? `${p.dexterWins} Dexter${p.dexterWins > 1 ? 's' : ''}` : '',
      p.isHighRoller ? 'HIGH ROLLER (-$5)' : '',
    ].filter(Boolean)
    lines.push(
      `${p.name.padEnd(width)}  in ${money(p.totalBuyInCash).padStart(7)}` +
        `  out ${money(p.cashOut).padStart(7)}` +
        `  net ${signedMoney(p.netProfit).padStart(8)}` +
        (tags.length ? `   ${tags.join(', ')}` : ''),
    )
  }

  lines.push('')
  lines.push(`House: ${money(settlement.houseTotal)} ` +
    `(${money(settlement.houseCut)} from buy-ins, ${money(settlement.houseFees)} in High Roller Fees)`)

  if (settlement.chipDiscrepancy !== 0) {
    lines.push(
      `Note: chip count is off by ${money(Math.abs(settlement.chipDiscrepancy))} ` +
        `(${settlement.chipDiscrepancy > 0 ? 'short' : 'over'}).`,
    )
  }

  lines.push('')
  lines.push('THE RECAP')
  lines.push('---------')
  lines.push(night.recap.trim() || '(still owed)')
  lines.push('')
  lines.push('Win big. Pay the house. Write the recap.')

  return {
    subject: `BNOTW Recap — ${formatDate(night.date)}`,
    body: lines.join('\n'),
  }
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function mailtoLink(night: GameNight): string {
  const { subject, body } = recapEmail(night)
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
