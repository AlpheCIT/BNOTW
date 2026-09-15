// @vitest-environment jsdom
/**
 * Removing hands, and putting things back.
 *
 * Both of these delete data that cannot be recovered, so what is tested here
 * is mostly the guardrails: that a single tap never erases anything, that the
 * Record Book is not swept up in "everything", and that what leaves the screen
 * is what the totals lost.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { StatsView } from './StatsView'
import { ResetDialog } from './ResetDialog'
import { RESET_AREAS, applyReset, everythingIds, type ResetActions } from '../state/factory'
import { accumulate, emptyTotals, type HandRecord } from '../engine/playerStats'
import type { TrackerApi } from './useTracker'

afterEach(cleanup)

function hand(at: number, mode: 'table' | 'coach', net: number): HandRecord {
  return {
    at,
    mode,
    handNumber: at,
    bomb: false,
    position: 'other',
    hole: 'As Kd',
    couldStraddle: true,
    straddled: false,
    vpip: true,
    pfr: true,
    facedRaise: false,
    threeBet: false,
    sawFlop: true,
    showdown: false,
    wonShowdown: false,
    net,
    aggressive: 1,
    passive: 0,
    dexterHeld: false,
    dexterWon: false,
    decisions: [{
      street: 'flop', action: 'call', recommended: 'call',
      agreed: true, evLost: 0, leak: null,
    }],
  }
}

/** A tracker backed by a plain array, so the view is the only thing under test. */
function fakeTracker(hands: HandRecord[]) {
  const deleted: number[][] = []
  const tracker: TrackerApi = {
    totals: hands.reduce(accumulate, emptyTotals()),
    // The view expects newest first, which is how the store hands them back.
    recent: [...hands].sort((a, b) => b.at - a.at),
    setNote: () => {},
    recordDecision: () => {},
    completeHand: () => {},
    deleteHands: (ats) => { deleted.push(ats) },
    reset: () => {},
  }
  return { tracker, deleted }
}

function rowsFor(): HTMLTableRowElement[] {
  const table = document.querySelectorAll('table.grid')
  const history = table[table.length - 1]
  return [...history.querySelectorAll('tbody tr')] as HTMLTableRowElement[]
}

describe('removing hands from the record', () => {
  const hands = [
    hand(1000, 'table', 500),
    hand(2000, 'coach', -800),
    hand(3000, 'coach', 300),
    hand(4000, 'table', -100),
  ]

  it('does not offer checkboxes until you ask to remove something', () => {
    const { tracker } = fakeTracker(hands)
    render(<StatsView tracker={tracker} />)
    expect(document.querySelectorAll('tbody input[type="checkbox"]')).toHaveLength(0)

    fireEvent.click(screen.getByText('Remove hands'))
    expect(document.querySelectorAll('tbody input[type="checkbox"]').length).toBe(hands.length)
  })

  it('takes two taps to delete, never one', () => {
    const { tracker, deleted } = fakeTracker(hands)
    render(<StatsView tracker={tracker} />)
    fireEvent.click(screen.getByText('Remove hands'))
    fireEvent.click(rowsFor()[0])

    // The first press only arms it.
    fireEvent.click(screen.getByText('Remove'))
    expect(deleted).toEqual([])

    fireEvent.click(screen.getByText(/Yes, remove 1/))
    expect(deleted).toEqual([[4000]])
  })

  it('cannot arm the delete with nothing chosen', () => {
    const { tracker } = fakeTracker(hands)
    render(<StatsView tracker={tracker} />)
    fireEvent.click(screen.getByText('Remove hands'))
    expect((screen.getByText('Remove') as HTMLButtonElement).disabled).toBe(true)
  })

  it('picks out exactly the coach-mode hands, which is the test play', () => {
    const { tracker, deleted } = fakeTracker(hands)
    render(<StatsView tracker={tracker} />)
    fireEvent.click(screen.getByText('Remove hands'))
    fireEvent.click(screen.getByText('All coach hands'))
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(screen.getByText(/Yes, remove 2/))

    expect(deleted[0].sort()).toEqual([2000, 3000])
  })

  it('un-marks a hand tapped twice', () => {
    const { tracker, deleted } = fakeTracker(hands)
    render(<StatsView tracker={tracker} />)
    fireEvent.click(screen.getByText('Remove hands'))
    const row = rowsFor()[0]
    fireEvent.click(row)
    fireEvent.click(row)
    expect((screen.getByText('Remove') as HTMLButtonElement).disabled).toBe(true)
    expect(deleted).toEqual([])
  })

  it('does not open a replay while you are choosing hands', () => {
    const withReplay = [{ ...hand(5000, 'table', 200), replay: { handNumber: 5 } as never }]
    const { tracker } = fakeTracker(withReplay)
    render(<StatsView tracker={tracker} />)

    fireEvent.click(screen.getByText('Remove hands'))
    fireEvent.click(rowsFor()[0])
    // A replay over the top of the list would hide what you are about to erase.
    expect(document.querySelector('.dialog.replay')).toBe(null)
  })

  it('forgets the selection when you are done', () => {
    const { tracker, deleted } = fakeTracker(hands)
    render(<StatsView tracker={tracker} />)
    fireEvent.click(screen.getByText('Remove hands'))
    fireEvent.click(rowsFor()[0])
    fireEvent.click(screen.getByText('Done'))

    fireEvent.click(screen.getByText('Remove hands'))
    expect((screen.getByText('Remove') as HTMLButtonElement).disabled).toBe(true)
    expect(deleted).toEqual([])
  })
})

describe('starting fresh', () => {
  function renderDialog() {
    const applied: string[][] = []
    render(
      <ResetDialog onApply={(ids) => applied.push([...ids])} onClose={() => {}} />,
    )
    return applied
  }

  it('starts with nothing selected and the erase disabled', () => {
    renderDialog()
    expect((screen.getByText('Nothing selected') as HTMLButtonElement).disabled).toBe(true)
  })

  it('takes two taps to erase, never one', () => {
    const applied = renderDialog()
    fireEvent.click(screen.getByText('The coaches'))
    fireEvent.click(screen.getByText(/^Erase 1 thing$/))
    expect(applied).toEqual([])
    fireEvent.click(screen.getByText(/Yes, erase it/))
    expect(applied).toEqual([['voices']])
  })

  it('leaves the Record Book out of "everything"', () => {
    const applied = renderDialog()
    fireEvent.click(screen.getByText('Select everything'))
    fireEvent.click(screen.getByText(/^Erase \d+ things$/))
    fireEvent.click(screen.getByText(/Yes, erase all/))

    // Real money owed between real people is never swept up in a bulk action.
    expect(applied[0]).not.toContain('book')
    expect(applied[0]).toContain('hands')
    expect(applied[0]).toContain('roster')
  })

  it('warns in plain words when the Record Book is chosen', () => {
    renderDialog()
    expect(document.querySelector('.warn.bad')).toBe(null)
    fireEvent.click(screen.getByText('The Record Book'))
    expect(document.querySelector('.warn.bad')?.textContent).toMatch(/does not settle/i)
  })

  it('disarms the confirmation when the selection changes under it', () => {
    const applied = renderDialog()
    fireEvent.click(screen.getByText('The coaches'))
    fireEvent.click(screen.getByText(/^Erase 1 thing$/))
    // Changing your mind must not leave a live "yes" button under your thumb.
    fireEvent.click(screen.getByText('Hand names'))
    expect(screen.queryByText(/Yes, erase/)).toBe(null)
    expect(applied).toEqual([])
  })
})

describe('what a reset actually does', () => {
  function spyActions() {
    const calls: string[] = []
    const actions: ResetActions = {
      hands: () => calls.push('hands'),
      drill: () => calls.push('drill'),
      coachScore: () => calls.push('coachScore'),
      roster: (next) => calls.push(`roster:${next.players.length}`),
      voices: (next) => calls.push(`voices:${next.primary}:${Object.keys(next.names).length}`),
      handNames: (next) => calls.push(`handNames:${Object.keys(next).length}`),
      tables: () => calls.push('tables'),
      book: () => calls.push('book'),
    }
    return { actions, calls }
  }

  it('touches only what was asked for', () => {
    const { actions, calls } = spyActions()
    applyReset(['voices'], actions)
    expect(calls).toEqual(['voices:house:0'])
  })

  it('hands back the shipped roster rather than an empty one', () => {
    const { actions, calls } = spyActions()
    applyReset(['roster'], actions)
    // An empty table is not a factory default; the app ships with a crew.
    expect(calls[0]).toMatch(/^roster:[1-9]/)
  })

  it('clears every renamed coach and hand name', () => {
    const { actions, calls } = spyActions()
    applyReset(['voices', 'handNames'], actions)
    expect(calls).toEqual(['voices:house:0', 'handNames:0'])
  })

  it('ignores an id it does not know', () => {
    const { actions, calls } = spyActions()
    applyReset(['nonsense' as never, 'drill'], actions)
    expect(calls).toEqual(['drill'])
  })

  it('gives every area words a player can decide on', () => {
    for (const area of RESET_AREAS) {
      expect(area.label.length, area.id).toBeGreaterThan(2)
      // Every line has to say what it takes before it takes it.
      expect(area.what.length, area.id).toBeGreaterThan(30)
    }
    expect(everythingIds()).not.toContain('book')
  })
})
