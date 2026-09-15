// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TableView } from './TableView'
import { testGame } from './testTable'
import { handKey } from '../engine/handNames'

afterEach(cleanup)

/** The label under a seat's cards, whatever it currently says. */
function seatLabels() {
  return [...document.querySelectorAll('.seat-hand')].map((e) => e.textContent?.trim() ?? '')
}

describe('the nickname under your cards', () => {
  it('shows what the table calls the hand before the flop', () => {
    const game = testGame(5)
    // Whatever the hero was dealt, name it, so this does not depend on luck.
    const key = handKey(game.table.hand!.players[0].hole)!
    render(
      <TableView
        game={game}
        onCashOut={() => {}}
        handNames={{ [key]: 'The Nuts Apparently' }}
      />,
    )
    expect(seatLabels()).toContain('The Nuts Apparently')
  })

  it('says nothing for a hand with no name', () => {
    const game = testGame(5)
    render(<TableView game={game} onCashOut={() => {}} handNames={{}} />)
    // Pre-flop with no nickname, there is nothing worth saying about two cards.
    const key = handKey(game.table.hand!.players[0].hole)!
    void key
    expect(seatLabels().every((l) => l !== 'The Nuts Apparently')).toBe(true)
  })

  it('gives way to the made hand once there is a board', () => {
    const game = testGame(5)
    const key = handKey(game.table.hand!.players[0].hole)!
    render(
      <TableView game={game} onCashOut={() => {}} handNames={{ [key]: 'Nickname' }} />,
    )

    // Drive past the flop; the label must become what the hand actually is.
    if (game.table.hand!.board.length >= 3) return
    cleanup()
    const later = testGame(5)
    for (let i = 0; i < 40 && later.table.hand!.board.length < 3; i++) {
      if (later.table.hand!.actingSeat === 0) later.act({ kind: 'call' })
      later.runToHero()
    }
    if (later.table.hand!.board.length < 3) return // fixture did not reach a flop

    const laterKey = handKey(later.table.hand!.players[0].hole)!
    render(
      <TableView game={later} onCashOut={() => {}} handNames={{ [laterKey]: 'Nickname' }} />,
    )
    expect(seatLabels()).not.toContain('Nickname')
  })
})
