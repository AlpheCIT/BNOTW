/**
 * Putting things back the way they came.
 *
 * Two different needs land here and it is worth keeping them apart.
 *
 * The first is a record that has been skewed by play that was not really
 * play — trying the app out, showing someone how it works, running a hand to
 * see what the coach says. Those hands move your VPIP and your rating exactly
 * as hard as the ones you meant, and the rating is the number this whole app
 * exists to make honest. That need is served by deleting hands, in the history
 * list, and by "My hand history" here.
 *
 * The second is a set of characters that has drifted. The personas and the
 * coaches are meant to be edited — that is the point of them — but an edit is
 * only safe to make if it can be undone. Without a way back to the shipped
 * numbers, the sensible thing to do with a persona you are curious about is
 * nothing.
 *
 * What this file is *not* is a delete button that quietly takes the Record
 * Book with it. The Record Book is the only thing in the app that is about
 * real money owed between real people, so it is never part of "everything" and
 * has to be asked for by name.
 */

import { emptyTotals } from '../engine/playerStats'
import { defaultRosterState, DEFAULT_VOICES } from './storage'

export type ResetAreaId =
  | 'hands'
  | 'drill'
  | 'coachScore'
  | 'roster'
  | 'voices'
  | 'handNames'
  | 'tables'
  | 'book'

export interface ResetArea {
  id: ResetAreaId
  label: string
  /** What goes, in the words of someone who has to decide whether to do it. */
  what: string
  /**
   * Whether "Reset everything" takes this.
   *
   * False for the two that are not really the app's own state: the Record Book
   * is other people's money, and a table in progress is only worth clearing
   * deliberately.
   */
  inEverything: boolean
}

export const RESET_AREAS: ResetArea[] = [
  {
    id: 'hands',
    label: 'My hand history',
    what: 'Every tracked hand, your tendencies and your rating. This is the one that clears test play out of your record.',
    inEverything: true,
  },
  {
    id: 'drill',
    label: 'Practice history',
    what: 'How you have scored on practice spots, street by street.',
    inEverything: true,
  },
  {
    id: 'coachScore',
    label: 'Coach scorecard',
    what: 'How often you have agreed with the coach, and what the gap cost.',
    inEverything: true,
  },
  {
    id: 'roster',
    label: 'The players',
    what: 'Everyone at the table goes back to the crew this app ships with, at the numbers they were written with. Players you added are removed.',
    inEverything: true,
  },
  {
    id: 'voices',
    label: 'The coaches',
    what: 'The coaches go back to their original names and their original way of reading a hand.',
    inEverything: true,
  },
  {
    id: 'handNames',
    label: 'Hand names',
    what: 'The nicknames go back to the shipped list. Names your table added are removed.',
    inEverything: true,
  },
  {
    id: 'tables',
    label: 'Games in progress',
    what: 'The saved table and the saved coach-mode table. Your history and stacks in the Record Book are untouched.',
    inEverything: false,
  },
  {
    id: 'book',
    label: 'The Record Book',
    what: 'Every night, every buy-in, every settle-up. This is money owed between real people and cannot be rebuilt by playing more.',
    inEverything: false,
  },
]

/** The areas "Reset everything" covers. */
export function everythingIds(): ResetAreaId[] {
  return RESET_AREAS.filter((area) => area.inEverything).map((area) => area.id)
}

/**
 * What the app has to do to honour a reset.
 *
 * The live setters rather than the storage keys, because most of this is held
 * in React state as well as on disk: clearing the key alone would leave the
 * old roster on screen until the next reload, which looks exactly like a reset
 * that silently failed.
 */
export interface ResetActions {
  hands: () => void
  drill: () => void
  coachScore: () => void
  roster: (next: ReturnType<typeof defaultRosterState>) => void
  voices: (next: typeof DEFAULT_VOICES) => void
  handNames: (next: Record<string, string>) => void
  tables: () => void
  book: () => void
}

/** Carry out a reset. Unknown ids are ignored rather than thrown over. */
export function applyReset(ids: readonly ResetAreaId[], actions: ResetActions): void {
  const wanted = new Set(ids)
  if (wanted.has('hands')) actions.hands()
  if (wanted.has('drill')) actions.drill()
  if (wanted.has('coachScore')) actions.coachScore()
  if (wanted.has('roster')) actions.roster(defaultRosterState())
  if (wanted.has('voices')) actions.voices({ ...DEFAULT_VOICES, names: {} })
  if (wanted.has('handNames')) actions.handNames({})
  if (wanted.has('tables')) actions.tables()
  if (wanted.has('book')) actions.book()
}

/** An empty record, for a caller that needs the shape rather than the action. */
export { emptyTotals }
