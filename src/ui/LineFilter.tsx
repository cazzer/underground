import { useRef } from 'react'
import { routeSpokenName } from '../lib/labels'
import type { LineChoice } from '../lib/live/lineFilter'
import type { Network } from '../lib/network'
import { useFocusLostOnUnmount } from './ArrivalRows'
import { RouteChip } from './RouteChip'

interface LineChipProps {
  choice: LineChoice
  routeById: Network['routeById']
  pressed: boolean
  onToggle: (key: string) => void
  /** Called when the chip goes away while it has focus (its line has no arrivals left). */
  onFocusLost: () => void
}

/**
 * One line: a toggle button whose padding makes a 44 px target round the 36 px chip. Its name is "Show only the A
 * train" (the visible "A" is in it) and `aria-pressed` carries the state, so the name doesn't change with it.
 */
function LineChip({ choice, routeById, pressed, onToggle, onFocusLost }: LineChipProps) {
  const button = useRef<HTMLButtonElement>(null)
  useFocusLostOnUnmount(button, onFocusLost)
  const route = routeById.get(choice.routeId)
  if (!route) throw new Error(`Line filter for unknown route "${choice.routeId}"`)
  return (
    <button
      ref={button}
      type="button"
      aria-pressed={pressed}
      onClick={() => onToggle(choice.key)}
      className="flex cursor-pointer items-center justify-center p-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      <RouteChip route={route} as="span" pressed={pressed} className="flex min-h-9 min-w-9 items-center justify-center text-sm">
        <span className="sr-only">Show only the {routeSpokenName(route.shortName)} train</span>
      </RouteChip>
    </button>
  )
}

interface LineFilterProps {
  lines: readonly LineChoice[]
  /** The chosen line's key, or null for every line. */
  pressed: string | null
  routeById: Network['routeById']
  onToggle: (key: string) => void
  onFocusLost: () => void
}

/**
 * The station panel's line filter: a chip per line with arrivals, as toggle buttons in a labelled group, in the
 * natural tab order. Tap one to show only that line, tap it again for all. Nothing for fewer than two lines.
 */
export function LineFilter({ lines, pressed, routeById, onToggle, onFocusLost }: LineFilterProps) {
  if (lines.length === 0) return null
  return (
    <div role="group" aria-label="Filter by line" className="-mx-1 mt-2 flex flex-wrap">
      {lines.map((choice) => (
        <LineChip
          key={choice.key}
          choice={choice}
          routeById={routeById}
          pressed={choice.key === pressed}
          onToggle={onToggle}
          onFocusLost={onFocusLost}
        />
      ))}
    </div>
  )
}
