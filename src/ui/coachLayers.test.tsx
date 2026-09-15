// @vitest-environment jsdom
/**
 * What the coach shows, layer by layer.
 *
 * The thing worth guarding is that turning a layer off actually removes the
 * numbers rather than hiding a heading over them — the complaint that produced
 * layers was that too much was on screen at equal weight, and a gate that
 * leaves the equity visible fixes nothing.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CoachPanel } from './CoachPanel'
import { advise } from '../engine/coach'
import { dealHand } from '../engine/hand'
import { Shoe, mulberry32 } from '../engine/cards'
import { evenSeats, newHand, setHoleCards } from '../engine/testkit'
import { tableNotes } from '../engine/layers'
import { readFor, type Reads } from '../engine/reads'
import type { LayerId } from '../engine/layers'

afterEach(cleanup)

/** A real spot, read by the real coach. Nothing here is a stub. */
function spot(hole = 'Ah Kh') {
  const seats = evenSeats(6)
  const hand = newHand(seats, 3)
  dealHand(hand, seats, new Shoe(mulberry32(11)))
  setHoleCards(hand, { 0: hole })
  const seat = hand.actingSeat ?? 0
  return advise(hand, seats, seat, mulberry32(3), 300)
}

function renderPanel(layers: LayerId[], extra: Partial<Parameters<typeof CoachPanel>[0]> = {}) {
  render(
    <CoachPanel advice={spot()} review={null} layers={layers} position="on the button" {...extra} />,
  )
}

describe('the price, on its own', () => {
  it('always shows the verdict — the layers narrow the numbers, not the advice', () => {
    renderPanel(['price'])
    expect(document.querySelector('.verdict')).not.toBe(null)
    expect(document.querySelectorAll('.coach ul li').length).toBeGreaterThan(0)
  })

  it('keeps the pot on screen', () => {
    renderPanel(['price'])
    const labels = [...document.querySelectorAll('.coach-cell span')].map((n) => n.textContent)
    expect(labels).toContain('Pot')
  })

  it('does not show equity, outs or the made hand', () => {
    renderPanel(['price'])
    const labels = [...document.querySelectorAll('.coach-cell span')].map((n) => n.textContent ?? '')
    expect(labels.some((l) => /equity/i.test(l))).toBe(false)
    expect(labels.some((l) => /improve you/i.test(l))).toBe(false)
    expect(labels.some((l) => /your hand/i.test(l))).toBe(false)
  })

  it('leaves the bar empty rather than filled', () => {
    renderPanel(['price'])
    const bar = document.querySelector('.equity-bar')
    expect(bar).not.toBe(null)
    // The mark you are aiming at can stay; how close you are is the next layer.
    expect(bar!.querySelector('i')).toBe(null)
  })

  it('gives Chen no panel of its own', () => {
    renderPanel(['price'])
    expect(document.querySelector('.chenline')).toBe(null)
    const cells = [...document.querySelectorAll('.coach-cell')].map((n) => n.textContent ?? '')
    expect(cells.some((c) => /chen/i.test(c))).toBe(false)
  })

  it('still explains itself, because gating the numbers is not gating the advice', () => {
    renderPanel(['price'])
    // The coach's reasoning always shows: advice you cannot check is worse
    // than a number you have not been introduced to. So the reasons may name
    // Chen — they lead with the grade, and the score rides along in support.
    const reasons = [...document.querySelectorAll('.coach ul li')].map((n) => n.textContent ?? '')
    expect(reasons[0]).toMatch(/starting hand/i)
    expect(reasons[0]).not.toMatch(/^.*scores \d+ on the Chen scale/i)
  })
})

describe('the hand layer', () => {
  it('brings back the equity and fills the bar', () => {
    renderPanel(['price', 'hand'])
    const labels = [...document.querySelectorAll('.coach-cell span')].map((n) => n.textContent ?? '')
    expect(labels.some((l) => /equity/i.test(l))).toBe(true)
    expect(document.querySelector('.equity-bar i')).not.toBe(null)
  })

  it('shows Chen as one line rather than a tile beside the equity', () => {
    renderPanel(['price', 'hand'])
    // A grid cell is where it was, and where it read as an equal authority.
    const cells = [...document.querySelectorAll('.coach-cell')].map((n) => n.textContent ?? '')
    expect(cells.some((c) => /chen/i.test(c))).toBe(false)
    expect(document.querySelector('.chenline')?.textContent).toMatch(/chen/i)
  })

  it('explains what Chen is, and what it does not know', () => {
    renderPanel(['price', 'hand'])
    expect(document.querySelector('.chen-explain')).toBe(null)

    fireEvent.click(screen.getByText(/what's chen/i))
    const explain = document.querySelector('.chen-explain')?.textContent ?? ''
    // The limits are the point. A definition alone leaves it looking absolute.
    expect(explain).toMatch(/position/i)
    expect(explain).toMatch(/believe the equity/i)
  })
})

describe('the player layer', () => {
  function reads(): Reads {
    const map: Reads = new Map()
    // Well-observed: past the confidence floor, so a number is shown.
    map.set(1, { faced: 40, folded: 30, chances: 40, aggressive: 8 })
    // Barely seen: has to read as unknown rather than as 100% folding.
    map.set(2, { faced: 2, folded: 2, chances: 1, aggressive: 0 })
    return map
  }

  it('says who you are up against and what they are credited with', () => {
    renderPanel(['price', 'hand', 'player'])
    const panel = [...document.querySelectorAll('.layer-panel')]
      .find((n) => n.textContent?.includes('The players'))
    expect(panel?.textContent).toMatch(/on the button/)
  })

  it('shows a settled read as a number and an unsettled one as unknown', () => {
    renderPanel(['player'], {
      reads: [
        { seat: 1, name: 'Dave', read: readFor(reads(), 1) },
        { seat: 2, name: 'Eadie', read: readFor(reads(), 2) },
      ],
    })
    const rows = [...document.querySelectorAll('.read-row')].map((n) => n.textContent ?? '')
    expect(rows.find((r) => r.includes('Dave'))).toMatch(/folds [\d.]+%/)
    // Two hands is a rumour, not a read.
    expect(rows.find((r) => r.includes('Eadie'))).toMatch(/not seen enough/i)
  })

  it('is not there at all with the layer off', () => {
    renderPanel(['price', 'hand'])
    const panels = [...document.querySelectorAll('.layer-panel')].map((n) => n.textContent ?? '')
    expect(panels.some((p) => p.includes('The players'))).toBe(false)
  })
})

describe('the table layer', () => {
  it("explains what a bomb pot does to everyone's ranges", () => {
    const notes = tableNotes({
      isBombPot: true, bombGame: 'crazyPineapple', straddles: [], board: [], dexter: null,
    })
    renderPanel(['table'], { tableNotes: notes })
    const panel = [...document.querySelectorAll('.layer-panel')]
      .find((n) => n.textContent?.includes('This table'))
    expect(panel?.textContent).toMatch(/any two cards/i)
    expect(panel?.textContent).toMatch(/crazy pineapple/i)
  })

  it('admits the one thing it cannot teach', () => {
    renderPanel(['table'], {
      tableNotes: tableNotes({
        isBombPot: false, bombGame: null, straddles: [], board: [], dexter: null,
      }),
    })
    // Tells were top of the list in the request, and the app has nobody to
    // show you. Saying so beats repeating received wisdom it cannot check.
    expect(document.body.textContent).toMatch(/cannot teach you/i)
  })
})

describe('everything on', () => {
  it('is the panel as it was before layers existed', () => {
    renderPanel(['price', 'hand', 'player', 'table'])
    const labels = [...document.querySelectorAll('.coach-cell span')].map((n) => n.textContent ?? '')
    expect(labels.some((l) => /equity/i.test(l))).toBe(true)
    expect(labels).toContain('Pot')
    expect(document.querySelector('.chenline')).not.toBe(null)
  })

  it('defaults to everything when a caller says nothing about layers', () => {
    // An older caller must not silently lose panels it never opted out of.
    render(<CoachPanel advice={spot()} review={null} />)
    const labels = [...document.querySelectorAll('.coach-cell span')].map((n) => n.textContent ?? '')
    expect(labels.some((l) => /equity/i.test(l))).toBe(true)
  })
})
