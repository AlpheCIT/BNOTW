/**
 * Registering the service worker, and noticing when a new build is waiting.
 *
 * The worker deliberately does not take over a page that is already open: the
 * running page belongs to the previous build and may still lazily import a
 * chunk whose name changed. So a new build waits, the app says so, and the
 * player reloads when it suits them — mid-hand is exactly when it would not.
 */

import { useEffect, useState } from 'react'

export interface AppUpdate {
  /** A new build is installed and waiting for a reload. */
  ready: boolean
  /** Activate it and reload. */
  apply: () => void
}

export function useAppUpdate(): AppUpdate {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // In development the modules are served unbundled; a worker caching them
    // would only get in the way.
    if (import.meta.env.DEV) return

    let cancelled = false

    // Relative, so it works when the app is served from a subdirectory.
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).then((registration) => {
      if (cancelled) return

      const track = (worker: ServiceWorker | null) => {
        if (!worker) return
        const check = () => {
          // Only an update, never a first install: with no controller yet this
          // is the very first visit, and there is nothing to reload into.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(worker)
          }
        }
        check()
        worker.addEventListener('statechange', check)
      }

      track(registration.waiting)
      registration.addEventListener('updatefound', () => track(registration.installing))
    }).catch(() => {
      // No worker means no offline support, which is a degradation and not a
      // failure. The app works exactly as it does in a normal tab.
    })

    return () => { cancelled = true }
  }, [])

  return {
    ready: waiting !== null,
    apply: () => {
      if (!waiting) return
      // Reload once the new worker has actually taken control, not before.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload()
      }, { once: true })
      waiting.postMessage('skip-waiting')
    },
  }
}
