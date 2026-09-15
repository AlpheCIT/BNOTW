// @vitest-environment jsdom
/**
 * "Had you stayed", on screen.
 *
 * The risk in this panel is not that it is wrong, it is that it is
 * persuasive — "you would have made a flush" is the most memorable thing on
 * the page and the least useful. So what is guarded here is the framing: the
 * probability you acted on appears above the one runout that came, the caveat
 * is always present, and a hit is never styled as a win.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WhatIfPanel } from './WhatIfPanel'
import type { WhatIf, WhatIfResult } from '../engine/whatIf'

afterEach(cleanup)

const WON: WhatIf = {
  board: 'Qh Jh 10h 4c 3d',
  hole: 'Ah Kh',
  madeLabel: 'Straight flush, Ace high',
  wouldHaveWon: true,
  best: { seat: 1, name: 'Dave', hand: 'Two pair, Queens and Jacks', won: 1200 },
  showdown: [
    { seat: 1, name: 'Dave', hand: 'Two pair, Queens and Jacks', won: 1200 },
    { seat: 2, name: 'Eadie', hand: 'Pair of Fours', won: 0 },
  ],
  pot: 1200,
}

const LOST: WhatIf = { ...WON, wouldHaveWon: false, madeLabel: 'Ace high' }

function panel(result: WhatIfResult, equity: number | null = 0.34) {
  render(<WhatIfPanel result={result} equityAtFold={equity} />)
}

describe('the framing', () => {
  it('puts the equity you had above the runout that came', () => {
    panel(WON)
    const text = document.querySelector('.whatif')?.textContent ?? ''
    const equityAt = text.indexOf('34')
    const outcomeAt = text.indexOf('Straight flush')
    expect(equityAt).toBeGreaterThanOrEqual(0)
    // Outcome first reads as "you were robbed", which is the lesson not to teach.
    expect(equityAt).toBeLessThan(outcomeAt)
  })

  it('always carries the caveat, hit or miss', () => {
    panel(WON)
    expect(document.querySelector('.whatif-caveat')?.textContent).toMatch(/one runout/i)
    cleanup()
    panel(LOST)
    expect(document.querySelector('.whatif-caveat')?.textContent).toMatch(/one runout/i)
  })

  it('names the second reason this is weak evidence, not just the first', () => {
    panel(WON)
    const caveat = document.querySelector('.whatif-caveat')?.textContent ?? ''
    // Everyone thinks of "one runout". Almost nobody thinks of the fact that
    // the betting itself would have been different with you still in.
    expect(caveat).toMatch(/betting would not have gone the same way/i)
    expect(caveat).toMatch(/still the right fold/i)
  })

  it('says you held the best hand, never that you would have won the pot', () => {
    panel(WON)
    const made = document.querySelector('.whatif-made')?.textContent ?? ''
    expect(made).toMatch(/best hand at the river/i)
    expect(made).not.toMatch(/you would have won/i)
  })

  it('names who would have beaten you', () => {
    panel(LOST)
    const made = document.querySelector('.whatif-made')?.textContent ?? ''
    expect(made).toMatch(/Dave/)
    expect(made).toMatch(/Two pair/)
  })

  it('leaves the equity line out rather than inventing one', () => {
    panel(WON, null)
    expect(document.querySelector('.whatif-equity')).toBe(null)
    // The rest still stands; only the figure that was never measured is gone.
    expect(document.querySelector('.whatif-caveat')).not.toBe(null)
  })
})

describe('when there is nothing to show', () => {
  it('says the hand ended before the river rather than dealing one', () => {
    panel({ unknown: 'no-river' })
    expect(document.body.textContent).toMatch(/before the river/i)
    expect(document.querySelector('.whatif-made')).toBe(null)
  })

  it('says when everyone else folded too', () => {
    panel({ unknown: 'no-opponents' })
    expect(document.body.textContent).toMatch(/nobody left/i)
  })

  it('renders nothing at all when you never folded', () => {
    const { container } = render(
      <WhatIfPanel result={{ unknown: 'still-in' }} equityAtFold={0.5} />,
    )
    // There is nothing counterfactual about a hand you played out.
    expect(container.textContent).toBe('')
  })
})

describe('the showdown list', () => {
  it('marks who actually took the pot', () => {
    panel(WON)
    const rows = [...document.querySelectorAll('.whatif-showdown span')]
    expect(rows).toHaveLength(2)
    expect(rows[0].className).toBe('won')
    expect(rows[1].className).toBe('')
  })

  it('reports the pot that was passed on', () => {
    panel(WON)
    expect(document.querySelector('.whatif')?.textContent).toMatch(/\$12\.00/)
  })
})

describe('dismissing it', () => {
  it('offers a way to put it away, and only when there is a handler', () => {
    panel(WON)
    expect(screen.queryByText('Hide')).toBe(null)

    cleanup()
    let hidden = false
    render(
      <WhatIfPanel result={WON} equityAtFold={0.3} onClose={() => { hidden = true }} />,
    )
    fireEvent.click(screen.getByText('Hide'))
    expect(hidden).toBe(true)
  })
})
