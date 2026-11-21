import { useFocus } from '../lib/focus'
import type { LocateState } from '../lib/locate'
import { locateMessage, type LocateMessage } from '../lib/locateMessage'

interface LocateStatusProps {
  state: LocateState
  /** The × button; the parent moves focus back to the locate button afterwards. */
  onClear: () => void
}

/** A glyph per tone, so color is never the only cue. */
const GLYPH: Record<LocateMessage['tone'], string> = { info: '◎', warn: '▲', error: '✕' }
const TONE: Record<LocateMessage['tone'], string> = {
  info: 'text-ink-dim',
  warn: 'text-status-warn',
  error: 'text-status-error',
}

const FOCUS = 'pointer-events-auto cursor-pointer focus-visible:outline-2 focus-visible:outline-focus'

function clearLabel(state: LocateState): string {
  if (state.status === 'locating') return 'Cancel finding my location'
  return state.status === 'located' ? 'Clear my location' : 'Dismiss message'
}

/**
 * What the location button found, or why it couldn't. Only the sentence is in the live region (always
 * mounted, empty when idle) so a screen reader announces each change without reading the buttons.
 * Never shows coordinates.
 */
export function LocateStatus({ state, onClear }: LocateStatusProps) {
  const { select } = useFocus()
  const message = locateMessage(state)
  const action = message?.action
  return (
    <div className={message ? 'mt-1 flex max-w-72 items-start gap-3 text-xs' : 'text-xs'}>
      <div className={`min-w-0 ${message ? TONE[message.tone] : ''}`}>
        <p role="status">
          {message && (
            <>
              <span aria-hidden="true">{GLYPH[message.tone]} </span>
              {message.text}
            </>
          )}
        </p>
        {action && (
          <button
            type="button"
            onClick={() => select(action.stationId)}
            className={`${FOCUS} -my-1 inline-flex min-h-6 items-center underline hover:text-ink`}
          >
            {action.label}
          </button>
        )}
      </div>
      {message && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel(state)}
          className={`${FOCUS} -m-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center p-2 text-ink-dim hover:text-ink`}
        >
          ×
        </button>
      )}
    </div>
  )
}
