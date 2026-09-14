/**
 * Run the coach proxy locally.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run coach
 *
 * Any other provider is configured the same way the deployed proxy is, with
 * COACH_PROVIDER, COACH_MODEL, COACH_API_KEY and friends — see .env.example.
 *
 * Then point the app at it, either with VITE_COACH_ENDPOINT in a .env.local or
 * by pasting the URL into Settings -> Coach narrator.
 *
 * This is a thin Node wrapper around the same Web-standard handler that runs in
 * production, so there is only one code path to keep correct.
 */

import { createServer } from 'node:http'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.PORT ?? 8787)

// The handler is TypeScript; let Vite compile it rather than adding a build step.
const { createServer: createVite } = await import('vite')
const vite = await createVite({ server: { middlewareMode: true }, appType: 'custom' })
void register
void pathToFileURL

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
      'cache-control': 'no-store',
    })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  if (req.method === 'OPTIONS') return send(204, '')

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')

    const mod = await vite.ssrLoadModule('/api/coach.ts')
    const response = await mod.default(
      new Request(`http://localhost:${PORT}${req.url}`, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        body: req.method === 'POST' ? body : undefined,
      }),
    )
    send(response.status, await response.text())
  } catch (error) {
    console.error(error)
    send(500, { error: 'The dev proxy fell over. See the terminal.' })
  }
})

server.listen(PORT, () => {
  const provider = process.env.COACH_PROVIDER?.trim() || 'anthropic'
  const hasKey = provider === 'anthropic'
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.COACH_API_KEY || process.env.OPENAI_API_KEY)
  const keyed = hasKey
    ? 'with a key'
    : `WITHOUT a key — set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'COACH_API_KEY'}`
  console.log(`Coach proxy on http://localhost:${PORT} (${provider}, ${keyed})`)
})
