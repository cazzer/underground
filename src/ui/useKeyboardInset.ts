import { useEffect, useState } from 'react'

/**
 * How many px of the layout viewport's bottom the on-screen keyboard covers (0 without one). iOS Safari
 * leaves the layout viewport alone and shrinks only the visual viewport, so a full-height list would
 * run under the keyboard; pad it by this much.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)))
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}
