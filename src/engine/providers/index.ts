/**
 * Picking a provider.
 *
 * Adding one means writing a file beside this and adding a line here. Nothing
 * above this directory knows which model answered.
 *
 * Nothing here imports an implementation at the top level, deliberately: the
 * adapters pull in SDKs and schema libraries, and a static import would put
 * all of them in the main bundle for the sake of a couple of strings.
 */

import type { Provider, ProviderConfig, ProviderId } from './types'

export type { Provider, ProviderConfig, ProviderId, ReviewAnswer } from './types'
export { ProviderError } from './types'

export interface ProviderInfo {
  id: ProviderId
  label: string
  /** What to put in the model field. */
  modelHint: string
  defaultModel: string
  /** Whether a browser can talk to it directly, or it needs the proxy. */
  browserDirect: boolean
  note: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    modelHint: 'claude-opus-5',
    defaultModel: 'claude-opus-5',
    browserDirect: true,
    note: 'Works with a key straight from the browser, or behind the proxy.',
  },
  {
    id: 'openai',
    label: 'OpenAI, or anything OpenAI-compatible',
    modelHint: 'the model or Azure deployment name',
    defaultModel: '',
    browserDirect: true,
    note:
      'Also covers Azure OpenAI, Groq, Together, OpenRouter and local servers — ' +
      'set the base URL to the service. Azure needs the api-key header rather than a bearer token.',
  },
]

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

/** Build a provider. The implementation is loaded on demand. */
export async function createProvider(config: ProviderConfig): Promise<Provider> {
  switch (config.id) {
    case 'openai': {
      const { openAiCompatibleProvider } = await import('./openaiCompatible')
      return openAiCompatibleProvider(config)
    }
    default: {
      const { anthropicProvider } = await import('./anthropic')
      return anthropicProvider(config)
    }
  }
}
