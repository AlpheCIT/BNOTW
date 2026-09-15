import { describe, it, expect } from 'vitest'
import { HAND_NAMES, allHandNames, handKey, handName } from './handNames'
import { parseCards } from './cards'

const hole = (codes: string) => parseCards(codes)

describe('naming a starting hand', () => {
  it('writes a hand the way people write it', () => {
    expect(handKey(hole('As Ks'))).toBe('AKs')
    expect(handKey(hole('As Kd'))).toBe('AKo')
    expect(handKey(hole('Qh Qc'))).toBe('QQ')
  })

  it('puts the higher card first however it was dealt', () => {
    expect(handKey(hole('Kd As'))).toBe(handKey(hole('As Kd')))
    expect(handKey(hole('2c 7h'))).toBe('72o')
  })

  it('finds the names', () => {
    expect(handName(hole('As Kd'))).toBe('Big Slick')
    expect(handName(hole('9h 5c'))).toBe('Dolly Parton')
    expect(handName(hole('3d 2c'))).toBe('Dirty Diaper')
    // The house 7-2 bonus already has a name everywhere else.
    expect(handName(hole('7s 2d'))).toBe('The Hammer')
  })

  it('says nothing about the hands nobody has a name for', () => {
    expect(handName(hole('9c 4d'))).toBe(null)
  })

  it('needs two cards', () => {
    expect(handKey(hole('As'))).toBe(null)
    expect(handName(hole('As'))).toBe(null)
  })
})

describe('a table making the list its own', () => {
  it('prefers the table\'s name over the shipped one', () => {
    expect(handName(hole('As Kd'), { AKo: 'Anna Kournikova' })).toBe('Anna Kournikova')
  })

  it('takes a name for a hand that shipped without one', () => {
    expect(handName(hole('Jh 6c'), { J6o: 'Insurrection' })).toBe('Insurrection')
  })

  it('hides a shipped name when the table clears it', () => {
    // Emptying an entry is how you delete a name you never say, rather than
    // the list needing a separate idea of "removed".
    expect(handName(hole('Qh 7d'), { Q7o: '' })).toBe(null)
    expect(handName(hole('Qh 7d'))).toBe('Computer Hand')
  })

  it('lists everything in play for the editor, marking what is the table\'s', () => {
    const list = allHandNames({ J6o: 'Insurrection', AKo: 'Anna Kournikova' })
    const j6 = list.find((e) => e.key === 'J6o')
    const ak = list.find((e) => e.key === 'AKo')

    expect(j6).toEqual({ key: 'J6o', name: 'Insurrection', custom: true })
    expect(ak?.custom).toBe(true)
    expect(list.length).toBeGreaterThan(Object.keys(HAND_NAMES).length - 2)
  })

  it('leaves cleared names out of the list', () => {
    expect(allHandNames({ Q7o: '' }).some((e) => e.key === 'Q7o')).toBe(false)
  })
})
