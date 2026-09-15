import { useMemo, useState } from 'react'
import {
  BIG_BLIND, BUY_IN_CASH, BUY_IN_CHIPS, CHIP_SET, HOUSE_CUT_PER_BUY_IN,
  NAMED_BETS, SMALL_BLIND, money,
} from '../engine/bnotw'
import { allHandNames, type CustomHandNames } from '../engine/handNames'
import { Chip } from './pieces'

export function RulesView({
  handNames = {}, onHandNames,
}: {
  handNames?: CustomHandNames
  onHandNames?: (names: CustomHandNames) => void
} = {}) {
  const chipTotal = CHIP_SET.reduce((sum, c) => sum + c.value * c.quantity, 0)
  const chipCount = CHIP_SET.reduce((sum, c) => sum + c.quantity, 0)

  return (
    <div className="scroll rules">
      <div className="panel">
        <h2>BNOTW House Rules</h2>
        <p className="lead">
          The regular game is {money(SMALL_BLIND)}/{money(BIG_BLIND)} No-Limit Texas Hold'em,
          with a collection of BNOTW traditions, side bets, straddles, bomb pots and
          bragging rights mixed in. Standard Hold'em rules apply unless a house rule says
          otherwise.
        </p>
      </div>

      <div className="panel">
        <h3>Buy-in &amp; chips</h3>
        <p>
          The buy-in is <b>{money(BUY_IN_CASH)}</b>. You receive <b>{money(BUY_IN_CHIPS)}</b> in
          chips; the remaining {money(HOUSE_CUT_PER_BUY_IN)} goes to the house to help cover
          miscellaneous game-night expenses.
        </p>
        <div className="tablewrap">
          <table className="grid" style={{ minWidth: 360 }}>
            <thead>
              <tr><th>Colour</th><th>Value</th><th>Qty</th><th>Total</th></tr>
            </thead>
            <tbody>
              {CHIP_SET.map((chip) => (
                <tr key={chip.color}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Chip value={chip.value} /> {chip.label}
                    </span>
                  </td>
                  <td>{money(chip.value)}</td>
                  <td>{chip.quantity}</td>
                  <td>{money(chip.value * chip.quantity)}</td>
                </tr>
              ))}
              <tr>
                <td><b>Total</b></td><td /><td><b>{chipCount}</b></td><td><b>{money(chipTotal)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>Rebuys</h3>
        <p>
          Rebuys are always welcome. If you need more chips you can rebuy and get back in
          the action. There is no shame in a rebuy — in fact, the rest of the table will
          probably encourage it.
        </p>
      </div>

      <div className="panel">
        <h3>Named bets</h3>
        <p>
          At BNOTW you will sometimes hear a bet called by name instead of a dollar amount.
          These are simply names for specific amounts; they do not otherwise change the hand.
        </p>
        {NAMED_BETS.map((bet) => (
          <div className="kv" key={bet.name}>
            <span><b style={{ color: 'var(--dexter)' }}>{bet.name}</b> — {bet.breakdown}</span>
            <b>{money(bet.amount)}</b>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Straddles</h3>
        <p>
          BNOTW allows straddles from any player in any position, and re-straddles are also
          allowed. All straddles must be declared before action begins and before players
          look at their cards. Once players have looked at their cards, no additional
          straddles may be added.
        </p>
        <p className="muted" style={{ fontSize: 12.5 }}>
          In this app a straddle plays as the big blind for the hand: the first straddle is
          {' '}{money(BIG_BLIND * 2)}, each re-straddle doubles it, the last straddler acts
          last pre-flop, and the next raise has to double the straddle.
        </p>
      </div>

      <div className="panel">
        <h3>The Dexter — 7-2</h3>
        <p>
          A starting hand of 7-2 is called a <b>Dexter</b>, named after Dexter Manley, who
          wore #72. Winning with a Dexter earns a bonus from the table.
        </p>
        <ul>
          <li>Your two hole cards must be a 7 and a 2.</li>
          <li>The hand must reach the river.</li>
          <li>You must be the sole winner of the pot.</li>
          <li>You must show your 7-2 to collect.</li>
          <li>A showdown is not required — if everyone folds after the river it still counts, as long as the winner shows.</li>
          <li>A chopped pot does not count.</li>
        </ul>
        <h3>Progressive Dexter</h3>
        <p>
          The bonus increases every time someone successfully wins with one during the night.
          1st Dexter: everyone else pays $1. 2nd: $2. 3rd: $3. 4th: $4. And so on —
          <b> there is no cap</b>, and the progression continues for the entire session.
        </p>
      </div>

      <div className="panel">
        <h3>Bomb pots</h3>
        <p>
          BNOTW plays a bomb pot approximately every 30 minutes. A bomb pot is also triggered
          whenever the three cards on the flop of a regular hand are all the same suit.
          The dealer chooses the game.
        </p>
        <div className="kv">
          <span><b style={{ color: 'var(--bomb)' }}>Pineapple</b> — 2 hole cards, no pre-flop betting, flop dealt immediately, betting begins after the flop</span>
          <b>$2 ante</b>
        </div>
        <div className="kv">
          <span><b style={{ color: 'var(--bomb)' }}>Crazy Pineapple</b> — 3 hole cards, no pre-flop betting, flop dealt immediately, then each player discards one before betting</span>
          <b>$3 ante</b>
        </div>
        <h3>The button &amp; bomb pots</h3>
        <p>
          A bomb pot is an extra hand — it does not take away someone's normal turn on the
          button. For a normal bomb pot the button stays where it is, and regular Hold'em
          resumes after. If another bomb pot occurs immediately after a bomb pot, the button
          moves forward one position for the second bomb pot; once that is finished the
          button returns to the position of the original bomb pot and regular play resumes.
        </p>
      </div>

      <div className="panel">
        <h3>Cashing out &amp; the High Roller Fee</h3>
        <p>
          At the end of the night everyone's total buy-ins and cash-out are calculated to
          determine net profit or loss. If you finish with more than <b>$100 in net profit</b>,
          congratulations — you are officially a BNOTW High Roller, and you owe the house <b>$5</b>.
        </p>
        <div className="kv"><span>Bought in for $40, cashed out $145 = $105 profit</span><b>$5 fee</b></div>
        <div className="kv"><span>Bought in for $80 after a rebuy, cashed out $175 = $95 profit</span><b>No fee</b></div>
        <p className="muted" style={{ fontSize: 12.5 }}>It is based on profit, not the size of your final chip stack.</p>
      </div>

      <div className="panel">
        <h3>The winner's recap</h3>
        <p>
          The player who finishes the night with the largest net profit is officially that
          night's BNOTW winner — and the winner has homework. The biggest winner must write
          the official BNOTW recap and email it to the group.
        </p>
        <p>
          The recap should capture more than just who won and lost: the memorable hands, bad
          beats, ridiculous bets, Dexters, bomb pots, questionable decisions, and the
          conversations and stories that made the night worth remembering. Accuracy is
          encouraged. Entertainment value is also encouraged.
        </p>
        <p className="muted" style={{ fontSize: 12.5 }}>
          What happens at BNOTW may stay at BNOTW… but apparently it also gets documented
          and emailed to everyone.
        </p>
      </div>

      <div className="panel">
        <h3>Quick reference</h3>
        {[
          ['Buy-in', `${money(BUY_IN_CASH)} (${money(BUY_IN_CHIPS)} chips + ${money(HOUSE_CUT_PER_BUY_IN)} house)`],
          ['Blinds', `${money(SMALL_BLIND)} / ${money(BIG_BLIND)}`],
          ['Rebuys', 'Always welcome'],
          ['Bob-aloo', money(175)],
          ['Dave-aloo', money(675)],
          ['Straddles', 'Any position; re-straddles allowed'],
          ['Dexter', '7-2; reach river + sole winner + show'],
          ['Dexter bonus', 'Progressive $1, $2, $3, $4…'],
          ['Scheduled bomb pot', 'Approximately every 30 minutes'],
          ['Suited flop', 'Triggers a bomb pot'],
          ['Pineapple', '$2 ante / 2 cards'],
          ['Crazy Pineapple', '$3 ante / 3 cards / discard 1'],
          ['$100+ profit', '$5 High Roller Fee'],
          ['Biggest winner', 'Writes & emails the BNOTW recap'],
        ].map(([k, v]) => (
          <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>
        ))}
        <p className="muted" style={{ marginTop: 14, textAlign: 'center', letterSpacing: '0.08em' }}>
          Win big. Pay the house. Write the recap.
        </p>
      </div>

      {onHandNames && <HandNameEditor names={handNames} onChange={onHandNames} />}
    </div>
  )
}

/**
 * What this table calls its hands.
 *
 * Lives here rather than in Settings because it is house flavour, the same as
 * the named bets — and like the named bets, the ones that matter are the ones
 * this table invented. The shipped list is a starting point that can be
 * renamed, extended or emptied.
 */
function HandNameEditor({
  names, onChange,
}: {
  names: CustomHandNames
  onChange: (names: CustomHandNames) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const list = useMemo(() => allHandNames(names), [names])

  const add = () => {
    const cleaned = key.trim().replace(/\s+/g, '')
    if (!VALID_KEY.test(cleaned)) {
      setError('Write the hand like AKs, AKo or QQ — high card first.')
      return
    }
    if (!label.trim()) {
      setError('Give it a name.')
      return
    }
    const canonical = cleaned[0].toUpperCase() + cleaned[1].toUpperCase() + (cleaned[2]?.toLowerCase() ?? '')
    onChange({ ...names, [canonical]: label.trim() })
    setKey('')
    setLabel('')
    setError(null)
  }

  return (
    <div className="panel">
      <h2>Hand Names</h2>
      <p className="sub">
        What the table shouts when the cards come out. Shown under your hole
        cards before the flop. The list below ships with the app — rename
        anything, clear anything you never say, and add your own.
      </p>

      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0, flex: '0 0 110px' }}>
          <label htmlFor="handkey">Hand</label>
          <input
            id="handkey"
            value={key}
            placeholder="J6o"
            maxLength={3}
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: '1 1 180px' }}>
          <label htmlFor="handlabel">Called</label>
          <input
            id="handlabel"
            value={label}
            placeholder="Insurrection"
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <button className="btn small" onClick={add}>Add</button>
      </div>
      {error && <div className="warn bad" style={{ marginTop: 8 }}>{error}</div>}

      <div className="tablewrap" style={{ marginTop: 12 }}>
        <table className="grid">
          <thead><tr><th>Hand</th><th>Called</th><th /></tr></thead>
          <tbody>
            {list.map((entry) => (
              <tr key={entry.key}>
                <td className="num">{entry.key}</td>
                <td>
                  <input
                    className="cell-input"
                    style={{ width: '100%' }}
                    value={entry.name}
                    maxLength={40}
                    onChange={(e) => onChange({ ...names, [entry.key]: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    className="btn small ghost"
                    title="Stop showing this one"
                    /* Cleared rather than deleted: an empty entry is what hides
                       a shipped name, and deleting the key would simply bring
                       the shipped one back. */
                    onClick={() => onChange({ ...names, [entry.key]: '' })}
                  >
                    Clear
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** AKs, AKo, QQ — two ranks and an optional suitedness. */
const VALID_KEY = /^[2-9TJQKA][2-9TJQKA][so]?$/i
