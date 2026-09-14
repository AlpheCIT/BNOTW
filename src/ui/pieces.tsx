/** Small presentational pieces: playing cards, chips, seat plates. */

import { rankLabel, SUIT_SYMBOLS, type Card as CardModel } from '../engine/cards'
import { CHIP_SET, money } from '../engine/bnotw'

type CardSize = 'small' | 'normal' | 'big'

export function PlayingCard({
  card,
  size = 'normal',
  faceDown = false,
  dim = false,
  chosen = false,
  onClick,
  title,
}: {
  card?: CardModel
  size?: CardSize
  faceDown?: boolean
  dim?: boolean
  chosen?: boolean
  onClick?: () => void
  title?: string
}) {
  const classes = [
    'card',
    size === 'big' ? 'big' : size === 'small' ? 'small' : '',
    faceDown || !card ? 'back' : '',
    !faceDown && card && (card.suit === 'h' || card.suit === 'd') ? 'red' : '',
    dim ? 'dim' : '',
    chosen ? 'chosen' : '',
  ].filter(Boolean).join(' ')

  const label = faceDown || !card
    ? 'Face-down card'
    : `${rankLabel(card.rank)} of ${{ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[card.suit]}`

  const content = faceDown || !card ? null : (
    <>
      <span className="r">{rankLabel(card.rank)}</span>
      <span className="s">{SUIT_SYMBOLS[card.suit]}</span>
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} aria-label={label} title={title}>
        {content}
      </button>
    )
  }
  return <div className={classes} role="img" aria-label={label} title={title}>{content}</div>
}

export function CardRow({
  cards,
  size = 'normal',
  faceDown = false,
  placeholders = 0,
}: {
  cards: CardModel[]
  size?: CardSize
  faceDown?: boolean
  placeholders?: number
}) {
  const blanks = Math.max(0, placeholders - cards.length)
  return (
    <>
      {cards.map((card, i) => (
        <PlayingCard key={`${card.rank}${card.suit}-${i}`} card={card} size={size} faceDown={faceDown} />
      ))}
      {Array.from({ length: blanks }, (_, i) => (
        <div key={`blank-${i}`} className={`card ${size === 'big' ? 'big' : ''}`} style={{ opacity: 0.12, background: '#000' }} />
      ))}
    </>
  )
}

/** A single coloured chip, sized for a legend or an inline flourish. */
export function Chip({ value, small = false }: { value: number; small?: boolean }) {
  const chip = CHIP_SET.find((c) => c.value === value) ?? CHIP_SET[CHIP_SET.length - 1]
  return (
    <span
      className={`chip ${small ? 'sm' : ''}`}
      style={{
        background: `radial-gradient(circle at 34% 30%, ${chip.face} 0%, ${chip.face} 55%, ${chip.edge} 100%)`,
        color: chip.ink,
        border: `2px dashed ${chip.edge}`,
      }}
      title={`${chip.label} — ${money(chip.value)}`}
    >
      {small ? '' : money(chip.value).replace('$', '')}
    </span>
  )
}
