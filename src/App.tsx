import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BUY_IN_CASH, BUY_IN_CHIPS, HIGH_ROLLER_FEE, money, owesHighRollerFee, signedMoney,
} from './engine/bnotw'
import type { BombPotTrigger, TableSettings } from './engine/table'
import { blankNight, makeId, type GameNight, type NightPlayer } from './state/records'
import { loadBook, loadSettings, saveBook, saveSettings, type RecordBook } from './state/storage'
import { RecordBookView } from './ui/RecordBook'
import { RulesView } from './ui/RulesView'
import { TableView } from './ui/TableView'
import { useGame, type Speed } from './ui/useGame'

type Tab = 'table' | 'book' | 'rules'

interface Preferences {
  playerName: string
  botCount: number
  bombPotTrigger: BombPotTrigger
  bombPotHands: number
  bombPotMinutes: number
  bombPotGameChoice: TableSettings['bombPotGameChoice']
  botStraddleChance: number
  speed: Speed
}

const DEFAULT_PREFS: Preferences = {
  playerName: 'You',
  botCount: 5,
  bombPotTrigger: 'hands',
  bombPotHands: 12,
  bombPotMinutes: 30,
  bombPotGameChoice: 'dealer',
  botStraddleChance: 0.12,
  speed: 'normal',
}

export default function App() {
  const [tab, setTab] = useState<Tab>('table')
  const [prefs, setPrefs] = useState<Preferences>(() => loadSettings(DEFAULT_PREFS))
  const [book, setBookState] = useState<RecordBook>(() => loadBook())
  const [openNightId, setOpenNightId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showCashOut, setShowCashOut] = useState(false)

  const game = useGame(prefs)

  useEffect(() => { saveSettings(prefs) }, [prefs])
  useEffect(() => { game.setSpeed(prefs.speed) }, [prefs.speed, game])

  const setBook = useCallback((next: RecordBook) => {
    setBookState(next)
    saveBook(next)
  }, [])

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
  }, [game, book.nights, setBook])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>BNOTW</b>
          <span>Best Night Of The Week</span>
        </div>
        <div className="tabs" role="tablist">
          {([['table', 'Table'], ['book', 'Record Book'], ['rules', 'Rules']] as const).map(
            ([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ),
          )}
        </div>
        <button className="btn small ghost" onClick={() => setShowSettings(true)} aria-label="Settings">
          ⚙
        </button>
      </header>

      <main className="screen">
        {tab === 'table' && <TableView game={game} onCashOut={() => setShowCashOut(true)} />}
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
          onClose={() => setShowSettings(false)}
          onApply={(next, restart) => {
            setPrefs(next)
            setShowSettings(false)
            if (restart) game.restart(next)
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
    </div>
  )
}

// ---------------------------------------------------------------------------

function SettingsDialog({
  prefs, onClose, onApply,
}: {
  prefs: Preferences
  onClose: () => void
  onApply: (prefs: Preferences, restart: boolean) => void
}) {
  const [draft, setDraft] = useState(prefs)
  const needsRestart =
    draft.botCount !== prefs.botCount || draft.playerName !== prefs.playerName

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Table Settings</h2>
        <p className="sub">The house rules are fixed. These are just how the app deals them.</p>

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
          <label htmlFor="bots">Opponents — {draft.botCount}</label>
          <input
            id="bots"
            type="range"
            min={1}
            max={8}
            value={draft.botCount}
            onChange={(e) => set('botCount', Number(e.target.value))}
          />
        </div>

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
              id="bombhands"
              type="range"
              min={4}
              max={40}
              value={draft.bombPotHands}
              onChange={(e) => set('bombPotHands', Number(e.target.value))}
            />
          </div>
        )}

        {draft.bombPotTrigger === 'time' && (
          <div className="field">
            <label htmlFor="bombmins">Bomb pot every {draft.bombPotMinutes} minutes</label>
            <input
              id="bombmins"
              type="range"
              min={5}
              max={60}
              step={5}
              value={draft.bombPotMinutes}
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
            How often opponents straddle — {Math.round(draft.botStraddleChance * 100)}%
          </label>
          <input
            id="straddle"
            type="range"
            min={0}
            max={60}
            value={Math.round(draft.botStraddleChance * 100)}
            onChange={(e) => set('botStraddleChance', Number(e.target.value) / 100)}
          />
        </div>

        {needsRestart && (
          <div className="warn">Changing your name or the table size starts a fresh session.</div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => onApply(draft, needsRestart)}>
            {needsRestart ? 'Apply & restart session' : 'Apply'}
          </button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button
            className="btn small danger"
            onClick={() => onApply(draft, true)}
          >
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
