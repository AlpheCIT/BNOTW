# BNOTW — Best Night Of The Week

A Texas Hold'em app built around the BNOTW house rules, plus a running Record
Book that carries from game night to game night.

Four parts:

- **The Table** — $0.25/$0.50 No-Limit Hold'em against computer opponents, with
  every BNOTW house rule in play: the $42/$40 buy-in, Bob-aloos and Dave-aloos,
  straddles and re-straddles from any position, Pineapple and Crazy Pineapple
  bomb pots, and the progressive 7-2 Dexter.
- **Coach** — a separate practice table that shows your equity, your outs, the
  price you are being laid and what it would recommend, then reviews what you
  actually did. Nothing from it reaches the Record Book.
- **Players** — the roster of regulars, each with a face and a way of playing
  you can tune.
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

## Players

Fourteen regulars ship with the app — Bob, Brett, Ransom, Dave, Don, Hal, Ian,
Eadie, Mark, Rosen, Carter, Nate, Kruger and Richie — and you can add more.
Anyone can be renamed, given a different face, or tuned. Up to eight sit down at
once.

**The archetypes and skill levels the regulars start with are arbitrary. They
are not a read on how anybody actually plays** — pick something closer to the
truth in the Players tab.

### Skill and tendencies are separate

How somebody plays is two independent things, because at a real table they are:

- **Skill (1-5)** is how *well* they play.
- **Tendencies** are how they *like* to play: looseness, aggression, bluffing,
  chasing, gamble and straddle appetite.

A loose-aggressive expert and a loose-aggressive donk have identical tendencies
and are completely different opponents, which is why one dial cannot carry both.

Seven presets seed the sliders and can be edited from there: the Nit, the Rock,
the Grinder, the Shark, the Calling Station, the Gambler and the Maniac.

### What skill actually changes

A weak player is not one who decides at random. This was measured rather than
assumed, and the first attempt did not work: modelling weak play as *noise*
produced no detectable edge at all over 7,200 hands. Errors that cut both ways
cancel out and cost almost nothing.

What makes a player expensive is errors that all point the same way, so skill
drives four things:

- **Optimism** — how far they overrate their own hand. This is the expensive one.
- **Field awareness** — a beginner prices a six-way pot as though only two
  people could beat them.
- **Position** — whether they widen on the button and tighten out of position.
- **Simulation depth** — how sharply they read their equity at all.

The optimism ladder was calibrated by measurement, not taste: below roughly 0.2
the bias is too small to move money at any sample size worth running, so most of
the ladder's weight sits at the bottom. That matches life, where the gap between
a novice and an average player is far wider than the gap between average and
expert.

Measured with duplicate scoring over 3,000 hands per pairing:

| Matchup | Edge to the stronger player |
| --- | --- |
| Skill 5 vs skill 1 | +36.8 bb/100 |
| Skill 3 vs skill 1 | +33.0 bb/100 |
| Skill 4 vs skill 2 | +9.8 bb/100 |
| Skill 3 vs skill 3 | 0.0 bb/100 (control) |
| Skill 5 vs skill 3 | +1.8 bb/100 — not significant |

**A known limitation:** skill 5 is not measurably better than skill 3. The
bottom of the ladder is where the money is; the top of it differs only in
accuracy and position play, and none of the profiles adjust to how a *particular*
opponent is playing. Beating a calling station means value-betting far wider than
usual, and no profile here does that. Treating skill 3, 4 and 5 as "does not
donate" rather than as three distinct strengths is the honest reading.

Faces are drawn, not downloaded: each one is a handful of indices into fixed
palettes, so a persona costs a few bytes, renders identically everywhere, and
needs no image assets or network. You can shuffle a face, edit any feature, or
use a photo instead (shrunk to a 160px square so the roster stays storable).

## Coach

A second table that never touches your records. On every decision it shows:

- **Win probability** against the players still in the hand — the number a
  broadcast puts on screen. Every runout is counted exactly when that is cheap
  (990 on the flop, 44 on the turn) and sampled only when it is not.
- **Chen score** and a grade for your starting hand pre-flop.
- **Your outs**, grouped by what they make, each with its own odds of arriving
  by the river.
- **The price** — pot odds, the equity you need to break even, and the expected
  value of calling in cents.
- **A recommendation**, with the reasoning that produced it. The point is not to
  be told what to do; it is to see the arithmetic you should have been doing.

Then it reviews what you did, and keeps a running scorecard: how often you
matched the recommendation, how much expected value the gap cost, and which
mistakes you make most.

**X-ray** turns every hand face up with live win percentages, the way a
televised hand looks. It is a study tool, so it only exists in coach mode.

Two honest notes on the numbers:

- Equity is computed against opponents holding hands *worth playing* rather than
  random cards. Pricing a call against random hands is the most common way to
  talk yourself into a bad one. It is still an assumption about their range, not
  knowledge of it.
- Outs count cards that *improve* your hand, not cards that win. A card can
  improve you and leave you behind; the equity figure is the answer to "am I
  ahead". Cards that only pair the board are not counted, since they help
  everyone equally.

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
    persona.ts     who is in the seat: faces, skill, tendencies
    coach.ts       equity, outs, pot odds and the recommendation
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
- Coach arithmetic is checked against known values: flush draws at 9 outs and
  34.97% by the river, open-enders at 8 and 31.48%, gutshots at 4, aces over
  kings landing in the right band, and board-pairing cards correctly not counted
  as outs.
- The skill dial is measured, not asserted, using duplicate scoring. The control
  case — two identical profiles — must cancel to *exactly* zero; that check is
  what caught the table's auto-rebuy being counted as profit and quietly
  contaminating every earlier measurement.

---

**Win big. Pay the house. Write the recap.**
