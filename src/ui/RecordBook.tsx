import { useMemo, useRef, useState } from 'react'
import { YourData } from './YourData'
import { money, signedMoney } from '../engine/bnotw'
import {
  blankNight, blankPlayer, careerStandings, settleNight, sortNights,
  type GameNight, type NightPlayer,
} from '../state/records'
import { careerCsv, downloadText, formatDate, mailtoLink, recapEmail, recordBookCsv } from '../state/export'
import { mergeNights, parseImport, type RecordBook as Book } from '../state/storage'
import { MoneyInput } from './MoneyInput'

export function RecordBookView({
  book, setBook, openNightId, onOpenNight,
}: {
  book: Book
  setBook: (book: Book) => void
  openNightId: string | null
  onOpenNight: (id: string | null) => void
}) {
  const nights = useMemo(() => sortNights(book.nights), [book.nights])
  const career = useMemo(() => careerStandings(book.nights), [book.nights])
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const updateNight = (night: GameNight) => {
    setBook({
      version: 1,
      nights: book.nights.map((n) =>
        n.id === night.id ? { ...night, updatedAt: new Date().toISOString() } : n),
    })
  }

  const addNight = () => {
    const night = blankNight()
    night.players = [blankPlayer('')]
    setBook({ version: 1, nights: [night, ...book.nights] })
    onOpenNight(night.id)
  }

  const deleteNight = (id: string) => {
    setBook({ version: 1, nights: book.nights.filter((n) => n.id !== id) })
  }

  const importFile = async (file: File) => {
    try {
      setError(null)
      setBook(mergeNights(book, parseImport(await file.text())))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.')
    }
  }

  const houseTotal = useMemo(
    () => book.nights.reduce((sum, n) => sum + settleNight(n).houseTotal, 0),
    [book.nights],
  )
  const dexterTotal = useMemo(
    () => book.nights.reduce((sum, n) => sum + settleNight(n).totalDexters, 0),
    [book.nights],
  )

  return (
    <div className="scroll">
      <div className="panel">
        <h2>The Record Book</h2>
        <p className="sub">
          The record continues from game to game rather than resetting each night.
          Everything is stored on this device — export a copy to keep it safe or move it.
        </p>
        <div className="summary-grid">
          <div className="summary-cell"><b>{book.nights.length}</b><span>Nights</span></div>
          <div className="summary-cell"><b>{career.length}</b><span>Players</span></div>
          <div className="summary-cell"><b>{dexterTotal}</b><span>Dexters</span></div>
          <div className="summary-cell"><b className="num">{money(houseTotal)}</b><span>House take</span></div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={addNight}>+ New game night</button>
          <button
            className="btn small"
            disabled={!book.nights.length}
            onClick={() => downloadText('bnotw-record-book.csv', recordBookCsv(book.nights), 'text/csv')}
          >
            Export record CSV
          </button>
          <button
            className="btn small"
            disabled={!book.nights.length}
            onClick={() => downloadText('bnotw-standings.csv', careerCsv(book.nights), 'text/csv')}
          >
            Export standings CSV
          </button>
          <button
            className="btn small"
            disabled={!book.nights.length}
            onClick={() => downloadText('bnotw-record-book.json', JSON.stringify(book, null, 2), 'application/json')}
          >
            Backup JSON
          </button>
          <button className="btn small ghost" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importFile(file)
              e.target.value = ''
            }}
          />
        </div>
        {error && <div className="warn bad">{error}</div>}

        <details className="yourdata-toggle">
          <summary>Where does my history live? (worth reading once)</summary>
          <YourData />
        </details>
      </div>

      {career.length > 0 && (
        <div className="panel">
          <h2>All-Time Standings</h2>
          <p className="sub">Long-term bragging rights, carried forward from every night on record.</p>
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Nights</th>
                  <th>Won</th>
                  <th>Buy-ins</th>
                  <th>Rebuys</th>
                  <th>Cash in</th>
                  <th>Cash out</th>
                  <th>Lifetime net</th>
                  <th>Best</th>
                  <th>Worst</th>
                  <th>Dexters</th>
                  <th>HR fees</th>
                </tr>
              </thead>
              <tbody>
                {career.map((row) => (
                  <tr key={row.name}>
                    <td>
                      {row.name}
                      {row.recapsOwed > 0 && (
                        <span className="tag gold" style={{ marginLeft: 6 }}>
                          {row.recapsOwed} recap{row.recapsOwed > 1 ? 's' : ''} owed
                        </span>
                      )}
                    </td>
                    <td>{row.nights}</td>
                    <td>{row.nightsWon}</td>
                    <td>{row.totalBuyIns}</td>
                    <td>{row.rebuys}</td>
                    <td>{money(row.totalBuyInCash)}</td>
                    <td>{money(row.totalCashOut)}</td>
                    <td className={row.lifetimeNet >= 0 ? 'pos' : 'neg'}>
                      <b>{signedMoney(row.lifetimeNet)}</b>
                    </td>
                    <td className="pos">{signedMoney(row.bestNight)}</td>
                    <td className="neg">{signedMoney(row.worstNight)}</td>
                    <td>{row.dexterWins}</td>
                    <td>{money(row.highRollerFees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Game Nights</h2>
        {nights.length === 0 ? (
          <div className="empty">
            No nights on the books yet.<br />
            Start one here, or cash out of a session at the table and save it.
          </div>
        ) : (
          nights.map((night) => (
            <NightCard
              key={night.id}
              night={night}
              open={openNightId === night.id}
              onToggle={() => onOpenNight(openNightId === night.id ? null : night.id)}
              onChange={updateNight}
              onDelete={() => deleteNight(night.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function NightCard({
  night, open, onToggle, onChange, onDelete,
}: {
  night: GameNight
  open: boolean
  onToggle: () => void
  onChange: (night: GameNight) => void
  onDelete: () => void
}) {
  const settlement = useMemo(() => settleNight(night), [night])
  const [copied, setCopied] = useState(false)

  const setPlayer = (id: string, patch: Partial<NightPlayer>) => {
    onChange({
      ...night,
      players: night.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })
  }

  const winnerNames = settlement.biggestWinners.map((w) => w.name || '—').join(' & ')

  const copyRecap = async () => {
    const { body } = recapEmail(night)
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="night-card">
      <button className="night-head" onClick={onToggle} aria-expanded={open}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div className="when">{formatDate(night.date)}</div>
          <div className="who">
            {night.players.length} player{night.players.length === 1 ? '' : 's'}
            {settlement.biggestWinners.length > 0 && night.players.length > 0 &&
              ` · winner ${winnerNames} ${signedMoney(settlement.biggestWinners[0].netProfit)}`}
            {settlement.totalDexters > 0 && ` · ${settlement.totalDexters} Dexter${settlement.totalDexters > 1 ? 's' : ''}`}
          </div>
        </div>
        {!night.recap.trim() && night.players.length > 0 && (
          <span className="tag gold">Recap owed</span>
        )}
        <span className="faint">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="night-body">
          <div className="row" style={{ margin: '12px 0' }}>
            <div className="field" style={{ margin: 0, flex: '0 0 auto' }}>
              <label htmlFor={`date-${night.id}`}>Date</label>
              <input
                id={`date-${night.id}`}
                type="date"
                value={night.date}
                onChange={(e) => onChange({ ...night, date: e.target.value })}
              />
            </div>
            <div className="field" style={{ margin: 0, flex: '0 0 auto', width: 150 }}>
              <label htmlFor={`dex-${night.id}`}>Final Dexter level ($)</label>
              <input
                id={`dex-${night.id}`}
                type="number"
                min={0}
                value={night.finalDexterLevel}
                onChange={(e) => onChange({ ...night, finalDexterLevel: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <span className="spacer" />
            <button className="btn small danger" onClick={onDelete}>Delete night</button>
          </div>

          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Buy-ins</th>
                  <th>Rebuys</th>
                  <th>Cash in</th>
                  <th>Chips in</th>
                  <th>Cash out</th>
                  <th>Net</th>
                  <th>HR fee</th>
                  <th>Dexters</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settlement.players.map((p) => (
                  <tr key={p.id} className={p.isBiggestWinner && p.netProfit > 0 ? 'winner' : ''}>
                    <td>
                      <input
                        className="cell-input name"
                        value={p.name}
                        placeholder="Name"
                        aria-label="Player name"
                        onChange={(e) => setPlayer(p.id, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input tiny"
                        type="number"
                        min={1}
                        value={p.buyIns}
                        aria-label="Buy-ins"
                        onChange={(e) => setPlayer(p.id, { buyIns: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </td>
                    <td className="faint">{p.rebuys}</td>
                    <td className="faint">{money(p.totalBuyInCash)}</td>
                    <td className="faint">{money(p.chipsIn)}</td>
                    <td>
                      <MoneyInput
                        value={p.cashOut}
                        ariaLabel="Cash out"
                        onChange={(cents) => setPlayer(p.id, { cashOut: cents })}
                      />
                    </td>
                    <td className={p.netProfit >= 0 ? 'pos' : 'neg'}><b>{signedMoney(p.netProfit)}</b></td>
                    <td>{p.highRollerFee ? <span className="tag gold">-$5</span> : '—'}</td>
                    <td>
                      <input
                        className="cell-input tiny"
                        type="number"
                        min={0}
                        value={p.dexterWins}
                        aria-label="Dexter wins"
                        onChange={(e) => setPlayer(p.id, { dexterWins: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td>
                      <button
                        className="btn small ghost"
                        aria-label={`Remove ${p.name || 'player'}`}
                        onClick={() => onChange({
                          ...night,
                          players: night.players.filter((x) => x.id !== p.id),
                        })}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button
              className="btn small"
              onClick={() => onChange({ ...night, players: [...night.players, blankPlayer('')] })}
            >
              + Add player
            </button>
          </div>

          <div className="summary-grid">
            <div className="summary-cell">
              <b className="num">{money(settlement.totalChipsIssued)}</b><span>Chips issued</span>
            </div>
            <div className="summary-cell">
              <b className="num">{money(settlement.totalCashedOut)}</b><span>Chips counted</span>
            </div>
            <div className="summary-cell">
              <b className="num">{money(settlement.houseCut)}</b><span>House from buy-ins</span>
            </div>
            <div className="summary-cell">
              <b className="num">{money(settlement.houseFees)}</b><span>High Roller fees</span>
            </div>
          </div>

          {settlement.chipDiscrepancy !== 0 && night.players.length > 0 && (
            <div className="warn">
              The count is off by <b>{money(Math.abs(settlement.chipDiscrepancy))}</b>{' '}
              ({settlement.chipDiscrepancy > 0 ? 'short' : 'over'}). Chips issued should equal
              chips counted down — somebody is holding out, or a cash-out is mistyped.
            </div>
          )}

          <div className="field">
            <label htmlFor={`recap-${night.id}`}>
              The Winner's Recap
              {settlement.recapAuthor?.name ? ` — ${settlement.recapAuthor.name}'s homework` : ''}
            </label>
            <textarea
              id={`recap-${night.id}`}
              value={night.recap}
              placeholder={
                'Memorable hands, bad beats, ridiculous bets, Dexters, bomb pots, ' +
                'questionable decisions, and the conversations that made the night worth remembering.\n\n' +
                'Accuracy is encouraged. Entertainment value is also encouraged.'
              }
              onChange={(e) => onChange({ ...night, recap: e.target.value })}
            />
          </div>

          <div className="row">
            <a className="btn primary" href={mailtoLink(night)}>Email the recap</a>
            <button className="btn small" onClick={copyRecap}>
              {copied ? 'Copied ✓' : 'Copy recap text'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
