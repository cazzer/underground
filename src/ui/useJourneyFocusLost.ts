import { useLayoutEffect, useRef, type RefObject } from 'react'

/** The `data-journey-key` of the closest journey view or row around an element: which journey the focus was in. */
function journeyKeyOf(el: Element): string | null {
  return el.closest('[data-journey-key]')?.getAttribute('data-journey-key') ?? null
}

/**
 * Calls `onFocusLost` with the focused journey's key if focus is inside the element when it unmounts. As
 * `useFocusLostOnUnmount` (ArrivalRows), but for a whole view: its layout cleanup runs before React removes the
 * nodes, so focus can still be read.
 */
export function useJourneyFocusLost(el: RefObject<HTMLElement | null>, onFocusLost: (journeyKey: string | null) => void): void {
  const lost = useRef(onFocusLost)
  useLayoutEffect(() => {
    lost.current = onFocusLost
  })
  useLayoutEffect(
    () => () => {
      const node = el.current
      const active = document.activeElement
      if (node !== null && active !== null && node.contains(active)) lost.current(journeyKeyOf(active))
    },
    [el],
  )
}
