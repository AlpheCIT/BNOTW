import { useRef, useState } from 'react'
import {
  ACCESSORIES, ARCHETYPES, AVATAR_BG, AVATAR_HAIR_COLOR, AVATAR_SKIN,
  FACIAL_STYLES, HAIR_STYLES, SKILL_LABELS, TENDENCY_META,
  archetype, faceFor, matchArchetype, personaFromArchetype, styleSummary,
  type ArchetypeId, type Persona, type Skill, type Tendencies,
} from '../engine/persona'
import type { RosterState } from '../state/storage'
import { Avatar } from './Avatar'

const MAX_SEATS = 8

export function PlayersView({
  roster, setRoster, onSeatChange,
}: {
  roster: RosterState
  setRoster: (roster: RosterState) => void
  /** Called when the seated line-up changes, so the table can be restarted. */
  onSeatChange: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)

  const update = (persona: Persona) => {
    setRoster({
      ...roster,
      players: roster.players.map((p) => (p.id === persona.id ? persona : p)),
    })
  }

  const toggleSeat = (id: string) => {
    const seated = roster.seated.includes(id)
      ? roster.seated.filter((s) => s !== id)
      : [...roster.seated, id].slice(0, MAX_SEATS)
    setRoster({ ...roster, seated })
    onSeatChange()
  }

  const addPlayer = () => {
    const persona = personaFromArchetype('New player', 'grinder', `p-${Date.now().toString(36)}`)
    persona.avatar = faceFor(persona.id)
    setRoster({ ...roster, players: [...roster.players, persona] })
    setEditing(persona.id)
  }

  const remove = (id: string) => {
    setRoster({
      ...roster,
      players: roster.players.filter((p) => p.id !== id),
      seated: roster.seated.filter((s) => s !== id),
    })
    setEditing(null)
    onSeatChange()
  }

  const open = roster.players.find((p) => p.id === editing)

  return (
    <div className="scroll">
      <div className="panel">
        <h2>The Regulars</h2>
        <p className="sub">
          Everyone who might sit down. Tap a player to change how they play, or the
          seat button to bring them to the table — up to {MAX_SEATS} at once.
        </p>
        <div className="row">
          <span className="tag gold">{roster.seated.length} of {MAX_SEATS} seated</span>
          <span className="spacer" />
          <button className="btn small" onClick={addPlayer}>+ Add player</button>
        </div>
        <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
          Skill is how <i>well</i> someone plays — a high-skill player reads their hand
          accurately and adjusts for position, while a beginner keeps misjudging it in
          both directions. Tendencies are how they <i>like</i> to play. The two are
          separate on purpose: a loose-aggressive expert and a loose-aggressive donk
          want the same things and are completely different opponents.
        </p>
      </div>

      <div className="roster">
        {roster.players.map((persona) => (
          <div
            key={persona.id}
            className={`player-card ${roster.seated.includes(persona.id) ? 'seated' : ''}`}
          >
            <button className="player-open" onClick={() => setEditing(persona.id)}>
              <Avatar spec={persona.avatar} size={52} alt={persona.name} />
              <div className="player-meta">
                <b>{persona.name}</b>
                <span>{archetype(persona.archetype)?.name ?? 'Custom'}</span>
                <span className="faint">{styleSummary(persona.tendencies)}</span>
              </div>
            </button>
            <div className="player-foot">
              <Stars skill={persona.skill} />
              <button
                className={`btn small ${roster.seated.includes(persona.id) ? 'primary' : 'ghost'}`}
                onClick={() => toggleSeat(persona.id)}
                disabled={!roster.seated.includes(persona.id) && roster.seated.length >= MAX_SEATS}
              >
                {roster.seated.includes(persona.id) ? 'Seated' : 'Sit down'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <PersonaEditor
          persona={open}
          onChange={update}
          onClose={() => setEditing(null)}
          onDelete={() => remove(open.id)}
          canDelete={roster.players.length > 2}
        />
      )}
    </div>
  )
}

function Stars({ skill }: { skill: Skill }) {
  return (
    <span className="stars" title={`${SKILL_LABELS[skill]} (${skill} of 5)`}>
      {'★'.repeat(skill)}<span className="faint">{'★'.repeat(5 - skill)}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------

function PersonaEditor({
  persona, onChange, onClose, onDelete, canDelete,
}: {
  persona: Persona
  onChange: (persona: Persona) => void
  onClose: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const preset = matchArchetype(persona)

  const setAvatar = (patch: Partial<Persona['avatar']>) =>
    onChange({ ...persona, avatar: { ...persona.avatar, ...patch } })

  const setTendency = (key: keyof Tendencies, value: number) =>
    onChange({
      ...persona,
      archetype: 'custom',
      tendencies: { ...persona.tendencies, [key]: value },
    })

  const applyPreset = (id: ArchetypeId) => {
    const found = archetype(id)
    if (!found) return
    onChange({ ...persona, archetype: id, skill: found.skill, tendencies: { ...found.tendencies } })
  }

  /** Shrink a chosen photo to a small square so the roster stays storable. */
  const loadPhoto = (file: File) => {
    setPhotoError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = 160
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const side = Math.min(img.width, img.height)
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
        setAvatar({ photo: canvas.toDataURL('image/jpeg', 0.82) })
      }
      img.onerror = () => setPhotoError('That image could not be read.')
      img.src = String(reader.result)
    }
    reader.onerror = () => setPhotoError('That file could not be read.')
    reader.readAsDataURL(file)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <Avatar spec={persona.avatar} size={64} alt={persona.name} />
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="pname">Name</label>
              <input
                id="pname"
                value={persona.name}
                maxLength={18}
                onChange={(e) => onChange({ ...persona, name: e.target.value })}
              />
            </div>
          </div>
        </div>

        <h2>Face</h2>
        {persona.avatar.photo ? (
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="sub" style={{ margin: 0, flex: '1 1 auto' }}>Using a photo.</span>
            <button className="btn small" onClick={() => setAvatar({ photo: undefined })}>
              Back to a drawn face
            </button>
          </div>
        ) : (
          <>
            <div className="picker">
              <Swatches
                label="Background" palette={AVATAR_BG} value={persona.avatar.bg}
                onPick={(bg) => setAvatar({ bg })}
              />
              <Swatches
                label="Skin" palette={AVATAR_SKIN} value={persona.avatar.skin}
                onPick={(skin) => setAvatar({ skin })}
              />
              <Swatches
                label="Hair colour" palette={AVATAR_HAIR_COLOR} value={persona.avatar.hairColor}
                onPick={(hairColor) => setAvatar({ hairColor })}
              />
            </div>
            <div className="picker">
              <Choice
                label="Hair" options={HAIR_STYLES} value={persona.avatar.hair}
                onPick={(hair) => setAvatar({ hair })}
              />
              <Choice
                label="Facial hair" options={FACIAL_STYLES} value={persona.avatar.facial}
                onPick={(facial) => setAvatar({ facial })}
              />
              <Choice
                label="Accessory" options={ACCESSORIES} value={persona.avatar.accessory}
                onPick={(accessory) => setAvatar({ accessory })}
              />
            </div>
          </>
        )}
        <div className="row" style={{ marginBottom: 14 }}>
          <button
            className="btn small"
            onClick={() => onChange({
              ...persona,
              avatar: faceFor(`${persona.id}-${Math.random().toString(36).slice(2)}`),
            })}
          >
            Shuffle face
          </button>
          <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
            Use a photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadPhoto(file)
              e.target.value = ''
            }}
          />
        </div>
        {photoError && <div className="warn bad">{photoError}</div>}

        <h2>How they play</h2>
        <div className="field">
          <label htmlFor="preset">Starting point</label>
          <select
            id="preset"
            value={preset}
            onChange={(e) => applyPreset(e.target.value as ArchetypeId)}
          >
            {preset === 'custom' && <option value="custom">Custom</option>}
            {ARCHETYPES.map((a) => (
              <option key={a.id} value={a.id}>{a.name} — {a.blurb}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="skill">
            Skill — {SKILL_LABELS[persona.skill]} ({persona.skill} of 5)
          </label>
          <input
            id="skill"
            type="range"
            min={1}
            max={5}
            value={persona.skill}
            onChange={(e) => onChange({
              ...persona, archetype: 'custom', skill: Number(e.target.value) as Skill,
            })}
          />
          <p className="sub" style={{ margin: 0 }}>
            {persona.skill <= 2
              ? 'Misjudges hands badly, ignores position, and will pay you off.'
              : persona.skill === 3
                ? 'Reads the board reasonably and mostly gets the price right.'
                : 'Reads equity accurately, plays position, and punishes mistakes.'}
          </p>
        </div>

        {TENDENCY_META.map((meta) => (
          <div className="field" key={meta.key}>
            <label htmlFor={meta.key}>
              {meta.label} — {persona.tendencies[meta.key]}
            </label>
            <input
              id={meta.key}
              type="range"
              min={0}
              max={100}
              value={persona.tendencies[meta.key]}
              onChange={(e) => setTendency(meta.key, Number(e.target.value))}
            />
            <div className="range-ends">
              <span>{meta.low}</span>
              <span>{meta.high}</span>
            </div>
          </div>
        ))}

        <div className="field">
          <label htmlFor="note">Note</label>
          <input
            id="note"
            value={persona.note}
            placeholder="A read, a catchphrase, whatever is useful"
            maxLength={80}
            onChange={(e) => onChange({ ...persona, note: e.target.value })}
          />
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={onClose}>Done</button>
          <span className="spacer" />
          <button className="btn small danger" disabled={!canDelete} onClick={onDelete}>
            Remove player
          </button>
        </div>
      </div>
    </div>
  )
}

function Swatches({
  label, palette, value, onPick,
}: {
  label: string
  palette: string[]
  value: number
  onPick: (index: number) => void
}) {
  return (
    <div className="swatches">
      <span>{label}</span>
      <div>
        {palette.map((colour, i) => (
          <button
            key={colour}
            className={`swatch ${i === value % palette.length ? 'on' : ''}`}
            style={{ background: colour }}
            aria-label={`${label} option ${i + 1}`}
            aria-pressed={i === value % palette.length}
            onClick={() => onPick(i)}
          />
        ))}
      </div>
    </div>
  )
}

function Choice({
  label, options, value, onPick,
}: {
  label: string
  options: string[]
  value: number
  onPick: (index: number) => void
}) {
  const index = value % options.length
  return (
    <div className="swatches">
      <span>{label}</span>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button
          className="btn small ghost"
          aria-label={`Previous ${label}`}
          onClick={() => onPick((index - 1 + options.length) % options.length)}
        >
          ‹
        </button>
        <span className="choice-value">{options[index]}</span>
        <button
          className="btn small ghost"
          aria-label={`Next ${label}`}
          onClick={() => onPick((index + 1) % options.length)}
        >
          ›
        </button>
      </div>
    </div>
  )
}
