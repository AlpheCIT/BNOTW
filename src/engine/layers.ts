/**
 * A learning path, rather than every number at once.
 *
 * Coach mode used to show everything it knew, every hand, at equal weight:
 * equity, Chen, break-even, EV, outs by group and a verdict. For someone
 * learning that is not a lesson, it is a dashboard — and it is the direct
 * cause of the Chen complaint, because a number that is not *wrong* can still
 * be a problem when it sits in a tile the same size as things that matter far
 * more right now.
 *
 * So the panels are layers to be turned on, not levels to be beaten. Each one
 * adds rather than replaces, they can be switched on in any order, and anyone
 * who wants the whole dashboard from day one just turns them all on.
 *
 * ### How "ready for the next one" is decided
 *
 * Each layer owns the mistakes it is about, and the tracker already counts
 * them by name. Calling a price you should have passed on is a price mistake;
 * playing a hand that was priced fine but plays badly is a hand mistake;
 * missing value on the river is a line mistake. When a layer's own mistakes
 * have gone quiet over a decent sample, the next layer is offered.
 *
 * **The thresholds below are judgement, not measurement.** Nothing was fitted
 * to data — 60 decisions and 8% are a reasonable-looking sample and a
 * reasonable-looking error rate, chosen because they had to be something.
 * They decide when a suggestion appears, never what the coach recommends, so
 * being wrong about them costs a prompt at the wrong moment and nothing else.
 *
 * One layer cannot be measured at all, and says so rather than inventing a
 * gate: see `measurable` below.
 */

import type { PlayerTotals } from './playerStats'

export type LayerId = 'price' | 'hand' | 'player' | 'frequency' | 'table'

export interface Layer {
  id: LayerId
  name: string
  /** The one question this layer is about. */
  question: string
  /** What turning it on puts on screen. */
  shows: string
  /**
   * Whether the record can tell you when you have got the hang of it.
   *
   * False for the table layer, and that is not an oversight. Reading a room
   * happens between the hands, in the part of poker this app cannot see.
   */
  measurable: boolean
}

export const LAYERS: Layer[] = [
  {
    id: 'price',
    name: 'The price',
    question: 'Is this call worth what it costs?',
    shows: 'The pot, what it costs to call, and the share of the time you need to win to break even.',
    measurable: true,
  },
  {
    id: 'hand',
    name: 'The hand',
    question: 'Do I actually have the hand for it?',
    shows: 'Your equity, what you have made, the cards that improve you, and the Chen score before the flop.',
    measurable: true,
  },
  {
    id: 'player',
    name: 'The player',
    question: 'Who am I up against, and what do they have?',
    shows: 'Position, the range each opponent is being credited with, and how they have actually been playing.',
    measurable: true,
  },
  {
    id: 'frequency',
    name: 'The frequency',
    question: 'What does this bet ask of my whole range, not just this hand?',
    shows:
      'How often a bluff needs you to fold to break even, the share of your range that has to '
      + 'continue to take that away, and — when you are the one betting — how many bluffs the '
      + 'size you have chosen can carry.',
    /*
     * Fourth rather than second, which is a change of mind worth recording.
     *
     * It reads like an extension of the price — the price is this hand, this
     * is the whole range — and that was the plan. But the floor is only worth
     * respecting against somebody who bluffs, and knowing that is the player
     * layer's job. Offered before it, the honest half of the lesson has
     * nothing to stand on and it becomes a number to obey.
     */
    measurable: false,
  },
  {
    id: 'table',
    name: 'The table',
    question: 'What is different about this game?',
    shows: 'How the house rules change the maths — bomb pots, straddles, the Dexter — and where a home game plays nothing like a cardroom.',
    measurable: false,
  },
]

export function layer(id: LayerId): Layer {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0]
}

/**
 * The mistakes each layer is about, named exactly as the coach records them.
 *
 * Kept as strings matching `reviewDecision`'s leaks rather than as a shared
 * enum, because the leak names are player-facing prose and are meant to be
 * reworded freely. A rename that misses this list shows up as a layer that
 * never settles, which `LAYER_LEAKS` is tested against.
 */
export const LAYER_LEAKS: Record<LayerId, string[]> = {
  price: ['Called too light', 'Folded a good price'],
  hand: ['Loose call', 'Folded a playable hand'],
  player: ['Missed value', 'Too aggressive', 'Off the line', 'Bet sizing'],
  /*
   * None of its own, and not an oversight.
   *
   * Overfolding is the mistake this layer is about, and it is a property of a
   * range over many similar spots rather than of any one decision — the record
   * would have to know which hands you folded that you *could* have continued
   * with, across spots it judged comparable. It does not, and a leak invented
   * to fill the gap would gate the next layer on a number that means nothing.
   * 'Folded a good price' stays with the price layer, where it is earned one
   * decision at a time.
   */
  frequency: [],
  table: [],
}

/** Decisions needed before a rate means anything. Judgement, not measurement. */
export const SETTLED_AFTER = 60

/** Slip rate a layer has to be under to count as settled. Also judgement. */
export const SETTLED_UNDER = 0.08

/** What a new player starts with: one question, asked properly. */
export const STARTING_LAYERS: LayerId[] = ['price']

/** Everything, which is what the app did before layers existed. */
export function allLayers(): LayerId[] {
  return LAYERS.map((l) => l.id)
}

export interface LayerProgress {
  id: LayerId
  /** Decisions recorded since the record began. Not per layer — see below. */
  decisions: number
  /** Slips belonging to this layer. */
  slips: number
  /** Slips per decision, or null when there is not enough to say. */
  rate: number | null
  /** Enough evidence, and few enough slips, to move on. */
  settled: boolean
  measurable: boolean
}

/**
 * How the record looks for one layer.
 *
 * The denominator is every decision rather than only the ones where this
 * layer's mistake was available to make, and that is a real approximation: it
 * flatters a layer whose mistakes only arise in rare spots. It is used only to
 * time a suggestion, and the alternative — counting which decisions could have
 * produced each leak — would mean the coach recording a judgement about every
 * mistake you did *not* make.
 */
export function layerProgress(totals: PlayerTotals, id: LayerId): LayerProgress {
  const meta = layer(id)
  const slips = LAYER_LEAKS[id].reduce((sum, leak) => sum + (totals.leaks[leak] ?? 0), 0)
  const enough = totals.decisions >= SETTLED_AFTER
  const rate = enough ? slips / totals.decisions : null
  return {
    id,
    decisions: totals.decisions,
    slips,
    rate,
    settled: meta.measurable && enough && rate !== null && rate < SETTLED_UNDER,
    measurable: meta.measurable,
  }
}

export interface LayerSuggestion {
  layer: Layer
  /** The evidence, in the words the player will read. */
  because: string
}

/**
 * The next layer worth offering, if the record says one is due.
 *
 * Only ever suggests the first layer that is off, and only once everything
 * before it has settled — a suggestion to think about opponents while you are
 * still misreading prices is the dashboard problem again, one prompt at a
 * time. Returns null whenever there is nothing honest to say, which is most
 * of the time.
 */
export function suggestLayer(
  totals: PlayerTotals,
  active: readonly LayerId[],
): LayerSuggestion | null {
  const on = new Set(active)
  for (const meta of LAYERS) {
    if (on.has(meta.id)) continue

    // Everything before this one has to be on and settled first.
    const earlier = LAYERS.slice(0, LAYERS.indexOf(meta))
    if (!earlier.every((e) => on.has(e.id))) return null
    const unsettled = earlier.find((e) => e.measurable && !layerProgress(totals, e.id).settled)
    if (unsettled) return null

    if (earlier.length === 0) {
      // Nothing to have learned yet, so nothing to have earned.
      return null
    }

    const last = earlier[earlier.length - 1]
    const progress = layerProgress(totals, last.id)
    const because = progress.measurable
      ? `${last.name} looks settled — ${progress.slips} slip${progress.slips === 1 ? '' : 's'} `
        + `in ${progress.decisions} decisions. ${meta.question}`
      : `${meta.question}`
    return { layer: meta, because }
  }
  return null
}

// ---------------------------------------------------------------------------
// The table layer's content
// ---------------------------------------------------------------------------

export interface TableNote {
  label: string
  text: string
}

/**
 * What the house rules are doing to the hand in front of you.
 *
 * This is the part of the table layer that can actually be said with
 * confidence, because it follows from the rules rather than from reading
 * anybody. A bomb pot really does mean nobody chose their cards; a straddle
 * really does change the price. Those are facts about BNOTW, and a player
 * coming from an app that deals a plain cardroom game has no reason to know
 * them.
 *
 * What is *not* here is tells, timing and physical reads — the things the
 * issue that asked for this layer put at the top of the list. They are left
 * out on purpose: this app deals cards on a screen and cannot show you someone
 * shaking as they push chips in, so anything it said about tells would be
 * repeating received wisdom it has no way to check. The layer says so rather
 * than filling the gap.
 */
export function tableNotes(hand: {
  isBombPot: boolean
  bombGame: string | null
  straddles: { amount: number }[]
  board: unknown[]
  dexter: unknown
} | null): TableNote[] {
  if (!hand) return []
  const notes: TableNote[] = []

  if (hand.isBombPot) {
    notes.push({
      label: 'Bomb pot.',
      text: 'Everyone antes and there is no pre-flop betting, so nobody chose '
        + 'to be here. Ranges tell you nothing this hand — every player holds '
        + 'any two cards, which makes the board far more important than usual '
        + 'and made hands far less trustworthy.',
    })
  }
  if (hand.bombGame === 'crazyPineapple') {
    notes.push({
      label: 'Crazy Pineapple.',
      text: 'Three cards each, one pitched after the flop, so everyone kept '
        + 'the two that fit best. Expect stronger hands than a normal board '
        + 'would produce, and be slower to trust top pair.',
    })
  }
  if (hand.straddles.length > 0) {
    notes.push({
      label: 'Straddled.',
      text: 'The forced bet is bigger, so the pot is bigger before anyone has '
        + 'looked at a card and everybody is playing for more with the same '
        + 'hands. The straddle also acts last before the flop, which is the '
        + 'part that is easy to forget.',
    })
  }
  if (hand.dexter) {
    notes.push({
      label: 'Dexter.',
      text: 'A 7-2 win pays a bounty from everyone, which is why someone just '
        + 'played a hand nobody would otherwise play. Worth remembering when a '
        + 'line makes no sense.',
    })
  }

  notes.push({
    label: 'Home game.',
    text: 'The stakes are small and the players are people you know, so pots '
      + 'get checked down that a cardroom would bet, and calls get made for '
      + 'reasons that have nothing to do with the cards. Tells and timing '
      + 'matter here more than anywhere — and they are the one thing this app '
      + 'cannot teach you, because it has nobody to show you.',
  })

  return notes
}
