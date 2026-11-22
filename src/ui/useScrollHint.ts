import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'

export interface ScrollHint {
  /** The element scrolls and is not at its end: show a "more below" fade. */
  more: boolean
  onScroll: () => void
}

/**
 * Whether a height-capped scroller has more below its visible part (the pattern of the next-stops list's fade),
 * re-checked after every render, on scroll and when the element or its `content` wrapper is resized (the scroller's
 * own box doesn't change when a section inside it expands). It sets state only when the answer
 * changes.
 */
export function useScrollHint(scroller: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>): ScrollHint {
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
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [scroller, content, measure])
  return { more, onScroll: measure }
}
