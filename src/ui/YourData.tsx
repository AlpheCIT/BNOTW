/**
 * What happens to your history, in the words a player needs.
 *
 * Written for whoever is handed this app rather than for whoever built it.
 * Everyone who opens the URL gets their own history automatically — there is
 * nothing to sign up for and nothing to configure — but two things are not
 * obvious and both cost you the history if you get them wrong: on iOS the
 * storage is only durable once the app is on the home screen, and a different
 * browser is a different history.
 *
 * The platform text is picked from the user agent. That is famously
 * unreliable, so a wrong guess has to be harmless: every platform's steps are
 * reachable, the detected one is merely shown first.
 */

import { useState } from 'react'

type Platform = 'ios' | 'android' | 'desktop'

function detect(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  // iPadOS has reported itself as a Mac for years, so the user agent alone
  // cannot tell them apart. Touch is the tiebreak: Apple does not sell a
  // touchscreen Mac, so a "Macintosh" that takes touch is an iPad. Any touch
  // at all rather than several — emulators and some browsers report one point
  // where a real iPad reports five, and being strict here fails closed on
  // exactly the device this text matters most for.
  if (/iPhone|iPod/.test(ua)) return 'ios'
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

const STEPS: Record<Platform, { label: string; install: string[] }> = {
  ios: {
    label: 'iPhone / iPad',
    install: [
      'Open this page in Safari. It has to be Safari — other browsers on iOS cannot install it.',
      'Tap the Share button (the square with the arrow).',
      'Scroll down and tap "Add to Home Screen", then "Add".',
      'Open it from the home screen from now on, not from Safari.',
    ],
  },
  android: {
    label: 'Android',
    install: [
      'Open this page in Chrome.',
      'Tap "Install app" if it offers, or the ⋮ menu then "Add to Home screen".',
      'Open it from the home screen from now on.',
    ],
  },
  desktop: {
    label: 'Computer',
    install: [
      'In Chrome or Edge, click the install icon in the address bar.',
      'In Safari, use File then "Add to Dock".',
      'Or just bookmark it — on a computer the history is kept either way.',
    ],
  },
}

export function YourData() {
  const [platform, setPlatform] = useState<Platform>(detect)
  const steps = STEPS[platform]

  return (
    <div className="yourdata">
      <h3>Your history is yours</h3>
      <p className="sub">
        Everything you play is recorded on this device, in this browser, and goes
        nowhere else. There is no account and nothing to set up — just play and it
        builds up. Nobody else can see it, including whoever sent you the link.
      </p>

      <h3 style={{ marginTop: 16 }}>Add it to your home screen</h3>
      <p className="sub">
        Worth doing before you play much. It opens full screen, works with no
        signal, and — on an iPhone or iPad especially — it is what stops the
        browser clearing your history when you have not opened it for a while.
        A poker night is weekly; that is exactly the gap at risk.
      </p>

      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        {(Object.keys(STEPS) as Platform[]).map((key) => (
          <button
            key={key}
            className={`btn small ${platform === key ? '' : 'ghost'}`}
            onClick={() => setPlatform(key)}
          >
            {STEPS[key].label}
          </button>
        ))}
      </div>

      <ol className="steps">
        {steps.install.map((step) => <li key={step}>{step}</li>)}
      </ol>

      <h3 style={{ marginTop: 16 }}>Keeping a copy</h3>
      <p className="sub">
        Browser storage is not a safe deposit box: it goes if you clear site data,
        change browser, or lose the device. Every so often — the end of a night is
        the natural moment — use <b>Backup JSON</b> above and save the file
        somewhere real, like Files or iCloud Drive. <b>Import JSON</b> puts it back,
        and is also how you move to a new phone.
      </p>

      <h3 style={{ marginTop: 16 }}>One history per browser</h3>
      <p className="sub">
        Safari on your phone and Chrome on your laptop keep separate histories, and
        neither knows about the other. Pick one and stay with it, or move between
        them with Backup and Import.
      </p>
    </div>
  )
}
