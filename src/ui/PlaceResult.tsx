import type { PlaceText } from '../lib/placeLabel'

interface PlaceResultProps {
  id: string
  text: PlaceText
  active: boolean
  onChoose: () => void
  onActive: () => void
}

/**
 * One listbox option for a searched address or place: the name, then the rest of the label and what it is. The
 * visible text is aria-hidden; the option's name is the one spoken sentence ("120 Broadway, Manhattan, address").
 */
export function PlaceResult({ id, text, active, onChoose, onActive }: PlaceResultProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onClick={onChoose}
      onPointerMove={(e) => e.pointerType === 'mouse' && onActive()}
      className={`flex min-h-11 cursor-pointer flex-col justify-center gap-1 border-l-4 px-3 py-2 ${
        active ? 'border-focus bg-panel' : 'border-transparent'
      }`}
    >
      <span aria-hidden="true" className="text-base leading-tight">
        {text.name}
      </span>
      <span aria-hidden="true" className="text-xs leading-tight text-ink-dim">
        {text.detail ? `${text.detail} · ${text.kindWord}` : text.kindWord}
      </span>
      <span className="sr-only">{text.spoken}</span>
    </li>
  )
}
