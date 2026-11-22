import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'

export interface ScrollHint {
  /** The element scrolls and is not at its end: show a "more below" fade. */
  more: boolean
  onScroll: () => void
}

/**
 * Whether a height-capped scroller has more below its visible part (the pattern of the next-stops list's fade),
 * re-checked after every render, on scroll and when the element is resized. It sets state only when the answer
 * changes.
 */
export function useScrollHint(scroller: RefObject<HTMLElement | null>): ScrollHint {
  const [more, setMore] = useState(false)
  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setMore(el.scrollHeight > el.clientHeight + 1 && el.scrollTop + el.clientHeight < el.scrollHeight - 2)
  }, [scroller])
  useLayoutEffect(() => {
    measure()
  })
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [scroller, measure])
  return { more, onScroll: measure }
}
