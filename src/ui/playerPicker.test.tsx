// @vitest-environment jsdom
/**
 * Picking who is playing.
 *
 * The screen exists to stop one person's hands landing in another's record, so
 * what is tested is mostly that it cannot be skipped past, that a guest is
 * unmistakably a guest, and that creating somebody is one short form rather
 * than a sign-up.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PlayerForm, PlayerPicker } from './PlayerPicker'
import { EXPERIENCE, makeProfile, type LocalProfile } from '../state/profiles'

afterEach(cleanup)

const RICHARD = makeProfile({ id: 'r', name: 'Richard Helms', nickname: 'Rich' })
const DAVE = makeProfile({ id: 'd', name: 'Dave' })

function picker(profiles: LocalProfile[] = [RICHARD, DAVE]) {
  const picked: LocalProfile[] = []
  const created: LocalProfile[] = []
  let guested = false
  render(
    <PlayerPicker
      profiles={profiles}
      onPick={(p) => picked.push(p)}
      onGuest={() => { guested = true }}
      onCreate={(p) => created.push(p)}
      onEdit={() => {}}
    />,
  )
  return { picked, created, guest: () => guested }
}

describe('choosing somebody', () => {
  it('shows everybody on the device by the name the table uses', () => {
    picker()
    expect(screen.getByText('Rich')).toBeTruthy()
    expect(screen.getByText('Dave')).toBeTruthy()
  })

  it('puts their initials on the chip', () => {
    picker()
    expect(screen.getByText('RH')).toBeTruthy()
    expect(screen.getByText('DA')).toBeTruthy()
  })

  it('hands back the one that was tapped', () => {
    const { picked } = picker()
    fireEvent.click(screen.getByText('Dave'))
    expect(picked).toHaveLength(1)
    expect(picked[0].id).toBe('d')
  })

  it('takes one tap, because this is not a login', () => {
    const { picked } = picker()
    fireEvent.click(screen.getByText('Rich'))
    expect(picked).toHaveLength(1)
    expect(document.querySelector('input[type="password"]')).toBe(null)
  })
})

describe('the guest', () => {
  it('is offered on the first screen, not buried', () => {
    const { guest } = picker()
    fireEvent.click(screen.getByText('Play as guest'))
    expect(guest()).toBe(true)
  })

  it('says plainly that nothing is kept', () => {
    picker()
    // Somebody has to be able to hand the iPad over knowing what it costs.
    expect(document.body.textContent).toMatch(/keeps nothing/i)
    expect(document.body.textContent).toMatch(/reaches anybody's record/i)
  })
})

describe('the first run', () => {
  it('goes straight to the form when nobody exists yet', () => {
    picker([])
    // An empty grid with an Add button is a dead end for a first-time opener.
    expect(screen.getByText('New player')).toBeTruthy()
  })

  it('offers no way out of the form when there is nothing to go back to', () => {
    picker([])
    expect(screen.queryByText('Cancel')).toBe(null)
  })

  it('lets you back out once there is somebody to go back to', () => {
    picker()
    fireEvent.click(screen.getByText('Add player'))
    expect(screen.getByText('Cancel')).toBeTruthy()
  })
})

describe('making a player', () => {
  function form() {
    const saved: LocalProfile[] = []
    render(<PlayerForm onSave={(p) => saved.push(p)} />)
    return saved
  }

  it('will not save somebody with no name', () => {
    form()
    expect((screen.getByText('Start playing') as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves once there is one', () => {
    const saved = form()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Dave  ' } })
    fireEvent.click(screen.getByText('Start playing'))
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('Dave')
  })

  it('asks nothing but a name, a look and how much poker they have played', () => {
    form()
    const labels = [...document.querySelectorAll('.field > label')].map((l) => l.textContent)
    // No email, no password, no account. Adding one would be a thing to
    // maintain forever in exchange for nothing.
    expect(labels).toEqual(['Name', 'What the table calls you', 'On the chip',
      'How much poker have you played?'])
  })

  it('offers every experience level, and says what it actually changes', () => {
    form()
    for (const level of EXPERIENCE) expect(screen.getByText(level.label)).toBeTruthy()
    expect(document.body.textContent).toMatch(/does not make the table easier or harder/i)
  })

  it('carries the chosen experience through to the saved player', () => {
    const saved = form()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Guy' } })
    fireEvent.click(screen.getByText(EXPERIENCE[0].label))
    fireEvent.click(screen.getByText('Start playing'))
    expect(saved[0].experience).toBe(EXPERIENCE[0].id)
  })

  it('previews the chip as you type', () => {
    form()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bob Jones' } })
    expect(document.querySelector('.field .playerchip-face')?.textContent).toBe('BJ')
  })
})

describe('editing and deleting', () => {
  it('takes two taps to delete somebody', () => {
    let deleted = false
    render(
      <PlayerForm editing={DAVE} onSave={() => {}} onDelete={() => { deleted = true }} />,
    )
    fireEvent.click(screen.getByText('Delete player'))
    expect(deleted).toBe(false)
    fireEvent.click(screen.getByText(/Yes, delete this player/))
    expect(deleted).toBe(true)
  })

  it('warns that the history goes with them', () => {
    render(<PlayerForm editing={DAVE} onSave={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByText('Delete player'))
    expect(screen.getByText(/and their history/)).toBeTruthy()
  })

  it('offers no delete at all when there is nobody to hand over to', () => {
    render(<PlayerForm editing={DAVE} onSave={() => {}} />)
    expect(screen.queryByText('Delete player')).toBe(null)
  })

  it('starts the form from the player being edited', () => {
    render(<PlayerForm editing={RICHARD} onSave={() => {}} />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Richard Helms')
    expect(screen.getByText('Edit player')).toBeTruthy()
  })
})
