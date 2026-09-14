import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NO_COACH_CREDS, loadCoachCreds, saveCoachCreds } from './storage'

/** A localStorage good enough to exercise the coach credentials. */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    keys: () => [...map.keys()],
  }
}

let store: ReturnType<typeof fakeStorage>

beforeEach(() => {
  store = fakeStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = store
})
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

describe('the coach credentials', () => {
  it('start empty, on Anthropic', () => {
    expect(loadCoachCreds()).toEqual(NO_COACH_CREDS)
  })

  it('survive a round trip', () => {
    const creds = {
      provider: 'openai' as const,
      model: 'my-deployment',
      apiKey: 'secret',
      baseUrl: 'https://mine.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21',
      auth: 'api-key' as const,
    }
    saveCoachCreds(creds)
    expect(loadCoachCreds()).toEqual(creds)
  })

  it('carries over a key stored before there were providers', () => {
    store.setItem('bnotw.coachkey.v1', 'sk-ant-old')
    expect(loadCoachCreds()).toEqual({ ...NO_COACH_CREDS, apiKey: 'sk-ant-old' })
  })

  it('leaves no copy of the key behind once it is saved in the new shape', () => {
    store.setItem('bnotw.coachkey.v1', 'sk-ant-old')
    saveCoachCreds({ ...NO_COACH_CREDS, apiKey: 'sk-ant-new' })
    expect(store.getItem('bnotw.coachkey.v1')).toBeNull()
  })

  it('clears the record entirely when the key is removed', () => {
    saveCoachCreds({ ...NO_COACH_CREDS, apiKey: 'secret' })
    saveCoachCreds({ ...NO_COACH_CREDS, apiKey: '' })
    expect(store.keys()).toEqual([])
    expect(loadCoachCreds()).toEqual(NO_COACH_CREDS)
  })

  it('refuses to trust a mangled record', () => {
    store.setItem('bnotw.coachcreds.v1', '{"provider":"evil","model":7,"apiKey":"k"}')
    expect(loadCoachCreds()).toEqual({ ...NO_COACH_CREDS, apiKey: 'k' })
  })

  it('does not throw when storage itself is unavailable', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(loadCoachCreds()).toEqual(NO_COACH_CREDS)
    expect(() => saveCoachCreds(NO_COACH_CREDS)).not.toThrow()
  })
})
