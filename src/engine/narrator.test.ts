import { describe, it, expect, vi, afterEach } from 'vitest'
import { mulberry32, parseCards } from './cards'
import { advise } from './coach'
import { decisionBrief, leakBrief } from './brief'
import {
  NarratorError, chooseNarrator, directNarrator, httpNarrator, narratorEndpoint,
  type ProviderConfig,
  offlineNarrator,
} from './narrator'
import { accumulate, emptyTotals, type HandRecord } from './playerStats'
import { dealHand, applyAction, advanceStreet } from './hand'
import { evenSeats, newHand, setHoleCards, stackedShoe } from './testkit'
import handler from '../../api/coach'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

/** A spot with a real, computed advice object behind it. */
function spot() {
  const seats = evenSeats(3)
  const hand = newHand(seats, 2)
  dealHand(hand, seats, stackedShoe('9s 8s  Ks Kh  Qs Qh'))
  applyAction(hand, seats, 2, { kind: 'call' })
  applyAction(hand, seats, 0, { kind: 'call' })
  applyAction(hand, seats, 1, { kind: 'check' })
  advanceStreet(hand, stackedShoe('2d  As Ks 2h'))
  applyAction(hand, seats, 0, { kind: 'bet', amount: 100 })
  return { hand, seats, advice: advise(hand, seats, 1, mulberry32(7), 400) }
}

describe('the decision brief', () => {
  it('carries the computed facts, already formatted', () => {
    const { advice } = spot()
    const brief = decisionBrief(advice, 'on the button')

    expect(brief.kind).toBe('decision')
    expect(brief.position).toBe('on the button')
    expect(brief.pot).toMatch(/^\$/)
    expect(brief.equity).toMatch(/%$/)
    expect(brief.recommendation.action).toBe(advice.recommendation.action)
    expect(brief.recommendation.reasons).toEqual(advice.recommendation.reasons)
    // The method is stated so the narrator can qualify the number honestly.
    expect(brief.method).toMatch(/counted exactly|sampled over/)
  })

  it('includes the starting hand pre-flop and the made hand after', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks  Qs Qh  Jc Jd'))
    setHoleCards(hand, { 2: 'As Ks' })
    const preflop = decisionBrief(advise(hand, seats, 2, mulberry32(1), 200), 'on the button')
    expect(preflop.startingHand).toMatchObject({ label: 'AK suited', grade: 'Premium' })
    expect(preflop.madeHand).toBeNull()
    expect(preflop.board).toBe('(none yet)')

    const { advice } = spot()
    const postflop = decisionBrief(advice, 'in the big blind')
    expect(postflop.startingHand).toBeNull()
    expect(postflop.madeHand).toBeTruthy()
  })

  it('says plainly when nothing is owed rather than showing $0.00', () => {
    const seats = evenSeats(3)
    const hand = newHand(seats, 2)
    dealHand(hand, seats, stackedShoe('As Ks  Qs Qh  Jc Jd'))
    applyAction(hand, seats, 2, { kind: 'call' })
    applyAction(hand, seats, 0, { kind: 'call' })
    applyAction(hand, seats, 1, { kind: 'check' })
    advanceStreet(hand, stackedShoe('2d  7s 6h 5c'))

    const brief = decisionBrief(advise(hand, seats, 0, mulberry32(3), 200), 'in the small blind')
    expect(brief.toCall).toMatch(/checked to you/)
    expect(brief.breakEven).toBeNull()
    expect(brief.callEV).toBeNull()
  })

  it('never carries a raw number the narrator could misread as its own', () => {
    const { advice } = spot()
    const brief = decisionBrief(advice, 'on the button')
    // Money and probabilities go over already formatted, so there is nothing
    // to "compute" on the other side — only prose to write around them.
    for (const value of [brief.pot, brief.stack, brief.equity]) {
      expect(typeof value).toBe('string')
    }
    expect(brief.outs.every((o) => typeof o.byRiver === 'string')).toBe(true)
  })
})

describe('the leak brief', () => {
  function history(): { totals: ReturnType<typeof emptyTotals>; recent: HandRecord[] } {
    const hands: HandRecord[] = Array.from({ length: 60 }, (_, i) => ({
      at: 1, mode: 'coach' as const, handNumber: i + 1, bomb: false, position: 'other',
      hole: 'Kc 7d', couldStraddle: true, straddled: false,
      vpip: i < 40, pfr: i < 4, facedRaise: i < 20, threeBet: false,
      sawFlop: i < 40, showdown: i < 25, wonShowdown: i < 8,
      net: i % 2 === 0 ? 300 : -450, aggressive: 1, passive: 4,
      dexterHeld: false, dexterWon: false,
      decisions: [{
        street: 'turn' as const, action: 'call' as const, recommended: 'fold' as const,
        agreed: false, evLost: 100 + i, leak: 'Called too light',
      }],
    }))
    return { totals: hands.reduce(accumulate, emptyTotals()), recent: hands }
  }

  it('summarises the whole record, worst decisions first', () => {
    const { totals, recent } = history()
    const brief = leakBrief(totals, recent)

    expect(brief.kind).toBe('leaks')
    expect(brief.handsTracked).toBe(60)
    expect(brief.leaks[0]).toEqual({ name: 'Called too light', count: 60 })
    expect(brief.byStreet.find((s) => s.street === 'turn')?.decisions).toBe(60)
    expect(brief.worstDecisions).toHaveLength(12)
    // Worst first.
    const lost = brief.worstDecisions.map((d) => Number(d.evLost.replace('$', '')))
    expect(lost).toEqual([...lost].sort((a, b) => b - a))
  })

  it('leaves out tendencies that do not have the sample to support them', () => {
    const thin = leakBrief(accumulate(emptyTotals(), {
      ...history().recent[0], handNumber: 1,
    }), [])
    expect(thin.tendencies).toHaveLength(0)
  })

  it('flags a provisional rating so the narrator does not overstate it', () => {
    const { totals, recent } = history()
    expect(leakBrief(totals, recent).provisional).toBe(true)
  })
})

describe('the narrator client', () => {
  it('is unavailable, and says so, with nothing configured', async () => {
    expect(narratorEndpoint('')).toBe('')
    expect(offlineNarrator.available).toBe(false)
    await expect(offlineNarrator.narrate({ kind: 'leaks', brief: {} as never }))
      .rejects.toThrow(/No coach endpoint/)
  })

  it('posts the brief and returns what came back', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ text: 'You are priced in.' }), { status: 200 })
    }) as typeof fetch

    const { advice } = spot()
    const result = await httpNarrator('https://coach.example/api')
      .narrate({ kind: 'decision', brief: decisionBrief(advice, 'on the button') })

    expect(result.text).toBe('You are priced in.')
    expect(calls[0].url).toBe('https://coach.example/api')
    expect((calls[0].body as { kind: string }).kind).toBe('decision')
  })

  /** Run a narration that is expected to fail, and hand back the error. */
  async function failure(): Promise<NarratorError> {
    try {
      await httpNarrator('https://coach.example/api').narrate({ kind: 'leaks', brief: {} as never })
    } catch (cause) {
      if (cause instanceof NarratorError) return cause
      throw cause
    }
    throw new Error('expected the narration to fail, but it succeeded')
  }

  it('marks a rate limit retryable and a bad request not', async () => {
    const respond = (status: number) => {
      globalThis.fetch = vi.fn(async () => new Response('nope', { status })) as typeof fetch
      return failure()
    }
    expect((await respond(429)).retryable).toBe(true)
    expect((await respond(503)).retryable).toBe(true)
    expect((await respond(400)).retryable).toBe(false)
  })

  it('treats an unreachable service as retryable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as typeof fetch
    expect((await failure()).retryable).toBe(true)
  })

  it('rejects a body that is not a narration result', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ nonsense: true }), { status: 200 })) as typeof fetch
    await expect(
      httpNarrator('https://coach.example/api').narrate({ kind: 'leaks', brief: {} as never }),
    ).rejects.toThrow(/unreadable/)
  })

  it('passes the abort signal through so a stale question can be cancelled', async () => {
    const controller = new AbortController()
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    }) as unknown as typeof fetch
    await httpNarrator('https://c/api')
      .narrate({ kind: 'leaks', brief: {} as never }, controller.signal)
  })
})

describe('the proxy, short of calling the model', () => {
  const post = (body: unknown) =>
    handler(new Request('http://localhost/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))

  it('refuses anything but a POST', async () => {
    const response = await handler(new Request('http://localhost/api/coach'))
    expect(response.status).toBe(405)
  })

  it('reports a missing key rather than failing obscurely', async () => {
    const had = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    const response = await post({ kind: 'leaks', brief: {} })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/API key/) })
    if (had) process.env.ANTHROPIC_API_KEY = had
  })

  it('rejects an unknown brief before spending anything', async () => {
    const had = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key-not-used'
    const response = await post({ kind: 'something-else' })
    expect(response.status).toBe(400)
    if (had) process.env.ANTHROPIC_API_KEY = had
    else delete process.env.ANTHROPIC_API_KEY
  })

  it('rejects an unreadable body', async () => {
    const had = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key-not-used'
    const response = await handler(new Request('http://localhost/api/coach', {
      method: 'POST', body: 'not json',
    }))
    expect(response.status).toBe(400)
    if (had) process.env.ANTHROPIC_API_KEY = had
    else delete process.env.ANTHROPIC_API_KEY
  })
})

describe('parsing helpers used by the briefs', () => {
  it('formats outs the way the panel shows them', () => {
    const seats = evenSeats(2)
    const hand = newHand(seats, 0)
    dealHand(hand, seats, stackedShoe('2c 3d  9s 8s'))
    setHoleCards(hand, { 1: '9s 8s' })
    hand.board = parseCards('As Ks 2h')
    hand.street = 'flop'
    const brief = decisionBrief(advise(hand, seats, 1, mulberry32(5), 300), 'on the button')
    const flush = brief.outs.find((o) => o.makes === 'Flush')
    expect(flush).toMatchObject({ count: 9 })
    expect(flush!.byRiver).toMatch(/^3[45]\./)
  })
})

describe('choosing how to reach the narrator', () => {
  it('is off with neither a proxy nor a key', () => {
    const { via, narrator } = chooseNarrator('', '')
    expect(via).toBe('none')
    expect(narrator.available).toBe(false)
  })

  it('uses a key when that is all there is', () => {
    const { via, narrator } = chooseNarrator('', 'sk-ant-test')
    expect(via).toBe('key')
    expect(narrator.available).toBe(true)
  })

  it('prefers the proxy when both are set', () => {
    // The proxy exists to keep the key off the device; quietly preferring the
    // browser key here would undo the only reason to run one.
    expect(chooseNarrator('https://coach.example/api', 'sk-ant-test').via).toBe('proxy')
  })

  it('ignores whitespace-only configuration', () => {
    expect(chooseNarrator('   ', '  ').via).toBe('none')
    expect(chooseNarrator('   ', 'sk-ant-test').via).toBe('key')
  })
})

/** A browser-key config for Claude, which is what most of these exercise. */
function claude(apiKey: string): ProviderConfig {
  return { id: 'anthropic', model: '', apiKey }
}

describe('choosing a narrator with a provider config', () => {
  it('will not go live without the model a service has no default for', () => {
    expect(chooseNarrator('', { id: 'openai', model: '', apiKey: 'sk-1' }).via).toBe('none')
    expect(chooseNarrator('', { id: 'openai', model: 'gpt-x', apiKey: 'sk-1' }).via).toBe('key')
  })

  it('lets Anthropic run on its default model', () => {
    expect(chooseNarrator('', { id: 'anthropic', model: '', apiKey: 'sk-ant-1' }).via).toBe('key')
  })

  it('still prefers the proxy over any key', () => {
    expect(chooseNarrator('https://coach.example/api', { id: 'openai', model: 'm', apiKey: 'k' }).via)
      .toBe('proxy')
  })
})

describe('the direct browser narrator', () => {
  it('refuses to run without a key', async () => {
    const narrator = directNarrator(claude(''))
    expect(narrator.available).toBe(false)
    await expect(narrator.narrate({ kind: 'leaks', brief: {} as never }))
      .rejects.toThrow(/No API key/)
  })

  /**
   * Load a fresh copy of the module with the SDK stubbed out. The assertions
   * use that copy's own `NarratorError`, because a re-imported module brings a
   * new class object and `instanceof` against the outer one would fail even
   * though the behaviour is right.
   */
  async function withStubbedSdk(status: number) {
    vi.resetModules()
    const fail = async () => { throw Object.assign(new Error('stub'), { status }) }
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        beta = { messages: { create: fail } }
        messages = { parse: fail }
      },
    }))
    return import('./narrator')
  }

  it('turns a rejected key into a clear, non-retryable error', async () => {
    const mod = await withStubbedSdk(401)
    const { advice } = spot()
    const error = await mod.directNarrator(claude('sk-ant-wrong'))
      .narrate({ kind: 'decision', brief: decisionBrief(advice, 'on the button') })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(mod.NarratorError)
    expect((error as NarratorError).message).toMatch(/rejected/)
    expect((error as NarratorError).retryable).toBe(false)
    vi.doUnmock('@anthropic-ai/sdk')
    vi.resetModules()
  })

  it('routes to whichever provider the config names', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Fold.' } }] }))
    }) as unknown as typeof fetch
    const { advice } = spot()

    const answer = await directNarrator({
      id: 'openai', model: 'gpt-x', apiKey: 'sk-1', baseUrl: 'https://elsewhere.test/v1',
    }).narrate({ kind: 'decision', brief: decisionBrief(advice, 'on the button') })

    expect(answer.text).toBe('Fold.')
    expect(calls).toEqual(['https://elsewhere.test/v1/chat/completions'])
  })

  it('passes a provider failure through with its retry advice intact', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    const { advice } = spot()

    const error = await directNarrator({ id: 'openai', model: 'm', apiKey: 'k' })
      .narrate({ kind: 'decision', brief: decisionBrief(advice, 'on the button') })
      .catch((e: unknown) => e as NarratorError)

    expect(error).toBeInstanceOf(NarratorError)
    expect((error as NarratorError).retryable).toBe(true)
  })

  it('marks a rate limit and a server fault as worth retrying', async () => {
    for (const status of [429, 503]) {
      const mod = await withStubbedSdk(status)
      const { advice } = spot()
      const error = await mod.directNarrator(claude('sk-ant-test'))
        .narrate({ kind: 'decision', brief: decisionBrief(advice, 'on the button') })
        .catch((e: unknown) => e as NarratorError)
      expect((error as NarratorError).retryable, `status ${status}`).toBe(true)
      vi.doUnmock('@anthropic-ai/sdk')
      vi.resetModules()
    }
  })
})
