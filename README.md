# BNOTW — Best Night Of The Week

A Texas Hold'em app built around the BNOTW house rules, plus a running Record
Book that carries from game night to game night.

Five parts:

- **The Table** — $0.25/$0.50 No-Limit Hold'em against computer opponents, with
  every BNOTW house rule in play: the $42/$40 buy-in, Bob-aloos and Dave-aloos,
  straddles and re-straddles from any position, Pineapple and Crazy Pineapple
  bomb pots, and the progressive 7-2 Dexter.
- **Coach** — a separate practice table that shows your equity, your outs, the
  price you are being laid and what it would recommend, then reviews what you
  actually did. Nothing from it reaches the Record Book.
- **My Game** — every hand you play, tracked: your tendencies in the terms a
  poker tracker uses, where your decisions go wrong, and a rating built on
  decision quality rather than results.
- **Explanations** (optional) — with a model service configured, the coach
  can put its reasoning into words, answer follow-up questions, and review your
  whole history for patterns.
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
npm test
npm run build      # static bundle in dist/
```

`dist/` is a plain static site — any static host will serve it, and paths are
relative so it works from a subdirectory too.

## Putting it on a phone

The app installs to a home screen and runs offline. There is no server to run
and nothing to sign into: the whole thing is static files plus whatever is in
your browser's storage.

### Deploying it

Any static host works. `netlify.toml` and `vercel.json` are both here, and
`.github/workflows/deploy.yml` publishes to GitHub Pages.

**If the repository is private,** GitHub Pages needs a paid plan — Netlify,
Cloudflare Pages and Vercel all serve a private repo on their free tiers, so
one of those is the easier path. (Free tiers change; check the current terms
rather than taking this paragraph as fact.) Point the host at this repo and it
needs nothing else:

| | |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `dist` |

**To skip the git connection entirely,** run `npm run build` and drag `dist/`
onto a host that takes a direct upload. That gets a URL in about a minute and
is the fastest way to try the thing on a real phone.

**If the repository is public,** enable Settings → Pages → Source: GitHub
Actions and the included workflow deploys on every push to `main`.

Whichever host, the cache headers matter and the config files set them:
`assets/*` is content-hashed and cached forever, while `index.html` and `sw.js`
must not be cached, because they are the only way a new build reaches anyone.

### Installing it

- **iOS** — open the URL in Safari, Share → Add to Home Screen. It must be
  Safari; other iOS browsers cannot install a web app.
- **Android** — Chrome offers "Install app", or Menu → Add to Home screen.
- **Desktop** — Chrome and Edge show an install control in the address bar.

Installed, it opens full screen with no browser chrome.

### Offline

A service worker precaches the build, so after the first visit the app opens
and plays with no connection at all — verified with the network cut: every tab
renders, hands deal, and the coach answers, because all of that is computed on
the device. The only thing that needs a network is the optional model
explanation.

A new build never takes over a page that is already open; a hand in progress
would be lost. Instead the app shows a "new version is ready" bar and reloads
when you say so.

`scripts/build-sw.mjs` generates the worker after the bundle exists, because the
precache list has to name the exact hashed filenames Vite produced.

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

## Who's playing

The crew share devices. Somebody hands over their iPad, Dave plays four hands
to see what it is, and those four hands are now in the owner's record — moving
their VPIP and their rating exactly as hard as hands they meant. Deleting hands
afterwards was the cure; this is the prevention.

On first open the app asks who is playing. Names on chips, tap one, play.

**This is not accounts.** No password, no login, no server, nothing leaves the
device. A profile is a name and a colour that scopes some storage keys, and
anybody holding the device can pick anybody. That is the correct amount of
security for a six-person home game, and more would be a thing to maintain
forever in exchange for nothing.

Each player owns their own hand history, tendencies, rating, practice record,
coach scorecard and coaching layers. Switching player reloads all of it rather
than filtering one set in memory, so there is never a moment where one
person's totals are on screen under another person's name.

### Guest

**Play as guest** is on the first screen rather than buried, because the moment
it exists for is somebody saying "let me have a go" while you are holding the
device — and if that is three taps deep the hands land in your record instead.

A guest is never written down: not their hands, not their practice, not their
layers, not one key. `scopedKey` throws rather than returning one, so a caller
that forgets to check fails loudly instead of quietly writing a guest's hands
to disk. A guest is never remembered as the active player either, so the next
person to open the app is asked who they are rather than dropped into a
stranger's throwaway session. A visible bar says so for the whole session,
because the failure mode is somebody playing for an hour believing it counted.

### Experience

The only field that does anything beyond its label. It chooses how much of the
coach is switched on to start with — **new to poker** gets the price alone,
**show me everything** gets all four layers — which is a decision somebody new
should not have to discover in a settings dialog. It is not a difficulty
setting and never touches the bots, the form says so, and it can be changed at
any time.

### Upgrading without losing anything

The default profile's records live under the *unscoped* storage keys, exactly
where they already were. So whoever has been playing since before profiles
existed keeps every hand, and their profile is seeded from the player name they
had already set rather than being presented to them as a stranger's empty
record.

IndexedDB needed a real migration, since hands are rows in one shared store.
Schema version 2 adds a compound `[profileId, at]` index and stamps every
existing row with the default profile inside the same `versionchange`
transaction — so a half-applied upgrade is not a state the database can be left
in, and a hand that belonged to somebody cannot end up belonging to nobody.
It is tested by building a version-1 database by hand and opening it.

Deleting a player takes their stored records with them, or a reused id would
silently inherit a stranger's history. The default profile cannot be deleted
from the list at all: its records are the device's whole pre-profile history,
and removing "one player" would erase it.

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
- **Chen score** and a grade for your starting hand pre-flop, ranked below the
  equity rather than beside it — see [Chen, ranked rather than
  pinned](#chen-ranked-rather-than-pinned).
- **Your outs**, grouped by what they make, each with its own odds of arriving
  by the river.
- **The price** — pot odds, the equity you need to break even, and the expected
  value of calling in cents.
- **A recommendation**, with the reasoning that produced it. The point is not to
  be told what to do; it is to see the arithmetic you should have been doing.

How much of that is on screen is up to you — see [The
layers](#the-layers). Everything above is what you get with all four on; a new
player starts with one question at a time.

Then it reviews what you did, and keeps a running scorecard: how often you
matched the recommendation, how much expected value the gap cost, and which
mistakes you make most.

**X-ray** turns every hand face up with live win percentages, the way a
televised hand looks. It is a study tool, so it only exists in coach mode.

### The layers

Coach mode used to show everything it knew, every hand, at equal weight. For
someone learning that is not a lesson, it is a dashboard — and it is the direct
cause of the Chen complaint, because a number that is not *wrong* can still be
a problem when it sits in a tile the same size as things that matter far more
right now.

So the panels are layers to turn on, not levels to beat. Each adds rather than
replaces, they go on in any order, and anyone who wants the whole dashboard on
their first hand just turns them all on.

| Layer | The question | What it adds |
|---|---|---|
| **The price** | Is this call worth what it costs? | The pot, what the call costs, the share you need to break even |
| **The hand** | Do I actually have the hand for it? | Equity, what you have made, your outs, and Chen before the flop |
| **The player** | Who am I up against? | Position, the range each opponent is credited with, and how they have actually been playing |
| **The table** | What is different about this game? | How the house rules change the maths — bomb pots, straddles, the Dexter |

With only **The price** on, the equity bar shows the mark you have to clear and
not how close you are to it. That is the layer's whole question: work out what
you need, then go and decide whether you have it.

**The layers gate the numbers, never the advice.** The recommendation and the
reasoning behind it show at every layer, because advice you cannot check is
worse than a number you have not been introduced to.

#### When the next layer is offered

Each layer owns the mistakes it is about, and the tracker already counts them
by name: calling a price you should have passed on is a price mistake; playing
a hand that was priced fine but plays badly is a hand mistake; missing value on
the river is a line mistake. When a layer's own mistakes have gone quiet over a
decent sample, the next one is offered once, with the evidence in the prompt —
*"The price looks settled — 0 slips in 200 decisions."*

**Those thresholds are judgement, not measurement.** Sixty decisions and an 8%
slip rate were not fitted to anything; they are a reasonable-looking sample and
a reasonable-looking error rate, chosen because they had to be something. They
decide when a suggestion appears and nothing else, so being wrong about them
costs a prompt at the wrong moment.

**The table layer has no gate at all, and says so.** Reading a room happens
between the hands, in the part of poker this app cannot see. It teaches what
follows from the house rules — a bomb pot really does mean nobody chose their
cards, a straddle really does change the price — and then states plainly that
tells and timing are the one thing it cannot teach you, because it has nobody
to show you. Filling that gap with received wisdom it has no way to check would
be worse than leaving it open.

#### Chen, ranked rather than pinned

Chen is kept, because it is a genuinely useful tool for the question you have
most often: is this hand worth entering with at all. What changed is its
standing. It was in a grid cell the same size as equity, which read as an equal
authority on a decision it knows far less about — it never sees the board, the
position, the bet size or who is in the pot.

Now it is one line under the numbers that outrank it, leading with the grade,
with an explanation a tap away that says what it is good for and what it does
not know. Where Chen and the equity disagree, the panel says to believe the
equity. The pre-flop reasoning changed too: *"A-K is a strong starting hand
(Chen 10)"* rather than *"A-K scores 10 on the Chen scale"* — identical
information, and no longer a piece of unintroduced jargon at the top of every
pre-flop argument.

### Had you played it differently

Step a replay to any of your own decisions and ask what the roads not taken
were worth. Each line is played out 120 times from that point, with a fresh
runout every time, and what comes back is a range rather than a number.

**One replay would be an anecdote.** Re-running the hand once with "raise"
instead of "call" gives a single draw from a distribution, and showing it as
*the* consequence teaches exactly the results-oriented thinking the rating
exists to avoid.

So the bar is the finding. At these trial counts the bands routinely overlap,
and when they do the panel says **"none of these are far enough apart to tell
apart"** rather than crowning a winner. That is the honest answer more often
than not, and a feature that always ranks its options teaches a confidence it
has not earned.

#### Two caveats, both on screen

**Everyone's cards are held as they were dealt.** So this answers "what would
this line have done *in this hand*", not "is raising right in spots like this".
The second question needs the opponents' cards varied across a range and is a
different feature.

**The simulated opponents think less hard than the real ones.** The bots run
their own Monte Carlo on every decision, so an exploration samples the future
inside a function that is already sampling the future. At full strength one
line takes 30–40 seconds; capped, the whole thing takes about 9. The cost of
that cap was measured across four independent spots at 120 trials:

| spot | capped bots | full-strength bots |
|---|---|---|
| 0 | +387 ± 134 | **+215 ± 77** |
| 1 | −449 ± 226 | −455 ± 197 |
| 2 | +2288 ± 569 | +1981 ± 513 |
| 3 | −1031 ± 308 | −1334 ± 240 |

Three of four move the same way and one moves far enough that the bands do not
overlap. Weaker opponents lose to you more often, so **the numbers flatter your
line by roughly 10–25%**. That is a real bias in the direction that feels good,
so it is printed under the bars rather than left in a comment.

It runs in a worker and is asked for rather than computed ahead of you — 9
seconds of blocked main thread is the X-ray bug again.

### Had you stayed

You fold, the hand carries on, and as far as you are concerned it stops
existing. "Would I have hit that?" is one of the most natural questions a
learning player asks and nothing answered it.

Once a hand you folded finishes, coach mode shows what you would have held at
the river, whether it was the best hand out there, and what the pot was worth.
Coach mode only, for the same reason X-ray is: at a real table you do not get
to see this.

The danger here is not that it is wrong, it is that it is persuasive — *"you
would have made a flush"* is the most memorable thing on the screen and the
least useful. Showing near-misses is how you train results-oriented thinking,
which is precisely the habit the rating was built to avoid. So:

- It reports what your hand would have **been**, never what you would have
  **won**. The panel says "the best hand at the river", which is a different
  claim and the difference is the whole lesson.
- **The equity you had when you folded is printed above the runout that came.**
  The other order reads as "you were robbed".
- The caveat is body text, not a footnote, and it names the second reason this
  is weak evidence as well as the first: with you still in the hand, the
  betting would not have gone the same way, so some of those hands would never
  have reached the river at all. A fold that would have won is usually still
  the right fold.
- A hit is not styled as a success. The tint marks which case it is without
  scoring it.

When the hand ended before the river there is nothing to show, and it says so
rather than dealing a runout that never came — that would be answering about a
different hand. Same when everyone else folded too and there was nobody left to
have beaten.

### The last hand

A **Last hand** control on the table itself, in both modes, opens the replay of
the hand that just happened. Replay already existed but lived in My Game, so
the moment you most want to look at a hand — straight after playing it — was
the moment it was hardest to reach. Each mode shows its own last hand: a
coach-mode hand appearing at the table would be a hand that never happened
there.

### Coaches who disagree

One voice delivering one verdict teaches you what to do. Two voices arguing
over the same spot teach you *why*, because good players genuinely disagree
about marginal hands far more than a single confident recommendation suggests.
Pick a **Coach** and optionally a **2nd**, and where they differ the second
read is called out rather than buried.

Five voices ship, and between them they cover the corners rather than a line
through the middle — a loose small-ball read, a loose raise-or-fold read, a
selective-aggressive one, a patient tight one, and the plain numbers:

| | folds more | plays more |
|---|---|---|
| **bets small** | The House | Dominic North |
| **bets big** | Walter Boyd (tight) | Philippa Ingram (selective), Sonny Bracken (any two cards) |

How often they actually disagree, measured over 200 pre-flop spots six-handed
(so these are entry decisions, where `entryShift` does most of its work):

| second opinion | differs from The House |
|---|---|
| Sonny Bracken | 43% |
| Dominic North | 36% |
| Philippa Ingram | 8% |
| Walter Boyd | 7% |

Pick a second opinion that is not The House and the spread is wider still:
Walter Boyd against Sonny Bracken differ on 48% of spots, Dominic North against
Walter Boyd on 42%, while Dominic North against Sonny Bracken — both very loose
— differ on only 8%. Across all five, at least one disagrees in 48% of spots.

Two things worth taking from that. The useful pairing is one from each corner;
two voices from the same corner are one voice answering twice. And a tight or
selective voice barely disagrees with the plain numbers *before the flop*,
because the house bar is already fairly tight — their disagreement is mostly
about how hard to bet once a hand is underway, which these figures do not
measure.

Each voice shifts the Chen score needed to enter a pot, how readily it turns a
call into a raise, and how big it bets. **Nothing about the equity changes**:
the arithmetic is the arithmetic, and a voice only moves the bar it is judged
against and the words it uses.

The names are invented characters, not portraits. A playing style is a
description of poker and belongs to nobody, but a living player's name is
theirs, and a thin alias that maps one-to-one onto a real person is that
person's name wearing a hat. The styles are drawn from schools of thought — the
small-ball read-the-player approach, the selective-aggressive one, the patient
positional one, and the old-school argument that position and aggression win
more pots than cards do. None of the numbers is a claim about how anyone in
particular plays, and none was measured from anyone's hands. Every name is
editable, and **Original names** in the same dialog puts them back.

Two honest notes on the numbers:

- Equity is computed against opponents holding hands *worth playing* rather than
  random cards. Pricing a call against random hands is the most common way to
  talk yourself into a bad one. It is still an assumption about their range, not
  knowledge of it.
- Outs count cards that *improve* your hand, not cards that win. A card can
  improve you and leave you behind; the equity figure is the answer to "am I
  ahead". Cards that only pair the board are not counted, since they help
  everyone equally.

## Drill

One decision at a time, with the coach marking each one.

Spots are **generated, not replayed from your history**. A spot you have seen
before is one you can remember the answer to, which trains recall rather than
judgement. So a real hand is dealt and played out by the bots — the same
engine, the same rules — and handed to you at the moment the decision arrives.
Your own seat is played by a bot up to that point, because a spot has to be
arrived at by plausible play or it is not one you would ever face.

Which street comes up is seeded from your record: streets you disagree with the
coach on most come up most, weighted 4:3:2:1 over the ranking so the weakest is
four times as likely as the strongest and none is ever excluded. A street needs
at least twenty measured decisions before it can be called weak — three bad
rivers are not evidence — and unmeasured streets queue behind measured ones
rather than being given a made-up score.

There is no bet sizing, because sizing is not marked: the verdict turns on
whether you fold, call or raise. Offering a slider would imply a precision the
marking does not have.

Bomb pots and straddles are kept out. Both change the price of everything for
reasons unrelated to the decision being practised. (The suited-flop rule forces
a bomb pot on the next hand regardless of the schedule, so turning the schedule
off is not enough on its own — the drill clears it every hand.)

**Drill results are kept out of your record and out of your rating.** The
rating is a claim about how you play: hands you were dealt, money that was
yours. Drill spots are generated, repeatable and free, so folding them in would
let a number meant to describe reality be moved by grinding spots you find easy.
The drill keeps its own tally instead.

The next spot is dealt while you are reading the verdict on the current one.
Generating one means playing a whole hand and running the coach over it — up to
a second on a phone — and a drill that pauses between questions is one nobody
finishes.

## My Game

Every hand you play — at the table and in coach mode both — is recorded, and two
different things are built from it. They are worth keeping apart.

### Tendencies: what you do

The standard tracker stats: VPIP, pre-flop raise, 3-bet, aggression factor, went
to showdown, and won at showdown. These are descriptive. There is no wrong VPIP,
only one that does not match the way you are trying to play.

Each one is shown against a shaded guidance band, and held back entirely until
there is enough of a sample for the number to mean anything. **The bands are
rough guidance for a six-handed game, not rules** — a friendly live game runs
looser than them across the board, and playing looser than "standard" is a
choice rather than a mistake so long as you know you are making it.

Alongside them is a plain-language read on what to work on: limping too much,
calling more than you bet, taking too many flops to showdown, and so on.

### Replay: what actually happened

Any recent hand can be stepped through from the Recent Hands table, or from
**Worth a Second Look** — the hands that cost the most against the coach's line,
worst first.

A replay shows the board filling in, the chips going in, and **every hand face
up**, so the equity shown is not the coach's estimate against an assumed range —
it is the true number, counted exactly wherever the runout is small enough to
enumerate. Your own decisions are annotated with what the coach would have done
and what the difference cost. In a Crazy Pineapple pot the third card stays
hidden until the moment it was actually pitched.

Replays are stored with the hand, and are the largest thing the app keeps. The
most recent 150 hands keep theirs; older hands keep their summary row and drop
the replay, so the history stays storable and the running totals never depend
on it.

### By position

Where the money actually comes from, seat by seat: hands, bb/100, VPIP, PFR,
decision accuracy and EV given up from BTN, CO, MP, EP, BB and SB.

**The record used to throw this away.** `HandRecord.position` was
`'button' | 'other'`, so "how do I play from under the gun" was not a question
the history could answer — not because the sums were hard but because the
information was discarded at the moment it was free. Hands played before this
was added are permanently unplaceable, and the table says how many rather than
quietly showing a smaller total than the panel above it.

Every win rate carries a confidence band, for the same reason the overall one
does and more so: split six ways, a home game's history is nowhere near enough
hands to pin a positional win rate down. A bare column of bb/100 figures
invites exactly the conclusion the data will not support. Rates under 30 hands
from a seat are greyed out, and a rate with too little behind it shows a dash
instead of a number. **Accuracy is the column worth reading first** — decision
quality settles far sooner than results do.

Positions are running counters on the totals, not something recomputed from the
stored hands, so trimming old history never changes them.

#### A bug this turned up

Naming the seat existed in three places — the coach's reasoning, the table
heading, and the record — and two of them were wrong short-handed:

```ts
if (i === n - 1) return 'on the button'
if (i === n - 2) return 'in the cut-off'     // ← three-handed, this is the big blind
if (seat === state.smallBlindSeat) ...
```

Testing the seat's *index* before testing the blinds is right at a full table
and wrong below five players, so the coach was telling short-handed players
they were in the cut-off when they were in the blind — and adjusting its
pre-flop bar by two Chen points accordingly. Blinds are now decided by the seat
they actually are, and position by index only for the seats in between. All
three callers share one `positionOf`.

Worth saying plainly: that bug was harmless while it only produced prose. It
stopped being harmless the moment the same value started being written into
permanent history.

### Correcting the record

Hands played to try the app out move your VPIP and your rating exactly as hard
as hands you meant, which is a problem for the one number this app exists to
make honest.

**Remove hands**, above the Recent Hands table, turns the list into a
selection: tap the rows to remove, or take **All coach hands** in one go. It
always takes two presses, and it is never one tap away from erasing something.

Removing a hand subtracts it from the running totals rather than recounting
what is left — the counters are kept that way on purpose, so that trimming old
hands never changes your VPIP. The property that matters is tested directly:
deleting a hand leaves exactly the totals a history without it would have had,
for every position in the history and in any order. Two fields are deliberately
not reversible, `firstAt` and `lastAt`, because a minimum and a maximum cannot
be recovered by subtraction; the window they feed is only ever too wide, and it
is cleared when the last hand goes.

Only hands still held in memory can go this way, which is what the list offers
anyway. A hand older than that is no longer around to subtract, and guessing at
its contribution would corrupt the totals rather than correct them.

### Start Fresh

**My Game → Start Fresh** puts things back the way they shipped, one line at a
time, each saying what it takes before it takes it: your hand history, your
practice history, the coach scorecard, the players, the coaches, the hand
names, and games in progress.

Two things sit outside **Select everything**. A table in progress is only worth
clearing deliberately. And the Record Book is never swept up in a bulk action:
it is the only thing in the app about real money owed between real people, so
it has to be asked for by name and carries its own warning. Deleting it does
not settle anything — it just means nobody can look it up.

The point of this is less the deleting than the editing. The personas and the
coaches are meant to be changed; without a way back to the shipped numbers, the
safe thing to do with a persona you are curious about is nothing.

### Your biggest leaks

What is actually costing you, worst first — with one column that took more
thought than the rest of the panel.

**Four of the coach's seven leaks cannot be priced at all.** What it costs to
check a hand you should have bet depends on what your opponent would have done
with the bet, and the engine has no way to know. Only the two price mistakes —
calling too light, folding a good price — have an EV figure behind them,
because those are the one case where the engine already knows the value of the
call it is comparing against.

That leaves two bad options and one good one. Dropping the unpriced leaks would
hide three of the most common mistakes in the app. Pricing them at zero would
rank them below everything. So they are listed, marked **cost not measurable**,
and sorted by frequency underneath the priced ones — and the panel says in as
many words that not measurable is not the same as free.

Which leaks carry a price is not a list typed out by hand. A test drives
`reviewDecision` through every combination it accepts, collects what it
actually produces, and fails if `PRICED_LEAKS` and reality have drifted apart.

Severity bands a slip by what one instance typically cost: under 1 bb minor,
1–4 moderate, past 4 major. Judgement, not measurement — they exist so an
expensive habit sorts above a frequent one.

### Grades

Each hand in the list carries a letter, from the decisions in that hand and
nothing else. Matching the coach scores full marks. Departing from it scores at
most a half **even when nothing measurable was given up**, because a mistake
nobody can price is still a mistake and scoring it full marks would make three
of the most common leaks invisible to every grade in the app. A priced mistake
scores down from there, bottoming out at 6 bb so one catastrophe cannot drag a
whole session below failing.

A hand with no decisions in it gets a dash, not an A. An average over an empty
list is a perfect score, which would make folding every hand the best-graded
way to play.

A single letter on a single hand says very little, and the panel says so — it
is there to find the hand worth replaying.

### Are you improving?

Your last 100 hands against the 100 before them, **on decision quality rather
than on money**. A hundred hands of results is so noisy that the confidence
band swamps any change a person could actually make in that time, so "up 8
bb/100 this week" would be a coin flip presented as progress. Accuracy and
expected value given up settle far sooner, which is the same reason the rating
is built on them.

It does not appear at all until there are two full windows, and it says when
the windows hold too few decisions for the difference to mean anything rather
than reporting a direction it cannot support.

### Bet sizing

Raising to the minimum when the coach wanted three times the pot used to score
as a perfect match: the review only ever compared the *kind* of action, so the
most recognisable thing about how somebody bets was the one thing that went
unmarked.

It is now its own leak. Two deliberate choices about it. The decision still
counts as **agreed**, because the action was right and only the size was not.
And it carries no cost, because what a different size would have won depends on
what the opponents would have done with it. The tolerance is wide — under half
or over double — since the coach's sizing is a heuristic rather than a solved
number, and flagging every deviation would claim an accuracy it does not have.

### Rating: how well you do it

Here is the thing that makes a poker rating hard, and it is worth being blunt
about.

**You cannot rate a poker player on results at home-game sample sizes.** Chess
Elo works because chess is nearly deterministic — a win is real evidence. Poker
results are so noisy that pinning a win rate down to within a few big blinds per
hundred takes tens of thousands of hands. The app shows you exactly this: your
win rate is displayed with its real 95% confidence band, and after a few hundred
hands that band comfortably covers both a good winner and a bad loser. It also
tells you how many more hands it would take to narrow it to ±5 bb/100, which is
usually a sobering number.

So the rating is not built on results. It is built on **decision quality** —
how much expected value your decisions gave up against the line the coach would
take. This is the same reason a chess engine rates a player by accuracy rather
than by their win/loss record: it says far more, far sooner. A few hundred hands
of decisions is a usable sample; a few hundred hands of *results* is nothing.

The scale was **calibrated by measurement, not chosen**. Each bot skill level was
played against a fixed field with every one of its decisions scored by the coach,
and those same profiles were separately measured head to head for their actual
win rate. Putting the two together anchors the scale:

> **These figures are stale and are being re-derived.** Fixing the range
> sampler changed the coach's equity estimates, which changes decision scoring,
> which moves every number in the table below. They are left here rather than
> deleted because the *method* still stands and the shape is unlikely to
> change — but do not quote the numbers until `npm run calibrate` has been re-run
> and this note is gone. The skill 5 vs skill 3 row in particular is under
> active measurement; see #4.

| Profile | EV index | Agreed with coach | Rating |
| --- | --- | --- | --- |
| Skill 1 | 214.8 | 52% | 1049 — Paying for lessons |
| Skill 2 | 68.3 | 73% | 1357 — Coming along |
| Skill 3 | 26.5 | 78% | 1444 — Solid |
| Skill 4 | 30.6 | 75% | 1436 — Solid |
| Skill 5 | 9.3 | 75% | 1481 — Playing the line |

1500 is playing the coach's line exactly. The gap between a beginner and a solid
player lands near 400 points, the spread chess uses for a gap that size.

The number carries a **real confidence interval**, derived from the spread of
your own per-decision results, and is marked provisional below 150 scored
decisions. A rating built on thirty hands announces how little it knows rather
than pretending otherwise.

**One caveat, stated in the app as well as here:** the EV index prices every
decision on its own, as though the hand ended there, so it runs about six times
larger than the money that actually changes hands — the gap between skill 1 and
skill 3 is 188 index points but only 33 bb/100 of real win rate. It is a
comparative index for measuring yourself against yourself over time, not a
dollar figure.

To re-derive the calibration after changing the bots or the coach:

```bash
npm run calibrate     # around ten minutes
```

## Explanations (optional)

Everything above is computed on the device and needs no network, no key and no
account. On top of that, if you point the app at a narrator endpoint, two things
become available: **Explain this spot** under the coach's verdict, with follow-up
questions; and **Review my game** in My Game, which reads across your tendencies,
leak counts, per-street breakdown and worst individual hands and says what they
have in common.

### The rule this is built on

**The engine computes, the model narrates.** Equity, outs, pot odds and expected
value are exact computations the app already does — on the flop and turn it
enumerates every runout. Handing that arithmetic to a language model would be
slower, cost money per call, and be *less* accurate.

So the boundary is a **brief**: a structure of facts the engine computed, already
formatted as strings. The narrator receives numbers and returns prose, never the
other way round, and it is told in plain terms not to recompute anything or
invent a figure that is not in front of it. If a fact is not in the brief, the
narrator does not know it.

### Two ways to connect

**An API key, in Settings → Your Profile.** Pick a service, paste a key and it
works immediately, with no server to run. The app calls the service directly
from the browser.

Be clear-eyed about what that means: a key held in a browser is readable by
anything with access to the page — a browser extension, anyone using the device,
any script that ever gets injected. That is fine for your own install. It is not
something to put on a phone you hand round the table. The key is stored on its
own, never inside the settings blob, so it cannot ride along in a Record Book
export or a settings backup.

**A proxy, for anything shared.** The key stays on the server and nothing secret
lives in the browser. When both are configured the proxy wins, because
preferring the browser key would quietly undo the only reason to run one.

The provider, and whatever SDK it needs, is loaded on demand — so leaving
explanations off, or using a provider that needs no SDK, costs nothing in the
bundle.

### Which services work

| Service | Browser key | Proxy | How |
| --- | --- | --- | --- |
| Anthropic (Claude) | yes | yes | Pick Anthropic; leave the model empty for the default |
| OpenAI | yes | yes | Pick OpenAI-compatible; leave the address empty |
| Azure OpenAI | possible, not advised | yes | Paste the full deployment URL, tick the `api-key` header |
| Groq, Together, OpenRouter | yes | yes | Pick OpenAI-compatible; set the address |
| A model on your own machine | yes | yes | Point the address at it — llama.cpp, Ollama, LM Studio and vLLM all serve this format |
| AWS Bedrock | **no** | needs an adapter | Requests are SigV4-signed; see below |
| Google Vertex AI | **no** | needs an adapter | Authenticates with Google credentials; see below |

Everything after the first row goes through one adapter, because OpenAI, Azure,
Groq, Together, OpenRouter and every local server take the same request shape
and differ only in address, auth header and model name. It is written against
the REST format with plain `fetch` rather than an SDK: no extra dependency,
nothing added to the bundle, and the wire format is the one thing they all
genuinely agree on.

**Bedrock and Vertex are the real exceptions, and not out of laziness.** Neither
authenticates with a bearer key. Bedrock signs every request with AWS SigV4,
which needs your AWS secret access key present to compute the signature — a
browser holding that is far worse than a browser holding a model key, because
the same credential reaches the rest of the account. Vertex wants a Google OAuth
token from application-default credentials, which a browser has no way to
obtain. Both belong behind the proxy, where the credential stays on the server
and the SDK can do its own signing. `src/engine/providers/` is where such an
adapter would go — the interface it has to satisfy is two methods.

Model names change often, and the ones in the UI are hints rather than a
verified list. Check the service's own current documentation before assuming a
name is right.

### Adding a provider

The seam is `src/engine/providers/`. A provider is one file exporting a factory
that returns `{ explain, review }`, plus one entry in `PROVIDERS` so it appears
in the picker. Nothing above that directory — not the app, not the briefs, not
the wire contract — knows which model answered.

```
src/engine/providers/
  types.ts             the Provider interface and the shared error mapping
  anthropic.ts         Claude, via the official SDK
  openaiCompatible.ts  anything speaking the OpenAI chat format
  index.ts             the catalogue and the factory
```

Both the browser and the proxy use the same adapters, so a provider added once
works on both paths.

### Running the proxy

```bash
cp .env.example .env.local           # set VITE_COACH_ENDPOINT
ANTHROPIC_API_KEY=sk-ant-... npm run coach   # proxy on :8787
npm run dev
```

`api/coach.ts` is a standard Web `Request` → `Response` handler, which is what
Vercel Edge, Netlify, Cloudflare Workers and Deno Deploy all speak.
`server/dev-proxy.mjs` wraps that same handler for local use, so there is only
one code path to keep correct. The endpoint can also be pasted into
Settings → Coach narrator instead of being baked in at build time.

Which model the proxy uses is environment, not code:

| Variable | Meaning |
| --- | --- |
| `COACH_PROVIDER` | `anthropic` (default) or `openai` |
| `COACH_MODEL` | Model name, or the Azure deployment name. Optional on Anthropic |
| `ANTHROPIC_API_KEY` | Read by the Anthropic SDK itself |
| `COACH_API_KEY` | The key for any other provider (`OPENAI_API_KEY` also works) |
| `COACH_BASE_URL` | The service address, when it is not OpenAI |
| `COACH_AUTH` | `api-key` for Azure; anything else means a bearer token |

On Anthropic it defaults to `claude-opus-5`, with `fallbacks: "default"` enabled
so a request the safety classifiers decline is re-run on Anthropic's recommended
substitute server-side rather than surfacing a refusal mid-hand, and the leak
review uses structured outputs so the findings can be rendered rather than
parsed out of prose. The OpenAI-compatible path asks for JSON and then verifies
it, because schema enforcement varies across the services behind that one
format; if a service ignores the request and answers in prose, the prose becomes
the summary rather than an error.

**Caveat, and it matters:** no request has been made against any real provider —
there were no credentials in the build environment. What *is* exercised is
everything up to the wire: with a key set the Anthropic SDK builds and sends a
real request (verified against an intercepted `api.anthropic.com`, key header
and all), and the OpenAI-compatible path is tested against a stub that checks
the URL, the auth header and the request body it produces. What remains unproven
is whether each service accepts the specific parameters — the model id, the
fallback beta, the JSON response format — so treat the first real call against
any provider as the test.

## The session in progress

A night you are in the middle of is written down between hands, so closing the
tab — or iOS reclaiming it, which it does routinely when you switch apps —
does not reset your stack and buy-in count. Reopening puts you back where you
were.

A hand in progress is deliberately **not** kept. Restoring one would mean
rebuilding the shoe, the betting round and whose turn it is from a serialised
form: much more machinery, and many more ways to be subtly wrong, than dropping
a single deal is worth. The stacks come back as they stood before that hand was
dealt, so the only thing lost is the hand itself.

The bomb-pot clock re-anchors on reopening. A time-triggered bomb pot measures
from the last one, and being closed for six hours is not six hours of play.

Cashing out settles the night into the Record Book and starts a fresh session —
otherwise dealing on from the same stacks would let a second cash-out record the
same money twice.

Coach mode is saved too, under its own key and stamped with its own mode.
Losing a coach session to a reclaimed tab is as annoying as losing a real one,
and it is still not a night: it never reaches the Record Book, and a restore
checks the mode on the snapshot rather than trusting which key it was filed
under, so the two cannot be crossed even if the storage were tampered with. A
snapshot written before coach mode was saved carries no mode at all; those were
all real tables, which is what an absent one is taken to mean.

Because it now persists, coach mode has a **Fresh table** button — otherwise
there would be no way back to a full stack.

## Misclicks

Folding aces because a thumb landed low is unrecoverable and, unlike a bad
call, teaches you nothing.

Three things guard against it, and the rule shaping all of them is that a
confirmation has to stay rare enough to mean something — one that fires on
every fold is one you learn to tap through.

- **The action bar ignores taps for 350 ms after it appears.** Most mis-taps
  are not mis-aimed; they are aimed at what was on screen a moment ago and land
  as the buttons arrive. Swallowing the first fraction of a second removes the
  whole class and costs nothing.
- **A second tap is asked for** only when the action cannot be taken back:
  folding a hand worth Chen 9 or better pre-flop, folding two pair or better
  after the flop, or putting the whole stack in. The confirmation replaces the
  buttons rather than covering them, so the second tap cannot land where the
  first did.
- **Keyboard shortcuts** at a desk: `F` fold, `C` check or call, `R` or `B`
  open the raise, `Enter` commit, `Escape` cancel. They are disabled while a
  confirmation is up — the point of that sheet is a deliberate second input.

Turn the confirmations off in Settings if you find them patronising; the
350 ms settle stays either way.

There is deliberately *no* guard for folding when checking is free: the engine
sets `canFold` and `canCheck` from the same condition, so that has never been
possible.

## Where the data lives

History lives in **IndexedDB**, one record per hand, and nothing is thrown away.

It used to live in `localStorage`, which holds about 5 MB — so the tracker
capped itself at 600 hands and dropped replays after 150. Measured, a summary
row is 0.33 KB and a replay 3.3 KB, which makes a year of play about 10.6 MB:
twenty times what fits. The ninth night of a season silently evicted the first,
which is exactly the comparison that tells you whether you are improving.

One record per hand rather than one blob, because a blob would mean rewriting
every megabyte of the history after every hand. Only the most recent 600 are
held in memory for the list and the leak review; the rest stay on disk until an
export asks for them.

The old `localStorage` log is migrated on first run and then left alone — not
deleted, so a failed migration is recoverable and an older build still opens.
Where IndexedDB cannot be opened at all (private browsing, a locked-down
profile) everything falls back to the previous behaviour, caps included.

Nothing is written until the history has been read back. Finishing a hand in
the first moments after load would otherwise save an empty log over a real one,
turning a slow read into permanent data loss.

**Book → "Where does my history live?"** explains all of this to whoever is
handed the app, with home-screen instructions per platform. Adding it to the
home screen is not cosmetic on iOS: it is what keeps the browser from clearing
a history that has not been opened in a week, and a poker night is weekly.

### Still not a backup

IndexedDB is evictable like everything else in a browser, and none of it
survives losing the device. **Book → Backup JSON** is the real safeguard.



The Record Book, the roster and your own tracked hands are stored in this
browser's `localStorage`. They survive reloads but never leave the device and
are not synced anywhere. Your running totals are kept forever; the individual
hand list is capped at the most recent 600, since the totals already carry the
numbers. Use **Backup JSON** to
keep a copy or move the book to another device, and **Import JSON** to merge it
back — nights are matched by id, so re-importing an edited night updates it
rather than duplicating it. CSV exports are there for spreadsheets.

## Poker, and the house rules on top

The house rules are genuinely strange. Bomb pots deal the flop before anyone
acts, straddles move who speaks last, and the Dexter pays a bounty for winning
with the worst hand in poker. Left woven through the engine, the rules of poker
could not be read, tested or reused without them — and one bug had already come
from exactly that, drill mode dealing practice spots into bomb pots because the
monotone-flop trigger fired inside the core street logic.

So they are two layers now:

```
engine/
  core/          the rules of poker
    state.ts       who is in the hand, and how chips reach the middle
    betting.ts     a betting round: who acts, what they may do, what it costs
    streets.ts     burn, deal, decide whether anyone may bet
    pots.ts        side pots by commitment level, odd chips left of the button
    showdown.ts    best five cards take each pot they were eligible for
  rules/         what BNOTW does on top
    straddle.ts    a blind raise that buys the last word
    bombPot.ts     everybody antes; and the flop that arms the next one
    dexter.ts      the 7-2 bounty
  hand.ts        wires the two together
```

**Nothing in `core/` imports anything from `rules/`.** That direction is
checked by a test rather than trusted, because it is the kind of thing that
erodes one convenient import at a time — and the test is verified to fail when
the rule is broken, not merely to pass when it is kept. It also catches the
quieter version: `core/` reading `state.pendingDexter` directly does the same
damage as importing it.

The seams are deliberate and small:

- **A named bet** — "Bob-aloo ($1.75)" — is a joke this table shares, not a
  rule of poker, so `applyAction` takes the formatter rather than importing it.
- **A monotone flop** arming the next bomb pot happens *after* the street is
  dealt, in `hand.ts`, never during. Dealing a board is poker; what this table
  makes of three hearts is not.
- **The Dexter** is looked for only once the pots are awarded, which makes it
  impossible for a house rule to change who actually won.

### Still free functions over plain data

The obvious refactor here is a class hierarchy — `Hand` owning a `Deck`, a
`BettingRound`, a `PotManager`. It would read more tidily and it would quietly
break two things: `HandState` crosses a `structuredClone` boundary to reach the
coach worker, and class instances do not survive that. A test walks a real
in-progress hand asserting no functions and no class instances anywhere in it,
because the alternative is finding out at runtime, in a browser, in a worker.

## Where the data lives, key by key

`state/keys.ts` lists every stored key, what it holds and whose it is. It
exists because deleting a player had a hand-typed list of keys in it: add a
per-player key, forget that list, and removing somebody leaves their records
for whoever reuses the id — a bug with no error, no failing test and no symptom
until someone else's hands appear in a new player's history. The list is
derived from the registry now, and a test scans the source for `bnotw.*` key
literals and fails if any is unregistered.

The split is not "personal versus shared" but **whose record is it a record
of**. Your hands, practice, rating and the table you were sitting at are
yours. The Record Book, the roster, the hand names and the coaches are the
crew's — scoping those per player would mean Dave opening the app and finding
nobody owes anybody anything.

A table in progress counts as the player's, which was a live bug until this
work: handing the iPad over used to sit the next person behind your chips, and
cashing out would then have recorded your night under their name.

## Layout

```
src/
  engine/          no UI, no React — the whole game is testable in isolation
    cards.ts       deck, seedable PRNG, shoe
    handEval.ts    best five of any card set
    bnotw.ts       house-rule constants and money helpers
    types.ts       game state types
    hand.ts        one hand: posting, dealing, betting, side pots, showdown
    replay.ts      flattening a finished hand and stepping back through it
    table.ts       the session: stacks, button, bomb-pot scheduling, Dexter ladder,
                   and freezing all of it so a closed tab does not lose it
    ai.ts          computer opponents
    persona.ts     who is in the seat: faces, skill, tendencies
    coach.ts       equity, outs, pot odds and the recommendation
    drill.ts       generating one decision at a time, aimed at your weak street
    misclick.ts    which taps to ask twice about
    brief.ts       the facts a narrator is allowed to talk about
    narration.ts   the wire contract between app and proxy
    narrator.ts    the browser side of it
    providers/     one file per model service, behind a two-method interface
    playerStats.ts your tendencies, your rating and the honest error bars
  state/           the Record Book: settlement maths, storage, exports
    db.ts          the hand history, in IndexedDB
  ui/              React components
api/               the narrator proxy — the only server-side code
server/            a local wrapper so the proxy can be run in development
scripts/           build-sw.mjs, which writes the service worker after a build
public/            icons and the web app manifest
```

## Testing

Every push and pull request runs typecheck, the suite and a production build
(`.github/workflows/ci.yml`). The long skill measurement runs as its own job so
that minutes of CPU cannot hide a fast failure behind them.

627 tests, all in `npm test`:

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
- Deleting a hand is tested as a property rather than by example: the totals
  after a removal must equal the totals a history that never contained the hand
  would have had — checked at every position in a 60-hand history, and for
  batches removed in either order.
- Styles that leak are tested by loading the real stylesheet into jsdom and
  asserting the computed values. jsdom does no layout, so a component test can
  render a perfectly correct tree that paints as nonsense — which is exactly
  what shipped in the new-player form, where a choice row that is itself a
  `<label>` inherited `.field label`'s tiny uppercase caption styling and
  `.field input`'s full-width box. What jsdom *does* resolve is the cascade,
  and the bug was a cascade bug. Narrow by design: it cannot check that
  anything looks right, only that the specific rules which leaked are not
  leaking. Layout needs a browser, which is issue #36.
- The React layer is tested with real engine objects rather than mocks
  (`ui/testTable.tsx` builds an actual `Table` behind the game API). That layer
  had one test file and every reported bug; it now has eight. The tests there
  are mostly about the guardrails — that the action bar takes no tap it was not
  offered, that nothing destructive is ever one press away, and that "had you
  stayed" always prints the probability above the outcome.
- The layer-to-leak mapping is tested by *driving* `reviewDecision` through
  every combination it accepts and collecting the leaks it can actually
  produce, rather than by comparing against a list typed out by hand. A renamed
  leak would otherwise leave a layer that silently never settles, which is the
  kind of bug nothing complains about.
- The what-if refuses more often than it answers, and each refusal has its own
  test: a hand that ended pre-flop, one that stopped on the flop, one where
  everybody folded. Writing it the other way round — asserting the answers and
  trusting the guards — is how a feature ends up inventing a runout.

---

**Win big. Pay the house. Write the recap.**

## Where the work is tracked

Future development is tracked as [GitHub issues](https://github.com/AlpheCIT/BNOTW/issues), grouped into three phases:

- **Phase A — the improvement app.** ~~Hand replay~~ and ~~coach explanations~~
  (done), drill mode, bots that adapt, a better range model, misclick protection.
- **Phase B — foundation.** CI, UI tests, accessibility, and getting the thing
  deployed and installable.
- **Phase C — deferred.** Live-night mode, the auto-drafted recap, the table
  recorder, native packaging.

Two issues carry constraints worth reading before starting them: the recorder
(consent and biometric-privacy considerations) and live-night mode (why
per-player tendency stats are not achievable at a real table).
