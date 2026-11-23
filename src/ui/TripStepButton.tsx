import type { TripStep } from '../lib/tripSteps'

interface TripStepButtonProps {
  step: TripStep
  /** The step the visitor pressed and the map still shows. */
  active: boolean
  onPress: (key: string, stationId: string) => void
}

/**
 * A Board, Change or Exit step: pressing it flies to its station, where the map shows the way through it if there is one.
 * The button keeps focus. The visible text and its dim status are hidden from assistive tech, which hears the one
 * sentence (the step's number, what to do and its time, and "No station layout" where there is none).
 */
export function TripStepButton({ step, active, onPress }: TripStepButtonProps) {
  return (
    <button
      type="button"
      data-step={step.key}
      aria-current={active ? 'step' : undefined}
      aria-description="Show on map"
      onClick={() => onPress(step.key, step.stationId)}
      className={`group -my-1 flex min-h-11 w-full cursor-pointer flex-col justify-center border-l-2 pl-2 text-left focus-visible:outline-2 focus-visible:outline-focus ${active ? 'border-focus text-focus' : 'border-transparent hover:text-ink'}`}
    >
      <span aria-hidden="true" className="underline decoration-1 underline-offset-2 group-hover:decoration-2">
        {step.text}
      </span>
      {step.status !== null && (
        <span aria-hidden="true" className="text-xs text-ink-dim">
          {step.status}
        </span>
      )}
      <span className="sr-only">{step.spoken}</span>
    </button>
  )
}
