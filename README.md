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

## Where the data lives

The Record Book, the roster and your own tracked hands are stored in this
browser's `localStorage`. They survive reloads but never leave the device and
are not synced anywhere. Your running totals are kept forever; the individual
hand list is capped at the most recent 600, since the totals already carry the
numbers. Use **Backup JSON** to
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
    replay.ts      flattening a finished hand and stepping back through it
    table.ts       the session: stacks, button, bomb-pot scheduling, Dexter ladder
    ai.ts          computer opponents
    persona.ts     who is in the seat: faces, skill, tendencies
    coach.ts       equity, outs, pot odds and the recommendation
    brief.ts       the facts a narrator is allowed to talk about
    narration.ts   the wire contract between app and proxy
    narrator.ts    the browser side of it
    providers/     one file per model service, behind a two-method interface
    playerStats.ts your tendencies, your rating and the honest error bars
  state/           the Record Book: settlement maths, storage, exports
  ui/              React components
api/               the narrator proxy — the only server-side code
server/            a local wrapper so the proxy can be run in development
scripts/           build-sw.mjs, which writes the service worker after a build
public/            icons and the web app manifest
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
