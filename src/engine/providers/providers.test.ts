import { describe, it, expect, vi, afterEach } from 'vitest'
import { mulberry32 } from '../cards'
import { advise } from '../coach'
import { decisionBrief, leakBrief } from '../brief'
import { emptyTotals, type HandRecord } from '../playerStats'
import { dealHand, applyAction, advanceStreet } from '../hand'
import { evenSeats, newHand, stackedShoe } from '../testkit'
import { PROVIDERS, createProvider, providerInfo } from './index'
import { openAiCompatibleProvider, parseReview } from './openaiCompatible'
import { ProviderError, errorForStatus } from './types'
import { configFromEnv } from '../../../api/coach'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

/** A spot with a real, computed advice object behind it. */
function brief() {
  const seats = evenSeats(3)
  const hand = newHand(seats, 2)
  dealHand(hand, seats, stackedShoe('9s 8s  Ks Kh  Qs Qh'))
  applyAction(hand, seats, 2, { kind: 'call' })
  applyAction(hand, seats, 0, { kind: 'call' })
  applyAction(hand, seats, 1, { kind: 'check' })
  advanceStreet(hand, stackedShoe('2d  As Ks 2h'))
  applyAction(hand, seats, 0, { kind: 'bet', amount: 100 })
  return decisionBrief(advise(hand, seats, 1, mulberry32(7), 400), 'on the button')
}

/** A stub service that records what it was asked and answers with `body`. */
function stubService(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return calls
}

function answer(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('the provider catalogue', () => {
  it('lists every provider the factory can build', async () => {
    for (const info of PROVIDERS) {
      const provider = await createProvider({ id: info.id, model: 'm', apiKey: 'k' })
      expect(typeof provider.explain, info.id).toBe('function')
      expect(typeof provider.review, info.id).toBe('function')
    }
  })

  it('falls back to a real entry rather than undefined for an unknown id', () => {
    expect(providerInfo('nonsense' as never).id).toBe('anthropic')
  })
})

describe('the OpenAI-compatible adapter', () => {
  it('posts to OpenAI by default, with a bearer token', async () => {
    const calls = stubService(answer('Call. You have the odds.'))
    const provider = await openAiCompatibleProvider({ id: 'openai', model: 'gpt-x', apiKey: 'sk-1' })

    const text = await provider.explain(brief(), {})

    expect(text).toBe('Call. You have the odds.')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-1')
    expect(headers['api-key']).toBeUndefined()
    const sent = JSON.parse(calls[0].init.body as string)
    expect(sent.model).toBe('gpt-x')
    expect(sent.messages.at(-1).role).toBe('user')
  })

  it('sends the key in an api-key header when asked, for Azure', async () => {
    const calls = stubService(answer('ok'))
    const provider = await openAiCompatibleProvider({
      id: 'openai',
      model: 'my-deployment',
      apiKey: 'azure-secret',
      baseUrl: 'https://mine.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21',
      auth: 'api-key',
    })

    await provider.explain(brief(), {})

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['api-key']).toBe('azure-secret')
    expect(headers.authorization).toBeUndefined()
    // A full deployment URL is left exactly as pasted, query string and all.
    expect(calls[0].url).toContain('api-version=2024-10-21')
    expect(calls[0].url).not.toContain('/chat/completions/chat/completions')
  })

  it('appends the path to a bare base URL, trailing slash or not', async () => {
    for (const base of ['http://localhost:1234/v1', 'http://localhost:1234/v1/']) {
      const calls = stubService(answer('ok'))
      const provider = await openAiCompatibleProvider({
        id: 'openai', model: 'local', apiKey: 'x', baseUrl: base,
      })
      await provider.explain(brief(), {})
      expect(calls[0].url, base).toBe('http://localhost:1234/v1/chat/completions')
    }
  })

  it('carries the last few turns of a conversation', async () => {
    const calls = stubService(answer('ok'))
    const provider = await openAiCompatibleProvider({ id: 'openai', model: 'm', apiKey: 'k' })

    await provider.explain(brief(), {
      question: 'Why not raise?',
      history: Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
        text: `turn ${i}`,
      })),
    })

    const sent = JSON.parse(calls[0].init.body as string)
    // Six of history plus the question: an unbounded history would grow the
    // cost of every follow-up without making the answers better.
    expect(sent.messages).toHaveLength(7)
    expect(sent.messages[0].content).toBe('turn 4')
    expect(sent.messages.at(-1).content).toContain('Why not raise?')
  })

  it('turns a rejected key into a clear, non-retryable error', async () => {
    stubService({ error: { message: 'invalid api key' } }, 401)
    const provider = await openAiCompatibleProvider({ id: 'openai', model: 'm', apiKey: 'bad' })

    const error = await provider.explain(brief(), {}).catch((e: unknown) => e as ProviderError)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).message).toMatch(/rejected/)
    expect((error as ProviderError).retryable).toBe(false)
  })

  it('marks a rate limit and a server fault as worth retrying', async () => {
    for (const status of [429, 503]) {
      stubService({}, status)
      const provider = await openAiCompatibleProvider({ id: 'openai', model: 'm', apiKey: 'k' })
      const error = await provider.explain(brief(), {}).catch((e: unknown) => e as ProviderError)
      expect((error as ProviderError).retryable, `status ${status}`).toBe(true)
    }
  })

  it('says so rather than returning nothing when the answer is empty', async () => {
    stubService(answer('   '))
    const provider = await openAiCompatibleProvider({ id: 'openai', model: 'm', apiKey: 'k' })
    await expect(provider.explain(brief(), {})).rejects.toThrow(/empty/)
  })

  it('asks for JSON on a review and reads the findings back', async () => {
    const calls = stubService(answer(JSON.stringify({
      summary: 'You call too much out of the blinds.',
      findings: [{ title: 'Blind defence', detail: 'Too wide.', fix: 'Fold the worst of it.' }],
    })))
    const provider = await openAiCompatibleProvider({ id: 'openai', model: 'm', apiKey: 'k' })

    const totals = emptyTotals()
    const review = await provider.review(leakBrief(totals, [] as HandRecord[]), {})

    expect(JSON.parse(calls[0].init.body as string).response_format).toEqual({ type: 'json_object' })
    expect(review.summary).toMatch(/call too much/)
    expect(review.findings).toHaveLength(1)
    expect(review.findings[0].fix).toBe('Fold the worst of it.')
  })
})

describe('reading a review out of whatever came back', () => {
  it('keeps prose as the summary when a service ignores the JSON request', () => {
    const review = parseReview('You are folding the button far too often.')
    expect(review.summary).toBe('You are folding the button far too often.')
    expect(review.findings).toEqual([])
  })

  it('unwraps a fenced code block', () => {
    const review = parseReview('```json\n{"summary":"Fine.","findings":[]}\n```')
    expect(review.summary).toBe('Fine.')
  })

  it('drops junk entries and caps the list', () => {
    const review = parseReview(JSON.stringify({
      summary: 'Four at most.',
      findings: [
        null,
        'not an object',
        { detail: 'no title, but says something' },
        { title: 'a', detail: 'b', fix: 'c' },
        { title: 'd' },
        { title: 'e' },
        { title: 'f' },
        { title: 'g' },
      ],
    }))
    expect(review.findings).toHaveLength(4)
    expect(review.findings.every((f) => f.title || f.detail)).toBe(true)
    // Missing fields become empty strings rather than "undefined" on screen.
    expect(review.findings[0].fix).toBe('')
  })

  it('does not lose an answer that has findings but no summary', () => {
    const review = parseReview(JSON.stringify({ findings: [{ title: 'a', detail: 'b', fix: 'c' }] }))
    expect(review.findings).toHaveLength(1)
    expect(review.summary).toBe('')
  })
})

describe('mapping a status onto advice', () => {
  it('treats what the player can fix as final, and the rest as retryable', () => {
    expect(errorForStatus(401, 'X').retryable).toBe(false)
    expect(errorForStatus(403, 'X').retryable).toBe(false)
    expect(errorForStatus(404, 'X').message).toMatch(/not found/)
    expect(errorForStatus(429, 'X').retryable).toBe(true)
    expect(errorForStatus(500, 'X').retryable).toBe(true)
    expect(errorForStatus(undefined, 'X').retryable).toBe(false)
  })
})

describe('the proxy reading its provider from the environment', () => {
  it('defaults to Anthropic and leaves the key to the SDK', () => {
    const resolved = configFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-x' })
    expect(resolved).toEqual({ config: { id: 'anthropic', model: '', apiKey: '' } })
  })

  it('says which piece is missing rather than just refusing', () => {
    expect(configFromEnv({})).toEqual({ error: expect.stringMatching(/API key/) })
    expect(configFromEnv({ COACH_PROVIDER: 'openai' }))
      .toEqual({ error: expect.stringMatching(/COACH_API_KEY/) })
    expect(configFromEnv({ COACH_PROVIDER: 'openai', COACH_API_KEY: 'k' }))
      .toEqual({ error: expect.stringMatching(/COACH_MODEL/) })
  })

  it('builds an Azure config from the environment', () => {
    const resolved = configFromEnv({
      COACH_PROVIDER: 'openai',
      COACH_API_KEY: 'k',
      COACH_MODEL: 'my-deployment',
      COACH_BASE_URL: 'https://mine.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21',
      COACH_AUTH: 'api-key',
    })
    expect(resolved).toEqual({
      config: {
        id: 'openai',
        model: 'my-deployment',
        apiKey: 'k',
        baseUrl: 'https://mine.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21',
        auth: 'api-key',
      },
    })
  })
})
