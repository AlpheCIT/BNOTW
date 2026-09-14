import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BUY_IN_CASH, BUY_IN_CHIPS, HIGH_ROLLER_FEE, money, owesHighRollerFee, signedMoney,
} from './engine/bnotw'
import type { Persona } from './engine/persona'
import { PROVIDERS, providerInfo } from './engine/providers'
import type { BombPotTrigger, TableSettings } from './engine/table'
import { blankNight, makeId, type GameNight, type NightPlayer } from './state/records'
import {
  loadBook, loadCoachCreds, loadRoster, loadSettings, saveBook, saveCoachCreds,
  saveRoster, saveSettings,
  type CoachCreds, type RecordBook, type RosterState,
} from './state/storage'
import { CoachScorecard } from './ui/CoachPanel'
import { DrillView } from './ui/DrillView'
import { PlayersView } from './ui/Players'
import { RecordBookView } from './ui/RecordBook'
import { RulesView } from './ui/RulesView'
import { StatsView } from './ui/StatsView'
import { TableView } from './ui/TableView'
import { useAppUpdate } from './ui/useAppUpdate'
import { useCoach } from './ui/useCoach'
import { useDrill } from './ui/useDrill'
import { useGame, type Speed } from './ui/useGame'
import { useNarrator } from './ui/useNarrator'
import { useTracker } from './ui/useTracker'

type Tab = 'table' | 'coach' | 'drill' | 'stats' | 'players' | 'book' | 'rules'

const TABS: [Tab, string][] = [
  ['table', 'Table'],
  ['coach', 'Coach'],
  ['drill', 'Drill'],
  ['stats', 'My Game'],
  ['players', 'Players'],
  ['book', 'Book'],
  ['rules', 'Rules'],
]

interface Preferences {
  playerName: string
  bombPotTrigger: BombPotTrigger
  bombPotHands: number
  bombPotMinutes: number
  bombPotGameChoice: TableSettings['bombPotGameChoice']
  straddleMultiplier: number
  speed: Speed
  /** Where the coach narrator lives. Empty means explanations are off. */
  coachEndpoint: string
  /** Ask twice before a fold or an all-in you probably did not mean. */
  confirmBigActions: boolean
}

const DEFAULT_PREFS: Preferences = {
  playerName: 'You',
  bombPotTrigger: 'hands',
  bombPotHands: 12,
  bombPotMinutes: 30,
  bombPotGameChoice: 'dealer',
  straddleMultiplier: 1,
  speed: 'normal',
  coachEndpoint: '',
  confirmBigActions: true,
}

/** The personas actually sitting down, in the order they were seated. */
function seatedPersonas(roster: RosterState): Persona[] {
  return roster.seated
    .map((id) => roster.players.find((p) => p.id === id))
    .filter((p): p is Persona => Boolean(p))
}

export default function App() {
  const [tab, setTab] = useState<Tab>('table')
  const [prefs, setPrefs] = useState<Preferences>(() => loadSettings(DEFAULT_PREFS))
  const [book, setBookState] = useState<RecordBook>(() => loadBook())
  const [roster, setRosterState] = useState<RosterState>(() => loadRoster())
  const [openNightId, setOpenNightId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showCashOut, setShowCashOut] = useState(false)
  const [showCoachStats, setShowCoachStats] = useState(false)
  // Held apart from the rest of the settings so it never rides along in an export.
  const [coachCreds, setCoachCredsState] = useState<CoachCreds>(() => loadCoachCreds())

  const opponents = useMemo(() => seatedPersonas(roster), [roster])
  const tableSettings = useMemo<Partial<TableSettings>>(
    () => ({ ...prefs, opponents }),
    [prefs, opponents],
  )

  // Two separate tables, so coaching never touches the session you are keeping
  // records for. Only the one on screen ticks.
  const guardOptions = useMemo(
    () => ({ enabled: prefs.confirmBigActions }),
    [prefs.confirmBigActions],
  )
  // Both are remembered across a reload, each under its own mode. A coach
  // session is still not a night — it never reaches the Record Book — but
  // losing one to a reclaimed tab is as annoying as losing a real one.
  const game = useGame(tableSettings, tab === 'table', 'table')
  const coachGame = useGame(tableSettings, tab === 'coach', 'coach')
  const coach = useCoach()
  const tracker = useTracker()
  const update = useAppUpdate()
  // Seeded from your real record, so the weakest street comes up most.
  const drill = useDrill(opponents, tracker.totals, prefs.playerName, tab === 'drill')
  // Two narrators: an explanation at the table is about one decision, and a
  // review in My Game is about a whole history. Sharing one would have each
  // wipe the other's answer.
  const narratorConfig = useMemo(() => ({
    id: coachCreds.provider,
    model: coachCreds.model,
    apiKey: coachCreds.apiKey,
    baseUrl: coachCreds.baseUrl,
    auth: coachCreds.auth,
  }), [coachCreds])
  const tableNarrator = useNarrator(prefs.coachEndpoint, narratorConfig)
  const reviewNarrator = useNarrator(prefs.coachEndpoint, narratorConfig)

  useEffect(() => { saveSettings(prefs) }, [prefs])
  useEffect(() => {
    game.setSpeed(prefs.speed)
    coachGame.setSpeed(prefs.speed)
  }, [prefs.speed, game, coachGame])

  const setBook = useCallback((next: RecordBook) => {
    setBookState(next)
    saveBook(next)
  }, [])

  const setCoachCreds = useCallback((next: CoachCreds) => {
    setCoachCredsState(next)
    saveCoachCreds(next)
  }, [])

  const setRoster = useCallback((next: RosterState) => {
    setRosterState(next)
    saveRoster(next)
  }, [])

  /** Seat changes need a fresh deal; stacks from the old line-up mean nothing. */
  const reseat = useCallback(() => {
    const next = seatedPersonas(roster)
    game.restart({ ...prefs, opponents: next })
    coachGame.restart({ ...prefs, opponents: next })
  }, [roster, prefs, game, coachGame])

  /** Turn the current session into a night in the Record Book. */
  const saveSessionToBook = useCallback(() => {
    const { table } = game
    const dexterBySeat = new Map<number, number>()
    for (const d of table.dexterLog) {
      dexterBySeat.set(d.seat, (dexterBySeat.get(d.seat) ?? 0) + 1)
    }

    const players: NightPlayer[] = table.seats.map((seat) => ({
      id: makeId(),
      name: seat.name,
      buyIns: seat.buyIns,
      cashOut: seat.stack,
      dexterWins: dexterBySeat.get(seat.seat) ?? 0,
    }))

    const night: GameNight = {
      ...blankNight(),
      source: 'app',
      players,
      finalDexterLevel: table.dexterCount,
    }

    setBook({ version: 1, nights: [night, ...book.nights] })
    setOpenNightId(night.id)
    setShowCashOut(false)
    setTab('book')
    // The night is settled and in the book, so the session is over. Dealing on
    // from the same stacks would let a second cash-out record it all again.
    game.restart({ ...prefs, opponents })
  }, [game, book.nights, setBook, prefs, opponents])

  return (
    <div className="app">
      {update.ready && (
        <div className="update-bar" role="status">
          <span>A new version is ready.</span>
          <button className="btn small" onClick={update.apply}>Reload</button>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <b>BNOTW</b>
          <span>Best Night Of The Week</span>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn small ghost" onClick={() => setShowSettings(true)} aria-label="Settings">
          ⚙
        </button>
      </header>

      <main className="screen">
        {tab === 'table' && (
          <TableView
            game={game}
            onCashOut={() => setShowCashOut(true)}
            tracker={tracker}
            mode="table"
            guardOptions={guardOptions}
          />
        )}
        {tab === 'coach' && (
          <>
            <div className="coach-bar">
              <span className="tag" style={{ color: '#6fd3e8' }}>Coach mode</span>
              <span className="faint" style={{ fontSize: 11.5 }}>
                A separate table, kept between visits. Nothing here reaches the
                Record Book.
              </span>
              <span className="spacer" />
              {/* The session persists now, so there has to be a way out of it. */}
              <button
                className="btn small ghost"
                onClick={() => coachGame.restart({ ...prefs, opponents })}
              >
                Fresh table
              </button>
              <button className="btn small ghost" onClick={() => setShowCoachStats(true)}>
                Your stats
              </button>
            </div>
            <TableView
              game={coachGame}
              onCashOut={() => {}}
              coach={coach}
              tracker={tracker}
              mode="coach"
              narrator={tableNarrator}
              guardOptions={guardOptions}
            />
          </>
        )}
        {tab === 'drill' && <DrillView drill={drill} />}
        {tab === 'stats' && <StatsView tracker={tracker} narrator={reviewNarrator} />}
        {tab === 'players' && (
          <PlayersView roster={roster} setRoster={setRoster} onSeatChange={reseat} />
        )}
        {tab === 'book' && (
          <RecordBookView
            book={book}
            setBook={setBook}
            openNightId={openNightId}
            onOpenNight={setOpenNightId}
          />
        )}
        {tab === 'rules' && <RulesView />}
      </main>

      {showSettings && (
        <SettingsDialog
          prefs={prefs}
          creds={coachCreds}
          onCreds={setCoachCreds}
          onClose={() => setShowSettings(false)}
          onApply={(next, restart) => {
            setPrefs(next)
            setShowSettings(false)
            if (restart) {
              game.restart({ ...next, opponents })
              coachGame.restart({ ...next, opponents })
            }
          }}
        />
      )}

      {showCashOut && (
        <CashOutDialog
          game={game}
          onClose={() => setShowCashOut(false)}
          onSave={saveSessionToBook}
        />
      )}

      {showCoachStats && (
        <div className="overlay" onClick={() => setShowCoachStats(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Coach Scorecard</h2>
            <p className="sub">
              How often your decisions matched the recommendation, and what the gap
              costs. Kept separately from your table records.
            </p>
            <CoachScorecard stats={coach.stats} onReset={coach.reset} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={() => setShowCoachStats(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function SettingsDialog({
  prefs, creds, onCreds, onClose, onApply,
}: {
  prefs: Preferences
  creds: CoachCreds
  onCreds: (creds: CoachCreds) => void
  onClose: () => void
  onApply: (prefs: Preferences, restart: boolean) => void
}) {
  const [draft, setDraft] = useState(prefs)
  const [showKey, setShowKey] = useState(false)
  const needsRestart = draft.playerName !== prefs.playerName
  const info = providerInfo(creds.provider)
  // Saved as you type: there is no Save button on this half of the dialog,
  // and a key you typed but never committed would look set and not work.
  const setCreds = (patch: Partial<CoachCreds>) => onCreds({ ...creds, ...patch })

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Your Profile</h2>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            value={draft.playerName}
            maxLength={18}
            onChange={(e) => set('playerName', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="coachprovider">Coach model service</label>
          <select
            id="coachprovider"
            value={creds.provider}
            onChange={(e) => setCreds({
              provider: e.target.value as CoachCreds['provider'],
              // All of it belongs to the service, the key most of all: carrying
              // a key across would send one vendor's credential to another.
              apiKey: '',
              model: '',
              baseUrl: '',
              auth: 'bearer',
            })}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <p className="sub" style={{ marginTop: 4 }}>{info.note}</p>
        </div>

        <div className="field">
          <label htmlFor="coachkey">API key</label>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
            <input
              id="coachkey"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={creds.provider === 'anthropic' ? 'sk-ant-…' : 'the service key'}
              value={creds.apiKey}
              onChange={(e) => setCreds({ apiKey: e.target.value.trim() })}
            />
            <button
              className="btn small ghost"
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? 'Hide the key' : 'Show the key'}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
            {creds.apiKey && (
              <button
                className="btn small danger"
                type="button"
                onClick={() => setCreds({ apiKey: '' })}
              >
                Clear
              </button>
            )}
          </div>
          <p className="sub" style={{ marginTop: 4 }}>
            Optional, and only for explanations. With a key set, the coach can put
            its reasoning into words, answer follow-ups, and review your history for
            patterns. Everything else — the equity, the outs, the pot odds, the
            rating — is computed on this device and needs nothing.
          </p>
        </div>

        <div className="field">
          <label htmlFor="coachmodel">Model</label>
          <input
            id="coachmodel"
            autoComplete="off"
            spellCheck={false}
            placeholder={info.modelHint}
            value={creds.model}
            onChange={(e) => setCreds({ model: e.target.value.trim() })}
          />
          <p className="sub" style={{ marginTop: 4 }}>
            {creds.provider === 'anthropic'
              ? 'Leave this empty for the default.'
              : 'Required. Model names change often, so check the service\u2019s current list.'}
          </p>
        </div>

        {creds.provider !== 'anthropic' && (
          <div className="field">
            <label htmlFor="coachbase">Service address</label>
            <input
              id="coachbase"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              value={creds.baseUrl}
              onChange={(e) => setCreds({ baseUrl: e.target.value.trim() })}
            />
            <label className="inline-check" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={creds.auth === 'api-key'}
                onChange={(e) => setCreds({ auth: e.target.checked ? 'api-key' : 'bearer' })}
              />
              <span>Send the key as an <code>api-key</code> header (Azure OpenAI)</span>
            </label>
            <p className="sub" style={{ marginTop: 4 }}>
              Leave the address empty for OpenAI itself. For Azure, paste the full
              deployment URL including its api-version. Anything else that speaks the
              OpenAI chat format — Groq, Together, OpenRouter, a server on your own
              machine — works here too.
            </p>
          </div>
        )}

        {creds.apiKey && !creds.model && creds.provider !== 'anthropic' && (
          <div className="warn">
            Explanations stay off until a model is named — this service has no
            default the app could pick for you.
          </div>
        )}
        {creds.apiKey && !draft.coachEndpoint.trim() && (
          <div className="warn">
            This key is stored in this browser and sent straight to the service from
            this device. That is fine for your own install; it is not something to
            put on a phone you hand round the table, because anything with access
            to the browser can read it. For shared use, run the proxy below instead
            and the key stays on the server.
          </div>
        )}
        {creds.apiKey && draft.coachEndpoint.trim() && (
          <div className="warn">
            An endpoint is set below, so that is being used and this key is
            ignored — the proxy keeps the key off this device.
          </div>
        )}

        <div className="warn" style={{ background: 'transparent' }}>
          AWS Bedrock and Google Vertex AI are not in this list on purpose: both
          authenticate with signed requests rather than a bearer key, which a
          browser cannot do safely. Put either behind the proxy instead.
        </div>

        <div className="field">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={draft.confirmBigActions}
              onChange={(e) => set('confirmBigActions', e.target.checked)}
            />
            <span>Ask twice before folding a big hand or going all in</span>
          </label>
          <p className="sub" style={{ marginTop: 4 }}>
            Only fires where a mistap is unrecoverable — folding when checking is
            free, folding a strong hand, or putting your whole stack in. The
            action bar also ignores the first moment after it appears, which is
            when most mis-taps land.
          </p>
        </div>

        <h2 style={{ marginTop: 18 }}>Table Settings</h2>
        <p className="sub">
          The house rules are fixed. These are just how the app deals them —
          who sits down is up to the Players tab.
        </p>

        <div className="field">
          <label htmlFor="speed">Pace</label>
          <select id="speed" value={draft.speed} onChange={(e) => set('speed', e.target.value as Speed)}>
            <option value="fast">Fast</option>
            <option value="normal">Normal</option>
            <option value="slow">Slow — time to read the table</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="bombtrigger">Scheduled bomb pots</label>
          <select
            id="bombtrigger"
            value={draft.bombPotTrigger}
            onChange={(e) => set('bombPotTrigger', e.target.value as BombPotTrigger)}
          >
            <option value="hands">Every N hands</option>
            <option value="time">Every N minutes (the house rule: 30)</option>
            <option value="off">Off — suited flops only</option>
          </select>
          <p className="sub" style={{ marginTop: 4 }}>
            The house rule is approximately every 30 minutes. App hands go much faster than
            live ones, so counting hands usually feels closer to the real thing.
          </p>
        </div>

        {draft.bombPotTrigger === 'hands' && (
          <div className="field">
            <label htmlFor="bombhands">Bomb pot every {draft.bombPotHands} hands</label>
            <input
              id="bombhands" type="range" min={4} max={40} value={draft.bombPotHands}
              onChange={(e) => set('bombPotHands', Number(e.target.value))}
            />
          </div>
        )}

        {draft.bombPotTrigger === 'time' && (
          <div className="field">
            <label htmlFor="bombmins">Bomb pot every {draft.bombPotMinutes} minutes</label>
            <input
              id="bombmins" type="range" min={5} max={60} step={5} value={draft.bombPotMinutes}
              onChange={(e) => set('bombPotMinutes', Number(e.target.value))}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="bombgame">Bomb pot game</label>
          <select
            id="bombgame"
            value={draft.bombPotGameChoice}
            onChange={(e) => set('bombPotGameChoice', e.target.value as Preferences['bombPotGameChoice'])}
          >
            <option value="dealer">Dealer's choice</option>
            <option value="pineapple">Always Pineapple</option>
            <option value="crazyPineapple">Always Crazy Pineapple</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="straddle">
            Straddle appetite — {Math.round(draft.straddleMultiplier * 100)}% of normal
          </label>
          <input
            id="straddle" type="range" min={0} max={200} step={10}
            value={Math.round(draft.straddleMultiplier * 100)}
            onChange={(e) => set('straddleMultiplier', Number(e.target.value) / 100)}
          />
          <p className="sub" style={{ marginTop: 4 }}>
            Scales every player's own straddle tendency. Set it to zero to turn straddles off.
          </p>
        </div>

        <div className="field">
          <label htmlFor="coachendpoint">Coach narrator endpoint</label>
          <input
            id="coachendpoint"
            value={draft.coachEndpoint}
            placeholder="https://… (leave empty to turn explanations off)"
            onChange={(e) => set('coachEndpoint', e.target.value)}
          />
          <p className="sub" style={{ marginTop: 4 }}>
            The safer alternative to a key. Run <code>npm run coach</code> with the key
            on the server and point this at it; nothing secret then lives in the browser.
            Takes precedence over the key above when both are set.
          </p>
        </div>

        {needsRestart && (
          <div className="warn">Changing your name starts a fresh session.</div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => onApply(draft, needsRestart)}>
            {needsRestart ? 'Apply & restart session' : 'Apply'}
          </button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="btn small danger" onClick={() => onApply(draft, true)}>
            New session
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function CashOutDialog({
  game, onClose, onSave,
}: {
  game: ReturnType<typeof useGame>
  onClose: () => void
  onSave: () => void
}) {
  const { table } = game
  const rows = useMemo(
    () => table.seats.map((seat) => {
      const chipsIn = seat.buyIns * BUY_IN_CHIPS
      const net = seat.stack - chipsIn
      return {
        seat,
        chipsIn,
        cashIn: seat.buyIns * BUY_IN_CASH,
        net,
        fee: owesHighRollerFee(net) ? HIGH_ROLLER_FEE : 0,
      }
    }).sort((a, b) => b.net - a.net),
    [table.seats],
  )

  const you = rows.find((r) => r.seat.isHuman)!
  const winner = rows[0]

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Cash Out</h2>
        <p className="sub">
          {table.handsPlayed} hand{table.handsPlayed === 1 ? '' : 's'} ·{' '}
          {table.dexterCount} Dexter{table.dexterCount === 1 ? '' : 's'} ·{' '}
          Dexter ladder finished at ${table.dexterCount}
        </p>

        <div className="tablewrap">
          <table className="grid" style={{ minWidth: 420 }}>
            <thead>
              <tr><th>Player</th><th>Buy-ins</th><th>Cash in</th><th>Cash out</th><th>Net</th><th>HR fee</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seat.id} className={r === winner && r.net > 0 ? 'winner' : ''}>
                  <td>{r.seat.name}{r.seat.isHuman ? ' (you)' : ''}</td>
                  <td>{r.seat.buyIns}</td>
                  <td>{money(r.cashIn)}</td>
                  <td>{money(r.seat.stack)}</td>
                  <td className={r.net >= 0 ? 'pos' : 'neg'}><b>{signedMoney(r.net)}</b></td>
                  <td>{r.fee ? <span className="tag gold">-$5</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {you.fee > 0 && (
          <div className="warn">
            You finished {signedMoney(you.net)} — over $100 in net profit. You are officially a
            BNOTW High Roller, and you owe the house $5.
          </div>
        )}

        {winner.net > 0 && (
          <div className="warn">
            Biggest winner: <b>{winner.seat.name}</b> at {signedMoney(winner.net)}.
            {winner.seat.isHuman
              ? ' That means the recap is your homework.'
              : ' Lucky you — somebody else writes the recap.'}
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={onSave}>Save to Record Book</button>
          <button className="btn ghost" onClick={onClose}>Keep playing</button>
        </div>
      </div>
    </div>
  )
}
