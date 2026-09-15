/**
 * Choosing what to put back, and being told what it costs.
 *
 * Deliberately not one button. "Reset" in most apps means an unknown amount of
 * your history disappearing, so the only way to make it safe to use is to say
 * exactly what each line takes before it takes it — and to keep the one thing
 * that cannot be rebuilt by playing more, the Record Book, off the default
 * list and behind its own warning.
 *
 * Nothing happens until Erase is pressed, and Erase says how many things it is
 * about to do.
 */

import { useState } from 'react'
import { RESET_AREAS, everythingIds, type ResetAreaId } from '../state/factory'

export function ResetDialog({
  onApply, onClose,
}: {
  onApply: (ids: ResetAreaId[]) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Set<ResetAreaId>>(new Set())
  const [confirming, setConfirming] = useState(false)

  const toggle = (id: ResetAreaId) => {
    setConfirming(false)
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const count = picked.size
  const takesBook = picked.has('book')

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Start Fresh</h2>
        <p className="sub">
          Pick what goes back to the way it shipped. Everything here is on this
          device only, so nothing can be recovered afterwards — take a Backup
          JSON first if you are not sure.
        </p>

        <div className="resetlist">
          {RESET_AREAS.map((area) => (
            <label key={area.id} className={`resetrow ${picked.has(area.id) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={picked.has(area.id)}
                onChange={() => toggle(area.id)}
              />
              <div>
                <div className="resetlabel">
                  {area.label}
                  {area.id === 'book' && <span className="tag money">Real money</span>}
                </div>
                <div className="sub">{area.what}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button
            className="btn small ghost"
            onClick={() => { setConfirming(false); setPicked(new Set(everythingIds())) }}
          >
            Select everything
          </button>
          <button
            className="btn small ghost"
            onClick={() => { setConfirming(false); setPicked(new Set()) }}
            disabled={count === 0}
          >
            Clear selection
          </button>
        </div>

        {takesBook && (
          <p className="warn bad">
            The Record Book is who owes who. Deleting it does not settle anything —
            it just means nobody can look it up.
          </p>
        )}

        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          {confirming ? (
            <>
              <button
                className="btn danger"
                onClick={() => { onApply([...picked]); onClose() }}
              >
                Yes, erase {count === 1 ? 'it' : `all ${count}`}
              </button>
              <button className="btn ghost" onClick={() => setConfirming(false)}>Back</button>
            </>
          ) : (
            <>
              <button
                className="btn danger"
                disabled={count === 0}
                onClick={() => setConfirming(true)}
              >
                {count === 0 ? 'Nothing selected' : `Erase ${count} thing${count === 1 ? '' : 's'}`}
              </button>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
