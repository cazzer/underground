import { useId, useMemo } from 'react'
import type { EntranceText } from '../lib/entranceText'
import { entranceRows } from '../lib/entranceList'

interface EntranceListProps {
  /** The focused station's labelled entrances (the street file's), null until they load or when it has none. */
  entrances: readonly EntranceText[] | null
  /** Whether a label's entrance lists the focused station; rows that do come first (a complex shares its entrances). */
  listsStation?: (text: EntranceText) => boolean
}

/**
 * Where the focused station's entrances open onto the street, for screen readers only. Sighted users read the map's
 * entrance labels, so the panel never shows the list (the user's call: keep the panel short). The map labels are
 * aria-hidden, so this list is how a screen reader gets the same facts, in each row's spoken form. Not a live region;
 * nothing while the street file loads or when the station has no labelled entrance.
 */
export function EntranceList({ entrances, listsStation }: EntranceListProps) {
  const headingId = useId()
  const rows = useMemo(() => (entrances ? entranceRows(entrances, listsStation) : []), [entrances, listsStation])
  if (rows.length === 0) return null
  return (
    <section className="sr-only" aria-labelledby={headingId}>
      <h3 id={headingId}>Entrances</h3>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>{row.spoken}</li>
        ))}
      </ul>
    </section>
  )
}
