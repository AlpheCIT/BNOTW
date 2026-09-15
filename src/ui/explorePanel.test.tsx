// @vitest-environment jsdom
/**
 * "Had you played it differently", on screen.
 *
 * The whole risk in this panel is a leaderboard: three lines, sorted, one
 * winner. That would be the most readable thing on the page and the least
 * true, because at these trial counts the bands usually overlap. So what is
 * tested is that the overlap is drawn, that the verdict says "too close to
 * call" when it is, and that both caveats survive.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ExplorePanel } from './ExplorePanel'
import { alternativesFor } from '../engine/explore'
import type { Exploration, Line } from '../engine/explore'
import type { HandReplay } from '../engine/replay'

afterEach(cleanup)

const line = (label: string, mean: number, margin: number): Line => ({
  action: { kind: 'call' },
  label,
  outcome: { mean, margin, aheadShare: 0.5, best: mean + 900, worst: mean - 900, trials: 120 },
})

function exploration(over: Partial<Exploration> = {}): Exploration {
  return {
    at: 3,
    street: 'flop',
    played: line('What you did', 200, 300),
    lines: [line('Fold', 0, 0), line('Raise', 500, 400)],
    separated: false,
    ...over,
  }
}

const show = (e: Exploration | null, running = false, failed = false) =>
  render(<ExplorePanel exploration={e} running={running} failed={failed} />)

describe('while it is working', () => {
  it('says why it is taking a moment', () => {
    show(null, true)
    // Several seconds with no explanation reads as a hang.
    expect(document.body.textContent).toMatch(/anecdote/i)
  })
})

describe('the verdict', () => {
  it('says plainly when nothing can be told apart', () => {
    show(exploration({ separated: false }))
    expect(document.querySelector('.expverdict')?.textContent)
      .toMatch(/none of these are far enough apart/i)
  })

  it('does not crown a winner when the bands overlap', () => {
    show(exploration({ separated: false }))
    const verdict = document.querySelector('.expverdict')?.textContent ?? ''
    expect(verdict).not.toMatch(/best|better|should have/i)
  })

  it('says which are separated when some are', () => {
    show(exploration({ separated: true }))
    expect(document.querySelector('.expverdict')?.textContent)
      .toMatch(/far enough apart/i)
    // And still warns about the ones that are not.
    expect(document.querySelector('.expverdict')?.textContent).toMatch(/overlap/i)
  })
})

describe('the bars', () => {
  it('draws a spread for every line, not just a mean', () => {
    show(exploration())
    // Three lines: what was played, plus two alternatives.
    expect(document.querySelectorAll('.expline')).toHaveLength(3)
    expect(document.querySelectorAll('.expspread')).toHaveLength(3)
    expect(document.querySelectorAll('.expmean')).toHaveLength(3)
  })

  it('marks which one actually happened', () => {
    show(exploration())
    expect(document.querySelector('.expline.played')).not.toBe(null)
    expect(screen.getByText('Played')).toBeTruthy()
  })

  it('prints the band beside the figure rather than hiding it', () => {
    show(exploration())
    const figures = [...document.querySelectorAll('.expfigures')].map((n) => n.textContent ?? '')
    expect(figures.every((f) => f.includes('±'))).toBe(true)
  })

  it('keeps a line with no spread visible rather than zero-width', () => {
    show(exploration({ lines: [line('Fold', 0, 0)] }))
    const fold = [...document.querySelectorAll('.expline')]
      .find((n) => n.textContent?.includes('Fold'))!
    const spread = fold.querySelector('.expspread') as HTMLElement
    expect(parseFloat(spread.style.width)).toBeGreaterThan(0)
  })
})

describe('the two caveats', () => {
  it('says the cards were held fixed, so this is about this hand', () => {
    show(exploration())
    // "Raising is better" and "raising was better here" are different claims.
    expect(document.querySelector('.expcaveat')?.textContent).toMatch(/in this hand/i)
    expect(document.querySelector('.expcaveat')?.textContent).toMatch(/not whether it is right in spots like it/i)
  })

  it('admits the simulated opponents are weaker than the real ones', () => {
    show(exploration())
    const caveat = document.querySelector('.expcaveat')?.textContent ?? ''
    expect(caveat).toMatch(/flatters/i)
    expect(caveat).toMatch(/compare the lines against each other/i)
  })
})

describe('when it cannot answer', () => {
  it('shows nothing rather than a number from a hand that did not happen', () => {
    const { container } = render(
      <ExplorePanel exploration={null} running={false} failed={true} />,
    )
    expect(container.textContent).toMatch(/could not be rebuilt/i)
    expect(container.querySelector('.expline')).toBe(null)
  })

  it('renders nothing at all when there is simply nothing to show', () => {
    const { container } = render(
      <ExplorePanel exploration={null} running={false} failed={false} />,
    )
    expect(container.textContent).toBe('')
  })
})

describe('which lines get offered', () => {
  const replay = (kind: string, to: number, pot: number) =>
    ({ journal: [{ street: 'flop', seat: 0, kind, amount: to, to, pot }] } as unknown as HandReplay)

  it('offers the roads not taken', () => {
    expect(alternativesFor(replay('fold', 0, 1000), 0).map((a) => a.label))
      .toEqual(['Call', 'Raise'])
    expect(alternativesFor(replay('call', 200, 1000), 0).map((a) => a.label))
      .toEqual(['Fold', 'Raise'])
    expect(alternativesFor(replay('check', 0, 1000), 0).map((a) => a.label))
      .toEqual(['Bet half the pot', 'Bet the pot'])
  })

  it('keeps the list short', () => {
    // Every extra line is another hundred hands to simulate and another bar
    // whose band overlaps the rest.
    for (const kind of ['fold', 'check', 'call', 'bet', 'raise']) {
      expect(alternativesFor(replay(kind, 300, 1000), 0).length).toBeLessThanOrEqual(3)
    }
  })

  it('offers nothing for a decision that was never a choice', () => {
    expect(alternativesFor(replay('blind', 25, 25), 0)).toEqual([])
    expect(alternativesFor(replay('call', 200, 1000), 99)).toEqual([])
  })
})
