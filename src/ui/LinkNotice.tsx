interface LinkNoticeProps {
  show: boolean
  onDismiss: () => void
  /** Opens the station search, so the visitor can find the station the link was meant for. */
  onSearch: () => void
}

const FOCUS = 'pointer-events-auto cursor-pointer focus-visible:outline-2 focus-visible:outline-focus'

/** Tells the user a shared `#station=` link pointed nowhere. Only the sentence is in the live region, which is always mounted. */
export function LinkNotice({ show, onDismiss, onSearch }: LinkNoticeProps) {
  return (
    <div className={show ? 'mt-1 max-w-72 text-xs text-status-warn' : 'text-xs'}>
      <div>
        <p role="status" className="inline">
          {show && (
            <>
              <span aria-hidden="true">▲ </span>
              That link&apos;s station isn&apos;t on this map.
            </>
          )}
        </p>
        {show && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss message"
            className={`${FOCUS} -my-3.5 inline-flex min-h-11 min-w-11 items-center justify-center align-middle text-ink-dim hover:text-ink`}
          >
            ×
          </button>
        )}
      </div>
      {show && (
        <button type="button" onClick={onSearch} className={`${FOCUS} inline-flex min-h-6 items-center underline hover:text-ink`}>
          Search stations
        </button>
      )}
    </div>
  )
}
