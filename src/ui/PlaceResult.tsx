import type { PlaceText } from '../lib/placeLabel'
import type { RowAction } from '../lib/searchRowActions'
import type { TripEnd } from '../lib/trip'
import { ResultRow } from './ResultRow'

interface PlaceResultProps {
  row: number
  highlighted: boolean
  actions: readonly RowAction[]
  text: PlaceText
  /** The label's name for the directions buttons (`rowName`). */
  name: string
  onChoose: () => void
  onDirections: (end: TripEnd) => void
}

/**
 * One row for a searched address or place: the name, then the rest of the label and what it is. The visible text is
 * aria-hidden; the button's name is the one spoken sentence ("120 Broadway, Manhattan, address").
 */
export function PlaceResult({ row, highlighted, actions, text, name, onChoose, onDirections }: PlaceResultProps) {
  return (
    <ResultRow row={row} highlighted={highlighted} actions={actions} name={name} onChoose={onChoose} onDirections={onDirections}>
      <span aria-hidden="true" className="text-base leading-tight">
        {text.name}
      </span>
      <span aria-hidden="true" className="text-xs leading-tight text-ink-dim">
        {text.detail ? `${text.detail} · ${text.kindWord}` : text.kindWord}
      </span>
      <span className="sr-only">{text.spoken}</span>
    </ResultRow>
  )
}
