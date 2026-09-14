import { useEffect, useState } from 'react'
import { parseMoney } from '../engine/bnotw'

/**
 * A text field that edits cents but lets you type dollars however you like.
 * Keeps its own draft so typing "1." or "" does not fight the parser.
 */
export function MoneyInput({
  value, onChange, className = 'cell-input', ariaLabel,
}: {
  value: number
  onChange: (cents: number) => void
  className?: string
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState(() => (value / 100).toFixed(2))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft((value / 100).toFixed(2))
  }, [value, focused])

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft}
      onFocus={(e) => { setFocused(true); e.target.select() }}
      onBlur={() => {
        setFocused(false)
        setDraft((value / 100).toFixed(2))
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        const cents = parseMoney(e.target.value)
        if (cents !== null) onChange(cents)
      }}
    />
  )
}
