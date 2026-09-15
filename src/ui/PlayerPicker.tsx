/**
 * Who's playing?
 *
 * The first thing anybody sees, and deliberately the least ceremonious screen
 * in the app: names on chips, tap one, play. No password, no login, nothing
 * leaves the device. Anybody holding the iPad can pick anybody — which is the
 * correct amount of security for a home game, and any more would be something
 * to maintain forever in exchange for nothing.
 *
 * Guest is on this screen rather than buried, because the moment it exists for
 * is somebody saying "let me have a go" while you are holding the device. If
 * that is three taps deep, the hands land in your record instead.
 */

import { useState } from 'react'
import {
  EXPERIENCE, PROFILE_COLOURS, displayName, experienceMeta, initialsFor,
  makeProfile, type Experience, type LocalProfile,
} from '../state/profiles'

export function PlayerChip({
  profile, onClick, onEdit,
}: {
  profile: LocalProfile
  onClick?: () => void
  onEdit?: () => void
}) {
  return (
    <div className="playerchip-wrap">
      <button className="playerchip" onClick={onClick} type="button">
        <span className="playerchip-face" style={{ borderColor: profile.colour, color: profile.colour }}>
          {initialsFor(profile)}
        </span>
        <b>{displayName(profile)}</b>
      </button>
      {onEdit && (
        <button
          className="playerchip-edit"
          type="button"
          aria-label={`Edit ${displayName(profile)}`}
          onClick={onEdit}
        >
          Edit
        </button>
      )}
    </div>
  )
}

export function PlayerPicker({
  profiles, onPick, onGuest, onCreate, onEdit, onClose, title = "Who's playing?",
}: {
  profiles: readonly LocalProfile[]
  onPick: (profile: LocalProfile) => void
  onGuest: () => void
  onCreate: (profile: LocalProfile) => void
  onEdit?: (profile: LocalProfile) => void
  /** Absent on the first run, when there is nothing to go back to. */
  onClose?: () => void
  title?: string
}) {
  const [adding, setAdding] = useState(profiles.length === 0)

  if (adding) {
    return (
      <PlayerForm
        existing={profiles}
        onSave={(profile) => { onCreate(profile); setAdding(false) }}
        onCancel={profiles.length > 0 ? () => setAdding(false) : undefined}
      />
    )
  }

  return (
    <div className="overlay solid" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="sub">
          Everything you play is kept against whoever is picked here, on this
          device only. There is nothing to sign into.
        </p>

        <div className="playergrid">
          {profiles.map((profile) => (
            <PlayerChip
              key={profile.id}
              profile={profile}
              onClick={() => onPick(profile)}
              onEdit={onEdit ? () => onEdit(profile) : undefined}
            />
          ))}
          <button className="playerchip add" onClick={() => setAdding(true)} type="button">
            <span className="playerchip-face">+</span>
            <b>Add player</b>
          </button>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn small ghost" onClick={onGuest}>Play as guest</button>
          <span className="sub" style={{ flex: '1 1 200px' }}>
            A guest keeps nothing. Nothing they play reaches anybody's record —
            which is what makes handing the iPad over safe.
          </span>
        </div>

        {onClose && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Making a player, or editing one.
 *
 * Experience is the only field that does anything beyond the label, and what
 * it does is choose how much of the coach is on to begin with. That is a
 * decision somebody new should not have to find in a settings dialog, and it
 * is not a difficulty setting — it never touches the bots.
 */
export function PlayerForm({
  existing = [], editing, onSave, onCancel, onDelete,
}: {
  existing?: readonly LocalProfile[]
  editing?: LocalProfile
  onSave: (profile: LocalProfile) => void
  onCancel?: () => void
  onDelete?: () => void
}) {
  const [draft, setDraft] = useState<LocalProfile>(
    () => editing ?? makeProfile({ name: '' }, existing),
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof LocalProfile>(key: K, value: LocalProfile[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const named = draft.name.trim().length > 0
  const save = () => { if (named) onSave({ ...draft, name: draft.name.trim() }) }

  return (
    <div className="overlay solid" onClick={onCancel}>
      <form
        className="dialog wide"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); save() }}
      >
        <h2>{editing ? 'Edit player' : 'New player'}</h2>

        <div className="field">
          <label htmlFor="pname">Name</label>
          <input
            id="pname"
            value={draft.name}
            maxLength={30}
            autoFocus
            placeholder="Richard"
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="pnick">What the table calls you</label>
          <input
            id="pnick"
            value={draft.nickname}
            maxLength={20}
            placeholder="Optional"
            onChange={(e) => set('nickname', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="pinit">On the chip</label>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <input
              id="pinit"
              style={{ width: 80 }}
              value={draft.initials}
              maxLength={3}
              placeholder={initialsFor({ name: draft.name || 'Player' })}
              onChange={(e) => set('initials', e.target.value)}
            />
            <span
              className="playerchip-face"
              style={{ borderColor: draft.colour, color: draft.colour }}
            >
              {initialsFor({ name: draft.name || 'Player', initials: draft.initials })}
            </span>
            <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
              {PROFILE_COLOURS.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  aria-label={`Colour ${colour}`}
                  className={`swatch ${draft.colour === colour ? 'on' : ''}`}
                  style={{ background: colour }}
                  onClick={() => set('colour', colour)}
                />
              ))}
            </div>
          </div>
        </div>

        {/*
          Four buttons and one line of description, rather than four cards
          each carrying their own.
          
          The card version made this form taller than an iPad, which turned a
          layout bug into being unable to start the app at all. It is also the
          least important field on the screen — it picks a starting point for
          the coach and can be changed at any time — so it had no business
          being the biggest thing on it. Buttons rather than labels wrapping
          radios, too: that shape is what a surrounding `.field` mangles.
        */}
        <div className="field">
          <label id="explabel">How much poker have you played?</label>
          <div className="choices" role="radiogroup" aria-labelledby="explabel">
            {EXPERIENCE.map((level) => (
              <button
                key={level.id}
                type="button"
                role="radio"
                aria-checked={draft.experience === level.id}
                className={`choice ${draft.experience === level.id ? 'on' : ''}`}
                onClick={() => set('experience', level.id as Experience)}
              >
                {level.label}
              </button>
            ))}
          </div>
          <p className="sub" style={{ margin: '6px 0 0' }}>
            {experienceMeta(draft.experience).blurb} This only sets how much of
            the coach is switched on to begin with — it does not make the table
            easier or harder, and it can be changed at any time.
          </p>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn primary" type="submit" disabled={!named}>
            {editing ? 'Save' : 'Start playing'}
          </button>
          {onCancel && (
            <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
          )}
          {onDelete && (
            confirmDelete ? (
              <button className="btn small danger" type="button" onClick={onDelete}>
                Yes, delete this player and their history
              </button>
            ) : (
              <button
                className="btn small danger"
                type="button"
                onClick={() => setConfirmDelete(true)}
              >
                Delete player
              </button>
            )
          )}
        </div>
      </form>
    </div>
  )
}
