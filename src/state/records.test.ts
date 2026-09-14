import { describe, it, expect } from 'vitest'
import { careerStandings, settleNight, blankNight, type GameNight } from './records'
import { recordBookCsv, recapEmail } from './export'
import { mergeNights, parseImport } from './storage'

function night(date: string, players: [string, number, number, number?][]): GameNight {
  return {
    ...blankNight(),
    id: `n-${date}`,
    date,
    finalDexterLevel: 0,
    players: players.map(([name, buyIns, cashOut, dexters], i) => ({
      id: `${date}-${i}`,
      name,
      buyIns,
      cashOut,
      dexterWins: dexters ?? 0,
    })),
  }
}

describe('settling a night', () => {
  it('matches the worked examples in the house rules', () => {
    // "$40 in, cashed out $145 = $105 profit -> $5 High Roller Fee"
    // "$80 in after a rebuy, cashed out $175 = $95 profit -> no fee"
    const settlement = settleNight(night('2026-01-09', [
      ['Richard', 1, 14500],
      ['Bob', 2, 17500],
      ['Dave', 1, 0],
      ['Sully', 1, 3000],
    ]))

    const richard = settlement.players[0]
    expect(richard.netProfit).toBe(10500)
    expect(richard.isHighRoller).toBe(true)
    expect(richard.highRollerFee).toBe(500)
    expect(richard.totalBuyInCash).toBe(4200)

    const bob = settlement.players[1]
    expect(bob.rebuys).toBe(1)
    expect(bob.chipsIn).toBe(8000)
    expect(bob.netProfit).toBe(9500)
    expect(bob.isHighRoller).toBe(false)
    expect(bob.highRollerFee).toBe(0)
    expect(bob.totalBuyInCash).toBe(8400)
  })

  it('nets a losing player against every buy-in', () => {
    const s = settleNight(night('2026-01-09', [['Dave', 3, 500]]))
    expect(s.players[0].chipsIn).toBe(12000)
    expect(s.players[0].netProfit).toBe(-11500)
    expect(s.players[0].pocketNet).toBe(500 - 12600)
  })

  it('names the biggest winner and hands them the recap', () => {
    const s = settleNight(night('2026-01-09', [
      ['Richard', 1, 6000],
      ['Bob', 1, 9000],
      ['Dave', 1, 1000],
    ]))
    expect(s.recapAuthor!.name).toBe('Bob')
    expect(s.biggestWinners).toHaveLength(1)
    expect(s.players.find((p) => p.name === 'Bob')!.isBiggestWinner).toBe(true)
  })

  it('reports a tie for biggest winner rather than picking one', () => {
    const s = settleNight(night('2026-01-09', [
      ['Richard', 1, 6000],
      ['Bob', 1, 6000],
      ['Dave', 1, 4000],
    ]))
    expect(s.biggestWinners.map((p) => p.name).sort()).toEqual(['Bob', 'Richard'])
  })

  it('adds up the house take from buy-ins and High Roller Fees', () => {
    const s = settleNight(night('2026-01-09', [
      ['Richard', 1, 14500], // $105 profit -> owes $5
      ['Bob', 2, 3000],
      ['Dave', 1, 2500],
    ]))
    expect(s.houseCut).toBe(800)   // four buy-ins at $2
    expect(s.houseFees).toBe(500)
    expect(s.houseTotal).toBe(1300)
  })

  it('flags a chip count that does not balance', () => {
    const balanced = settleNight(night('2026-01-09', [['A', 1, 5000], ['B', 1, 3000]]))
    expect(balanced.chipDiscrepancy).toBe(0)

    const short = settleNight(night('2026-01-09', [['A', 1, 5000], ['B', 1, 2750]]))
    expect(short.chipDiscrepancy).toBe(250)
  })
})

describe('career standings', () => {
  const nights = [
    night('2026-01-02', [['Richard', 1, 9000, 1], ['Bob', 2, 1000], ['Dave', 1, 5000]]),
    night('2026-01-09', [['Richard', 2, 2000], ['Bob', 1, 15000, 2], ['Dave', 1, 4000]]),
  ]

  it('carries totals from night to night instead of resetting', () => {
    const rows = careerStandings(nights)
    const richard = rows.find((r) => r.name === 'Richard')!
    expect(richard.nights).toBe(2)
    expect(richard.totalBuyIns).toBe(3)
    expect(richard.rebuys).toBe(1)
    expect(richard.lifetimeNet).toBe(9000 - 4000 + (2000 - 8000))
    expect(richard.dexterWins).toBe(1)
    expect(richard.nightsWon).toBe(1)
  })

  it('sorts by lifetime net, best first', () => {
    const rows = careerStandings(nights)
    expect(rows[0].name).toBe('Bob')
    expect(rows.map((r) => r.lifetimeNet)).toEqual(
      [...rows.map((r) => r.lifetimeNet)].sort((a, b) => b - a),
    )
  })

  it('treats names case-insensitively', () => {
    const rows = careerStandings([
      night('2026-01-02', [['dave', 1, 5000]]),
      night('2026-01-09', [['Dave', 1, 5000]]),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].nights).toBe(2)
  })

  it('counts recaps still owed', () => {
    const owed = night('2026-01-16', [['Richard', 1, 9000], ['Bob', 1, 1000]])
    const written = { ...owed, id: 'written', recap: 'Bob ran it down twice.' }
    expect(careerStandings([owed])[0].recapsOwed).toBe(1)
    expect(careerStandings([written]).find((r) => r.name === 'Richard')!.recapsOwed).toBe(0)
  })
})

describe('exports', () => {
  const sample = night('2026-01-09', [['Richard', 1, 14500, 1], ['Bob', 2, 1500]])

  it('writes one CSV row per player with the tracked columns', () => {
    const csv = recordBookCsv([sample])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Date,Player,Buy-Ins,Rebuys')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('Richard')
    expect(lines[1]).toContain('105.00')  // net profit
    expect(lines[1]).toContain('5.00')    // high roller fee
    expect(lines[1]).toContain('YES')     // biggest winner
  })

  it('escapes commas and quotes in a recap', () => {
    const csv = recordBookCsv([{ ...sample, recap: 'Dave said "no rebuy", then rebought.' }])
    expect(csv).toContain('"Dave said ""no rebuy"", then rebought."')
  })

  it('builds a recap email with results and the house take', () => {
    const { subject, body } = recapEmail({ ...sample, recap: 'What a night.' })
    expect(subject).toContain('BNOTW Recap')
    expect(body).toContain('Biggest winner: Richard (+$105.00)')
    expect(body).toContain('HIGH ROLLER (-$5)')
    expect(body).toContain('1 rebuy')
    expect(body).toContain('What a night.')
    expect(body).toContain('Win big. Pay the house. Write the recap.')
  })

  it('says the recap is still owed when it has not been written', () => {
    expect(recapEmail(sample).body).toContain('(still owed)')
  })
})

describe('record book storage', () => {
  it('replaces a night with the same id on import rather than duplicating it', () => {
    const original = night('2026-01-09', [['Richard', 1, 5000]])
    const edited = { ...original, players: [{ ...original.players[0], cashOut: 9000 }] }
    const book = mergeNights({ version: 1, nights: [original] }, [edited])
    expect(book.nights).toHaveLength(1)
    expect(book.nights[0].players[0].cashOut).toBe(9000)
  })

  it('round-trips through export and import', () => {
    const book = { version: 1 as const, nights: [night('2026-01-09', [['Richard', 1, 5000]])] }
    expect(parseImport(JSON.stringify(book))).toEqual(book.nights)
    expect(parseImport(JSON.stringify(book.nights))).toEqual(book.nights)
  })

  it('rejects a file that is not a record book', () => {
    expect(() => parseImport('{"hello":"world"}')).toThrow(/record book/)
    expect(() => parseImport('[{"id":1}]')).toThrow(/cannot read/)
  })
})
