import { useFocus } from '../lib/focus'
import { network } from '../lib/network'
import { theme } from '../theme'

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

function ArrivalsPanel({ stationId, onClose }: { stationId: string; onClose: () => void }) {
  const station = network.stations.find((s) => s.id === stationId)
  if (!station) return null
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
          className="cursor-pointer px-1 text-ink-dim hover:text-ink"
        >
          x
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
  const { focusedId, clear } = useFocus()
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 text-ink">
      <header>
        <h1 className="text-xl tracking-[0.3em] uppercase">underground</h1>
        <p className="text-xs text-ink-dim">sample data / theme: {theme.name}</p>
      </header>
      <div className="flex justify-start sm:justify-end">
        {focusedId && <ArrivalsPanel stationId={focusedId} onClose={clear} />}
      </div>
    </div>
  )
}
