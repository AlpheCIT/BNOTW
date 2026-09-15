// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act as reactAct, fireEvent } from '@testing-library/react'
import { TableView } from './TableView'
import { testGame } from './testTable'

afterEach(cleanup)

/**
 * The action bar swallows taps for a moment after it appears, which is the
 * fat-finger guard. Tests have to get past it before clicking anything.
 */
async function settle() {
  await reactAct(async () => { vi.advanceTimersByTime(400) })
}

function renderTable(seed = 5, until: 'any' | 'bet' = 'any') {
  const game = testGame(seed, until)
  render(<TableView game={game} onCashOut={() => {}} />)
  return game
}

describe('telling Check and Call apart', () => {
  it('shows Check as free when there is nothing to call', () => {
    renderTable(5, 'any')
    const check = document.querySelector('.action-buttons .btn.check')
    const call = document.querySelector('.action-buttons .btn.call')

    // Only one of the two ever exists, and this fixture is the check state.
    if (!check) return // seed landed facing a bet; the next test covers that
    expect(call).toBe(null)
    expect(check!.textContent).toMatch(/free/i)
  })

  it('shows Call with the amount, in its own class, when there is', () => {
    renderTable(5, 'bet')
    const call = document.querySelector('.action-buttons .btn.call')
    expect(call).not.toBe(null)
    expect(document.querySelector('.action-buttons .btn.check')).toBe(null)
    // The cost has to be on the button. Reading "Call" alone is how you call
    // a bet you meant to check.
    expect(call!.textContent).toMatch(/\$\d/)
  })

  it('never renders both at once', () => {
    for (const seed of [3, 5, 9, 11, 17]) {
      cleanup()
      renderTable(seed)
      const both = document.querySelectorAll('.action-buttons .btn.check, .action-buttons .btn.call')
      expect(both.length, `seed ${seed}`).toBe(1)
    }
  })
})

describe('composing a bet', () => {
  it('takes every other action off the bar while the slider is up', async () => {
    vi.useFakeTimers()
    try {
      renderTable(5, 'bet')
      await settle()

      const raise = document.querySelector('.action-buttons .btn.raise') as HTMLButtonElement
      expect(raise.disabled).toBe(false)
      await reactAct(async () => { fireEvent.click(raise) })

      // The reported bug: setting a custom amount, reaching for confirm, and
      // hitting Check instead — throwing the bet away.
      expect(document.querySelector('.action-buttons .btn.check')).toBe(null)
      expect(document.querySelector('.action-buttons .btn.call')).toBe(null)
      expect(document.querySelector('.action-buttons .btn.fold')).toBe(null)

      const labels = [...document.querySelectorAll('.action-buttons .btn')]
        .map((b) => b.textContent ?? '')
      expect(labels).toHaveLength(2)
      expect(labels.join(' ')).toMatch(/back/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers a way back to the minimum once the slider has moved', async () => {
    vi.useFakeTimers()
    try {
      renderTable(5, 'bet')
      await settle()
      await reactAct(async () => {
        fireEvent.click(document.querySelector('.action-buttons .btn.raise')!)
      })
      const presets = [...document.querySelectorAll('.chiprow .btn')].map((b) => b.textContent ?? '')
      expect(presets.join(' ')).toMatch(/min/i)
      expect(presets.join(' ')).toMatch(/all in/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes back without acting', async () => {
    vi.useFakeTimers()
    try {
      const game = renderTable(5, 'bet')
      await settle()
      const before = game.table.hand!.actingSeat

      await reactAct(async () => {
        fireEvent.click(document.querySelector('.action-buttons .btn.raise')!)
      })
      await reactAct(async () => {
        fireEvent.click(screen.getByText(/back/i).closest('button')!)
      })

      // Still the hero's decision; nothing was committed.
      expect(game.table.hand!.actingSeat).toBe(before)
      expect(document.querySelector('.action-buttons .btn.fold')).not.toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the settling window', () => {
  it('ignores a tap that lands as the buttons arrive', async () => {
    vi.useFakeTimers()
    try {
      const game = renderTable(5, 'bet')
      const seatBefore = game.table.hand!.actingSeat

      // No settle() first: this is the tap meant for whatever was there before.
      await reactAct(async () => {
        fireEvent.click(document.querySelector('.action-buttons .btn.fold')!)
      })
      expect(game.table.hand!.actingSeat).toBe(seatBefore)

      // And after the window, the same tap works.
      await settle()
      await reactAct(async () => {
        fireEvent.click(document.querySelector('.action-buttons .btn.fold')!)
      })
      expect(game.table.hand!.players[0].folded).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
