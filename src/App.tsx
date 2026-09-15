import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BUY_IN_CASH, BUY_IN_CHIPS, HIGH_ROLLER_FEE, money, owesHighRollerFee, signedMoney,
} from './engine/bnotw'
import type { Persona } from './engine/persona'
import type { PlayerTotals } from './engine/playerStats'
import { PROVIDERS, providerInfo } from './engine/providers'
import { VOICES, voice, voiceName } from './engine/voices'
import {
  LAYERS, STARTING_LAYERS, allLayers, layerProgress, suggestLayer, type LayerId,
} from './engine/layers'
import type { BombPotTrigger, TableSettings } from './engine/table'
import { blankNight, makeId, type GameNight, type NightPlayer } from './state/records'
import {
  loadBook, loadCoachCreds, loadHandNames, loadLayers, loadRoster, loadSettings, loadVoices,
  saveBook, saveCoachCreds, saveHandNames, saveLayers, saveVoices,
  saveRoster, saveSettings, saveTableSnapshot,
  type CoachCreds, type RecordBook, type RosterState, type VoiceSettings,
} from './state/storage'
import { backupIsOverdue, requestPersistentStorage, shareBackup } from './state/backup'
import { applyReset, type ResetAreaId } from './state/factory'
import {
  DEFAULT_PROFILE_ID, displayName, experienceMeta, guestProfile, hasLegacyHistory,
  forgetProfile, initialsFor, isGuest, loadActiveProfile, loadProfiles, makeProfile,
  saveActiveProfile, saveProfiles, type LocalProfile,
} from './state/profiles'
import { CoachScorecard } from './ui/CoachPanel'
import { DrillView } from './ui/DrillView'
import { PlayersView } from './ui/Players'
import { PlayerForm, PlayerPicker } from './ui/PlayerPicker'
import { RecordBookView } from './ui/RecordBook'
import { ResetDialog } from './ui/ResetDialog'
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
  /**
   * Who is playing, and every record that follows from it.
   *
   * `null` means nobody has been chosen yet, which puts the picker up before
   * anything else. A guest is a profile that is never stored: everything they
   * play stays in memory and leaves nothing behind, which is what makes
   * handing the iPad over cost nobody their record.
   */
  const [profiles, setProfilesState] = useState<LocalProfile[]>(() => {
    const stored = loadProfiles()
    if (stored.length > 0) return stored
    // Somebody has been playing since before profiles existed. Their history
    // lives under the unscoped keys, so the default profile is theirs — seeded
    // rather than left for them to find as a stranger's empty record.
    if (hasLegacyHistory()) {
      const name = loadSettings(DEFAULT_PREFS).playerName || 'Me'
      return [makeProfile({ id: DEFAULT_PROFILE_ID, name })]
    }
    return []
  })
  const [player, setPlayer] = useState<LocalProfile | null>(() => {
    const stored = loadProfiles()
    const id = loadActiveProfile()
    if (id) {
      const found = stored.find((p) => p.id === id)
      if (found) return found
    }
    // One profile and nobody else to confuse it with: no need to ask.
    if (stored.length === 0 && hasLegacyHistory()) {
      const name = loadSettings(DEFAULT_PREFS).playerName || 'Me'
      return makeProfile({ id: DEFAULT_PROFILE_ID, name })
    }
    return null
  })
  const [switching, setSwitching] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<LocalProfile | null>(null)
  const profileId = player?.id ?? DEFAULT_PROFILE_ID
  const guest = isGuest(player)

  const setProfiles = useCallback((next: LocalProfile[]) => {
    setProfilesState(next)
    saveProfiles(next)
  }, [])

  const [tab, setTab] = useState<Tab>('table')
  const [prefs, setPrefs] = useState<Preferences>(() => loadSettings(DEFAULT_PREFS))
  const [book, setBookState] = useState<RecordBook>(() => loadBook())
  const [roster, setRosterState] = useState<RosterState>(() => loadRoster())
  const [openNightId, setOpenNightId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showCashOut, setShowCashOut] = useState(false)
  const [showCoachStats, setShowCoachStats] = useState(false)
  const [showReset, setShowReset] = useState(false)
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
  const game = useGame(tableSettings, tab === 'table', 'table', profileId)
  const coachGame = useGame(tableSettings, tab === 'coach', 'coach', profileId)
  const coach = useCoach(profileId)
  const tracker = useTracker(profileId)
  const update = useAppUpdate()
  // Offered after a night is recorded, which is the one moment there is
  // something new worth keeping and nobody is mid-hand.
  const [offerBackup, setOfferBackup] = useState(false)
  const [voices, setVoicesState] = useState(() => loadVoices())
  const setVoices = useCallback((next: VoiceSettings) => {
    setVoicesState(next)
    saveVoices(next)
  }, [])
  /**
   * Which coaching layers are on. Null until it has been decided.
   *
   * Never guessed at on the first render: a player who had the whole panel
   * before layers existed must not open the app to find most of it gone, and
   * telling them apart from a genuinely new player needs the history read back
   * first. Until then everything shows, which is the safe way to be wrong.
   */
  const [layers, setLayersState] = useState<LayerId[] | null>(() => loadLayers(profileId))
  const setLayers = useCallback((next: LayerId[]) => {
    setLayersState(next)
    saveLayers(next, profileId)
  }, [profileId])
  // Switching player swaps their layers too; theirs are not yours.
  useEffect(() => { setLayersState(loadLayers(profileId)) }, [profileId])
  const [handNames, setHandNamesState] = useState(() => loadHandNames())
  const setHandNames = useCallback((next: Record<string, string>) => {
    setHandNamesState(next)
    saveHandNames(next)
  }, [])

  /**
   * Ask the browser not to evict this origin under storage pressure.
   *
   * Best-effort: support varies and the answer can be no. Asked for once on
   * load, and never reported as safety — Backup JSON is the safeguard.
   */
  useEffect(() => { void requestPersistentStorage() }, [])
  // Seeded from your real record, so the weakest street comes up most.
  const drill = useDrill(opponents, tracker.totals, prefs.playerName, tab === 'drill', profileId)
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

  /**
   * Settle the layers once, the first time the history is readable.
   *
   * Anyone with decisions already on the record gets everything, because that
   * is what they had. Anyone starting fresh gets one question.
   */
  useEffect(() => {
    if (layers !== null || !tracker.hydrated) return
    // Somebody with decisions already on the record gets everything, because
    // that is what they had. Otherwise it follows from what they told the
    // picker about how much poker they have played.
    if (tracker.totals.decisions > 0) setLayers(allLayers())
    else setLayers([...experienceMeta(player?.experience ?? 'casual').layers])
  }, [layers, setLayers, tracker.hydrated, tracker.totals.decisions, player?.experience])

  const activeLayers = layers ?? allLayers()

  /**
   * The next layer worth offering, once dismissed for the session.
   *
   * Session-scoped rather than stored: a suggestion declined in March is not a
   * suggestion declined forever, and nagging is what makes a prompt something
   * people learn to tap past without reading.
   */
  const [waved, setWaved] = useState<LayerId[]>([])
  const nextLayer = useMemo(() => {
    const suggestion = suggestLayer(tracker.totals, activeLayers)
    return suggestion && !waved.includes(suggestion.layer.id) ? suggestion : null
  }, [tracker.totals, activeLayers, waved])

  useEffect(() => { saveSettings(prefs) }, [prefs])
  useEffect(() => {
    game.setSpeed(prefs.speed)
    coachGame.setSpeed(prefs.speed)
  }, [prefs.speed, game, coachGame])

  /** Sit somebody down. Remembered, unless it is the guest. */
  const choosePlayer = useCallback((next: LocalProfile) => {
    setPlayer(next)
    saveActiveProfile(next.id)
    setSwitching(false)
    if (!isGuest(next)) {
      setProfilesState((prev) => {
        const seen = prev.some((p) => p.id === next.id)
        const merged = seen
          ? prev.map((p) => (p.id === next.id ? { ...next, lastPlayedAt: Date.now() } : p))
          : [...prev, { ...next, lastPlayedAt: Date.now() }]
        saveProfiles(merged)
        return merged
      })
    }
  }, [])

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

  /**
   * Carry out a Start Fresh.
   *
   * Every area is reset in the live state as well as on disk. Clearing the
   * stored key alone would leave the old roster on screen until a reload,
   * which is indistinguishable from a reset that silently failed.
   */
  const resetAreas = useCallback((ids: ResetAreaId[]) => {
    applyReset(ids, {
      hands: tracker.reset,
      drill: drill.reset,
      coachScore: coach.reset,
      roster: (next) => {
        setRoster(next)
        // The old line-up's stacks mean nothing once the seats change.
        game.restart({ ...prefs, opponents: seatedPersonas(next) })
        coachGame.restart({ ...prefs, opponents: seatedPersonas(next) })
      },
      voices: setVoices,
      handNames: setHandNames,
      tables: () => {
        saveTableSnapshot('table', null, profileId)
        saveTableSnapshot('coach', null, profileId)
        game.restart({ ...prefs, opponents })
        coachGame.restart({ ...prefs, opponents })
      },
      book: () => setBook({ version: 1, nights: [] }),
    })
  }, [
    tracker.reset, drill.reset, coach.reset, setRoster, setVoices, setHandNames,
    setBook, game, coachGame, prefs, opponents, profileId,
  ])

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

    const nights = [night, ...book.nights]
    setBook({ version: 1, nights })
    setOpenNightId(night.id)
    setShowCashOut(false)
    setTab('book')
    // Only when a copy is actually owed. Offering after every night is how a
    // prompt becomes something you dismiss without reading.
    if (backupIsOverdue(nights)) setOfferBackup(true)
    // The night is settled and in the book, so the session is over. Dealing on
    // from the same stacks would let a second cash-out record it all again.
    game.restart({ ...prefs, opponents })
  }, [game, book.nights, setBook, prefs, opponents])

  const takeBackup = useCallback(async () => {
    const result = await shareBackup(
      'bnotw-record-book.json',
      JSON.stringify(book, null, 2),
    )
    if (result !== 'cancelled') setOfferBackup(false)
  }, [book])

  // Nothing renders until somebody has been chosen. A history has to belong to
  // a person from its first hand; a "we will sort it out later" mode would
  // just be the record-contamination problem with extra steps.
  if (!player) {
    return (
      <PlayerPicker
        profiles={profiles}
        onPick={choosePlayer}
        onGuest={() => choosePlayer(guestProfile())}
        onCreate={choosePlayer}
      />
    )
  }

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
        <button
          className={`btn small ghost whoami ${guest ? 'guest' : ''}`}
          onClick={() => setSwitching(true)}
          aria-label="Change player"
        >
          <span
            className="playerchip-face tiny"
            style={{ borderColor: player.colour, color: player.colour }}
          >
            {initialsFor(player)}
          </span>
          <span className="whoami-name">{displayName(player)}</span>
        </button>
        <button className="btn small ghost" onClick={() => setShowSettings(true)} aria-label="Settings">
          ⚙
        </button>
      </header>

      {guest && (
        <div className="guestbar">
          <b>Guest</b>
          <span>
            Nothing played now is recorded anywhere — not to you and not to
            anyone else on this device.
          </span>
          <span className="spacer" />
          <button className="btn small ghost" onClick={() => setSwitching(true)}>
            Switch player
          </button>
        </div>
      )}

      <main className="screen">
        {tab === 'table' && (
          <TableView
            game={game}
            onCashOut={() => setShowCashOut(true)}
            tracker={tracker}
            mode="table"
            guardOptions={guardOptions}
            handNames={handNames}
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
              <LayerPicker
                layers={activeLayers}
                onChange={setLayers}
                totals={tracker.totals}
              />
              <VoicePicker voices={voices} onChange={setVoices} />
              <button className="btn small ghost" onClick={() => setShowCoachStats(true)}>
                Your stats
              </button>
            </div>
            {nextLayer && (
              <div className="layer-offer">
                <b>Ready for more?</b>
                <span>{nextLayer.because}</span>
                <span className="spacer" />
                <button
                  className="btn small"
                  onClick={() => setLayers([...activeLayers, nextLayer.layer.id])}
                >
                  Turn on {nextLayer.layer.name}
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => setWaved((prev) => [...prev, nextLayer.layer.id])}
                >
                  Not yet
                </button>
              </div>
            )}
            <TableView
              game={coachGame}
              onCashOut={() => {}}
              coach={coach}
              layers={activeLayers}
              tracker={tracker}
              mode="coach"
              narrator={tableNarrator}
              guardOptions={guardOptions}
              handNames={handNames}
              voices={voices}
            />
          </>
        )}
        {tab === 'drill' && <DrillView drill={drill} />}
        {tab === 'stats' && (
          <StatsView
            tracker={tracker}
            narrator={reviewNarrator}
            onStartFresh={() => setShowReset(true)}
            tableSeats={game.table.seats}
          />
        )}
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
        {tab === 'rules' && <RulesView handNames={handNames} onHandNames={setHandNames} />}
      </main>

      {offerBackup && (
        <div className="overlay" onClick={() => setOfferBackup(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Keep a copy?</h2>
            <p className="sub">
              Your Record Book lives in this browser. It goes if you clear site
              data, change browser, or lose the device — and a few nights have
              gone in since the last copy.
            </p>
            <p className="sub">
              This hands the file straight to Files, iCloud Drive, Mail or
              wherever you keep things. On a computer it downloads instead.
            </p>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn primary" onClick={() => void takeBackup()}>
                Save a copy
              </button>
              <button className="btn ghost" onClick={() => setOfferBackup(false)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

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

      {switching && (
        <PlayerPicker
          title="Who's playing now?"
          profiles={profiles}
          onPick={choosePlayer}
          onGuest={() => choosePlayer(guestProfile())}
          onCreate={choosePlayer}
          onEdit={(profile) => { setSwitching(false); setEditingPlayer(profile) }}
          onClose={() => setSwitching(false)}
        />
      )}

      {editingPlayer && (
        <PlayerForm
          editing={editingPlayer}
          onSave={(next) => {
            setProfiles(profiles.map((p) => (p.id === next.id ? next : p)))
            if (player.id === next.id) setPlayer(next)
            setEditingPlayer(null)
          }}
          onCancel={() => setEditingPlayer(null)}
          onDelete={profiles.length > 1 ? () => {
            const left = profiles.filter((p) => p.id !== editingPlayer.id)
            setProfiles(left)
            // Their stored hands go with them. Leaving the records behind
            // would mean a name reused later inherited a stranger's history.
            void forgetProfile(editingPlayer.id)
            setEditingPlayer(null)
            if (player.id === editingPlayer.id) {
              setPlayer(null)
              saveActiveProfile(null)
            }
          } : undefined}
        />
      )}

      {showReset && (
        <ResetDialog onApply={resetAreas} onClose={() => setShowReset(false)} />
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

/**
 * Which questions the coach is answering.
 *
 * Presented as layers to turn on rather than levels to beat, which is what
 * stops it being a progress bar you feel behind on. Order is a suggestion, not
 * a lock: anyone can turn on all four on their first hand, and the reason to
 * start narrow is written where the choice is made rather than assumed.
 *
 * Each row shows how the record looks for that layer, so the state of the
 * thing is visible whether or not the app happens to be suggesting it.
 */
function LayerPicker({
  layers, onChange, totals,
}: {
  layers: readonly LayerId[]
  onChange: (layers: LayerId[]) => void
  totals: PlayerTotals
}) {
  const [open, setOpen] = useState(false)
  const on = (id: LayerId) => layers.includes(id)

  const toggle = (id: LayerId) => {
    onChange(on(id) ? layers.filter((l) => l !== id) : [...layers, id])
  }

  return (
    <>
      <button className="btn small ghost" onClick={() => setOpen(true)}>
        {layers.length === LAYERS.length
          ? 'All layers'
          : `${layers.length} of ${LAYERS.length} layers`}
      </button>

      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
            <h2>What the coach shows</h2>
            <p className="sub">
              Everything at once is a dashboard, not a lesson. Turn on one
              question at a time and the answer to it is the only thing on
              screen — or turn them all on, if what you want is the dashboard.
            </p>

            <div className="resetlist">
              {LAYERS.map((l) => {
                const progress = layerProgress(totals, l.id)
                return (
                  <label key={l.id} className={`resetrow ${on(l.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={on(l.id)} onChange={() => toggle(l.id)} />
                    <div>
                      <div className="resetlabel">
                        {l.name}
                        {progress.settled && <span className="tag gold">Settled</span>}
                      </div>
                      <div className="sub"><i>{l.question}</i> {l.shows}</div>
                      <div className="sub faint" style={{ marginTop: 3 }}>
                        {!progress.measurable
                          ? 'Nothing in your record can tell you when you have got the hang of this one.'
                          : progress.rate === null
                            ? `${progress.decisions} decisions so far — not enough to say yet.`
                            : `${progress.slips} slip${progress.slips === 1 ? '' : 's'} `
                              + `in ${progress.decisions} decisions.`}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn primary" onClick={() => setOpen(false)}>Done</button>
              <button
                className="btn small ghost"
                onClick={() => onChange(allLayers())}
                disabled={layers.length === LAYERS.length}
              >
                Show everything
              </button>
              <button
                className="btn small ghost"
                onClick={() => onChange([...STARTING_LAYERS])}
                disabled={layers.length === STARTING_LAYERS.length && on('price')}
              >
                Back to the price
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

/**
 * Who is coaching, and whether anyone is arguing with them.
 *
 * Names are editable because these are this table's characters, not fixed
 * personalities — the same reasoning as the hand names.
 */
function VoicePicker({
  voices, onChange,
}: {
  voices: VoiceSettings
  onChange: (voices: VoiceSettings) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button className="btn small ghost" onClick={() => setOpen(true)}>
        {voiceName(voice(voices.primary), voices.names)}
        {voices.second && ` + ${voiceName(voice(voices.second), voices.names)}`}
      </button>

      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Who is coaching?</h2>
            <p className="sub">
              Invented characters with real playing styles. A style is just a
              description of poker and belongs to nobody; the people are made up.
              Rename them to whatever your table calls them.
            </p>

            {VOICES.map((v) => (
              <div className="field" key={v.id}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input
                    style={{ flex: '1 1 140px' }}
                    value={voices.names[v.id] ?? v.name}
                    maxLength={30}
                    onChange={(e) => onChange({
                      ...voices,
                      names: { ...voices.names, [v.id]: e.target.value },
                    })}
                  />
                  <button
                    className={`btn small ${voices.primary === v.id ? '' : 'ghost'}`}
                    onClick={() => onChange({
                      ...voices,
                      primary: v.id,
                      // Nobody argues with themselves.
                      second: voices.second === v.id ? null : voices.second,
                    })}
                  >
                    Coach
                  </button>
                  <button
                    className={`btn small ${voices.second === v.id ? '' : 'ghost'}`}
                    disabled={voices.primary === v.id}
                    onClick={() => onChange({
                      ...voices,
                      second: voices.second === v.id ? null : v.id,
                    })}
                  >
                    2nd
                  </button>
                </div>
                <p className="sub" style={{ marginTop: 4 }}>{v.blurb}</p>
              </div>
            ))}

            <p className="sub">
              A second opinion shows beside the first. They agree most of the
              time; the spots where they do not are the ones worth thinking about.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => setOpen(false)}>Done</button>
              {/*
                Right here rather than only in Start Fresh: a rename is undone
                from where it was made, and knowing that is what makes trying
                one feel free.
              */}
              <button
                className="btn small ghost"
                disabled={Object.keys(voices.names).length === 0}
                onClick={() => onChange({ ...voices, names: {} })}
              >
                Original names
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
