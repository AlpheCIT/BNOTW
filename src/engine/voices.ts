/**
 * Coaches who disagree with each other.
 *
 * One voice delivering one verdict teaches you what to do. Two voices arguing
 * over the same spot teaches you *why*, because the disagreement is where the
 * thinking is — and good players genuinely disagree about marginal hands far
 * more than a single confident recommendation suggests.
 *
 * ### What the defaults are
 *
 * Between them the five cover the four corners of how people actually play,
 * plus a neutral reading:
 *
 *   entry ↓   aggression →    low                     high
 *   loose                     reader (small bets)     gambler (any two cards)
 *   selective                                         pressure
 *   tight                     rock
 *
 * That spread is the point. Two voices agreeing tells you nothing; a loose
 * small-ball read and an old-school raise-or-fold read disagreeing on the same
 * hand is where the thinking is. These are also the numbers "Start Fresh" puts
 * back, so editing a coach is a safe thing to try.
 *
 * ### About the names
 *
 * These are invented characters, not portraits. A playing style is not
 * ownable — "tight, patient, heavy on position" is a description of poker and
 * nobody has a claim on it — but a living player's name and likeness are, and
 * a thin alias that maps one-to-one onto a real person is that person's name
 * wearing a hat. So the styles here are real and the people are not, and every
 * name can be changed to whatever your table wants to call them.
 *
 * The styles are drawn from schools of thought rather than from anyone's
 * results: the small-ball, read-the-player approach; the selective-aggressive
 * one; the patient positional one; and the old-school argument — the one
 * Super/System put in print in 1979 — that position and aggression win more
 * pots than cards do. None of these numbers is a claim about how any
 * particular person plays, and none of them was measured from anyone's hands.
 */

export interface CoachVoice {
  id: string
  /** The default. Renameable, like the hand names. */
  name: string
  /** One line on how they see poker. */
  blurb: string
  /**
   * Shifts the Chen score needed to keep playing before the flop. Negative
   * plays more hands; positive folds more.
   */
  entryShift: number
  /** 0..1 — how readily this voice turns a call into a raise. */
  aggression: number
  /** Preferred bet as a fraction of the pot. */
  sizing: number
  /** The line they add to the reasoning, in their own words. */
  says: {
    loose: string
    tight: string
    aggressive: string
    passive: string
  }
}

export const VOICES: CoachVoice[] = [
  {
    id: 'house',
    name: 'The House',
    blurb: 'The straight read. No angle, no personality, just the numbers.',
    entryShift: 0,
    aggression: 0.5,
    sizing: 0.6,
    says: {
      loose: 'Priced in, and worth continuing with.',
      tight: 'Not enough hand for what it costs.',
      aggressive: 'This is a betting hand, not a calling one.',
      passive: 'Nothing to be gained by building the pot here.',
    },
  },
  {
    id: 'reader',
    name: 'Dominic North',
    blurb:
      'Talks the whole way through the hand and plays far more of them than he '
      + 'should, because he is reading you rather than his cards. Small bets, '
      + 'lots of them, and he is never really folding.',
    entryShift: -2.5,
    aggression: 0.45,
    sizing: 0.4,
    says: {
      loose: 'Plenty playable. Get in cheap and find out who they are afterwards.',
      tight: 'Even I would not get involved from here.',
      aggressive: 'Small bet. Enough to ask the question, cheap enough to be wrong.',
      passive: 'Take the free card and watch what they do with it.',
    },
  },
  {
    id: 'pressure',
    name: 'Philippa Ingram',
    blurb:
      'Ice cold. Applies pressure until somebody flinches, and is happy to be '
      + 'called down because she has the hand often enough to make you pay for '
      + 'finding out.',
    entryShift: -0.5,
    aggression: 0.85,
    sizing: 0.85,
    says: {
      loose: 'Playable, and more playable if you are the one doing the betting.',
      tight: 'Fold it. There will be a better spot to put someone to a decision.',
      aggressive: 'Bet big. Make the call expensive enough to mean something.',
      passive: 'Check, but only because the next street is worth more.',
    },
  },
  {
    id: 'rock',
    name: 'Walter Boyd',
    blurb:
      'Old school. Position, patience, and the strong conviction that most of '
      + 'the money at a home game is lost by people playing hands they should '
      + 'have thrown away.',
    entryShift: 2.5,
    aggression: 0.55,
    sizing: 0.7,
    says: {
      loose: 'Good enough. That is a real hand and there is no shame in playing it.',
      tight: 'Throw it away. Nobody ever went broke folding.',
      aggressive: 'If it is worth playing it is worth betting. Do not creep.',
      passive: 'No need to bloat this. Let them bet into you.',
    },
  },
  {
    id: 'gambler',
    name: 'Sonny Bracken',
    blurb:
      'Old school in the other direction. Believes the hand you are dealt '
      + 'matters far less than position, aggression and who you are playing '
      + 'against — and that a raise wins pots two pair never gets to see.',
    entryShift: -3.5,
    aggression: 0.8,
    sizing: 0.75,
    says: {
      loose: 'Any two cards play if you are the one raising. Come in for a raise or not at all.',
      tight: 'Even I am out of line here. Wait for position and try it again.',
      aggressive: 'Raise. Folding equity is the only equity you get to keep.',
      passive: 'Check it back and take a swing at whatever they leave you next street.',
    },
  },
]

export function voice(id: string): CoachVoice {
  return VOICES.find((v) => v.id === id) ?? VOICES[0]
}

/** Names this table has given the coaches, keyed by voice id. */
export type CustomVoiceNames = Record<string, string>

export function voiceName(v: CoachVoice, custom: CustomVoiceNames = {}): string {
  return custom[v.id]?.trim() || v.name
}
