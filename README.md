# BNOTW — Best Night Of The Week

A Texas Hold'em app built around the BNOTW house rules, plus a running Record
Book that carries from game night to game night.

Two halves:

- **The Table** — $0.25/$0.50 No-Limit Hold'em against computer opponents, with
  every BNOTW house rule in play: the $42/$40 buy-in, Bob-aloos and Dave-aloos,
  straddles and re-straddles from any position, Pineapple and Crazy Pineapple
  bomb pots, and the progressive 7-2 Dexter.
- **The Record Book** — buy-ins, rebuys, cash-outs, net profit, High Roller
  Fees, Dexter counts and the winner's recap, for real game nights as well as
  app sessions. Long-term standings carry forward instead of resetting.

It is a web app and works on a phone, so you can keep the book at the table.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 75 tests
npm run build      # static bundle in dist/
```

`dist/` is a plain static site — any static host will serve it, and paths are
relative so it works from a subdirectory too.

## How the house rules are implemented

### Money

Everything is handled in whole cents. Every amount in the game is a multiple of
25¢ (the green chip), so integer arithmetic keeps a $1.75 Bob-aloo exact and
there is no floating-point drift.

| Rule | Implementation |
| --- | --- |
| Buy-in | $42 out of pocket, $40 in chips, $2 to the house |
| Chips | 5 black, 10 white, 6 red, 8 green — 29 chips, $40.00 |
| Blinds | $0.25 / $0.50 |
| Bob-aloo | $1.75 — named automatically whenever a bet lands on it |
| Dave-aloo | $6.75 — same |
| High Roller Fee | $5 when net profit is **strictly more than** $100 |

### Straddles

Declared in a window before any cards are dealt, exactly as the rules require.
Any seat except the blinds may straddle, and re-straddles double the previous
one. The last straddler acts last pre-flop and the action opens to their left,
so a button straddle moves first action to the small blind.

A straddle is treated as a live blind that plays as the big blind for the hand,
so the minimum raise over a $1.00 straddle is to $2.00 — the usual live-room
practice rather than the strict "raise by the last increment" reading.

### The Dexter

A win counts when all of these hold:

- The winner's live hole cards are exactly a 7 and a 2.
- The board reached the river (five cards).
- The winner took the whole pot on their own — every pot awarded to one player,
  with no chop anywhere in the hand.
- The winner showed. A showdown is not required; if everyone folds on the river
  the app offers the winner the choice to show and collect, or muck and waive it.

The bonus ladder is progressive with no cap: the nth Dexter of the session
collects $n from every other player at the table (not just those in the hand).
A short stack pays only what it has in front of it.

In a Crazy Pineapple bomb pot the discard happens before the river, so "your two
hole cards" means the two you kept.

### Bomb pots

Triggered on a schedule, or immediately after any regular hand whose flop comes
all one suit. The dealer's choice between Pineapple ($2 ante, 2 cards) and Crazy
Pineapple ($3 ante, 3 cards, discard one after the flop) is made at random by
default, or you can pin it in settings. Antes are dead money — there is no
pre-flop betting, the flop is dealt immediately, and the first bet comes from the
first live seat left of the button.

The house rule is a bomb pot approximately every 30 minutes. App hands run far
faster than live ones, so the default schedule counts hands (every 12) instead;
the 30-minute clock is still there in settings if you want it literally.

### The button and bomb pots

A bomb pot is an extra hand and never consumes a turn on the button:

- The first bomb pot of a run keeps the button exactly where the last regular
  hand left it.
- Each back-to-back bomb pot after that moves the button forward one seat.
- When the run ends the regular rotation resumes from where it was, so nobody
  loses their normal turn on the button.

### Cashing out and the Record Book

Net profit is **cash-out minus chips received** ($40 per buy-in), matching the
worked examples in the house rules: $40 in and $145 out is $105 profit and owes
the fee; $80 in after a rebuy and $175 out is $95 profit and does not. The
book also shows cash out of pocket ($42 per buy-in) and the house's take from
both the $2s and the High Roller Fees, so the numbers reconcile.

The Record Book tracks the columns the rules call for — date, player, total
buy-in, rebuys, final cash-out, net profit/loss, High Roller Fee, biggest
winner, Dexter wins, final Dexter level and the recap — and adds a chip-count
check that tells you when chips issued do not match chips counted down.

The biggest net profit is named as that night's winner and flagged as owing the
recap; the all-time standings track how many recaps each player still owes.
"Email the recap" opens a mail draft with the results table and the write-up
already formatted.

Nights can be keyed in by hand for real game nights, or saved straight out of an
app session via **Cash out**.

## Where the data lives

The Record Book is stored in this browser's `localStorage`. It survives reloads
but never leaves the device and is not synced anywhere. Use **Backup JSON** to
keep a copy or move the book to another device, and **Import JSON** to merge it
back — nights are matched by id, so re-importing an edited night updates it
rather than duplicating it. CSV exports are there for spreadsheets.

## Layout

```
src/
  engine/          no UI, no React — the whole game is testable in isolation
    cards.ts       deck, seedable PRNG, shoe
    handEval.ts    best five of any card set
    bnotw.ts       house-rule constants and money helpers
    types.ts       game state types
    hand.ts        one hand: posting, dealing, betting, side pots, showdown
    table.ts       the session: stacks, button, bomb-pot scheduling, Dexter ladder
    ai.ts          computer opponents
  state/           the Record Book: settlement maths, storage, exports
  ui/              React components
```

## Testing

75 tests, all in `npm test`:

- The hand evaluator is checked against the exact frequency distribution of all
  2,598,960 five-card hands (40 straight flushes, 624 quads, and so on).
- Betting rules: minimum raises, under-sized all-in raises that do not reopen
  the action, side pots by commitment level, uncalled bets returned, chopped
  pots split down to the chip.
- Every house rule has its own tests: straddle ordering and pricing, bomb-pot
  antes and discards, monotone-flop triggers, the bomb-pot button rules, and
  each Dexter qualification condition including the ones that disqualify.
- The Record Book is tested against the worked examples in the house rules.
- A 400-hand self-play soak test asserts that chips are conserved — total stacks
  always equal total buy-ins — and that every pot is fully awarded.

---

**Win big. Pay the house. Write the recap.**
