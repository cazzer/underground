import { useEffect } from 'react'
import { useFocus } from '../lib/focus'
import { network } from '../lib/network'
import { theme } from '../theme'
import { Attribution } from './Attribution'

/** Placeholder rows until real arrivals exist. */
const PLACEHOLDER_ARRIVALS = [
  { line: 'L1', destination: 'Houston St', minutes: 2 },
  { line: 'L2', destination: 'Union Sq', minutes: 5 },
  { line: 'L1', destination: 'Battery Park', minutes: 9 },
]

function lineColor(lineId: string): string {
  const route = network.routes.find((r) => r.id === lineId)
  return theme.lines[(route?.colorIndex ?? 0) % theme.lines.length] ?? theme.ink
}

interface ArrivalsPanelProps {
  stationId: string
  onClose: () => void
}

function ArrivalsPanel({ stationId, onClose }: ArrivalsPanelProps) {
  const station = network.stations.find((s) => s.id === stationId)
  if (!station) throw new Error(`Arrivals panel for unknown station "${stationId}"`)
  return (
    <aside
      aria-label={`Arrivals at ${station.name}`}
      className="pointer-events-auto w-72 max-w-full border border-edge bg-panel p-4 text-ink backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg leading-tight">{station.name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close station panel"
          className="-m-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center p-2 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex gap-1.5">
        {station.lineIds.map((id) => (
          <span key={id} className="border px-1.5 text-xs" style={{ borderColor: lineColor(id), color: lineColor(id) }}>
            {id}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs uppercase tracking-widest text-ink-dim">Arrivals (placeholder)</p>
      <ul className="mt-1 divide-y divide-edge/30 text-sm">
        {PLACEHOLDER_ARRIVALS.map((a) => (
          <li key={`${a.line}-${a.destination}`} className="flex justify-between py-1.5">
            <span>
              {a.line} <span className="text-ink-dim">to</span> {a.destination}
            </span>
            <span className="font-mono">{a.minutes} min</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function Hud() {
  const { focusedId, dismiss } = useFocus()

  useEffect(() => {
    if (!focusedId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedId, dismiss])

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 text-ink">
      <header>
        <h1 className="text-xl tracking-[0.3em] uppercase">underground</h1>
        <p className="text-xs text-ink-dim">sample data / theme: {theme.name}</p>
      </header>
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-end sm:justify-between sm:gap-4">
        {focusedId && <ArrivalsPanel stationId={focusedId} onClose={dismiss} />}
        <Attribution />
      </div>
    </div>
  )
}
