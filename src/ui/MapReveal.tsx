import { useEffect, useRef, useState } from 'react'
import { addAfterEffect } from '@react-three/fiber'
import type { Insets } from '../lib/framing'
import {
  REVEAL_FADE_MS,
  REVEAL_MS,
  fadeOpacity,
  revealFront,
  revealGeometry,
  revealGradient,
  revealProgress,
} from '../lib/mapReveal'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { theme } from '../theme'

interface MapRevealProps {
  /** The HUD's measured bands; read once when the wipe starts. */
  insets: Insets
}

/**
 * The opening reveal: a `theme.background` cover over the canvas, wiped open from the middle of
 * the free area, then unmounted. It starts on the rAF after the scene's first drawn frame, so
 * the map never flashes. z-index stays auto: tree order puts it over the canvas's DOM labels and
 * under the HUD. Under reduced motion it fades out over 200 ms instead of sweeping.
 */
export function MapReveal({ insets }: MapRevealProps) {
  const [done, setDone] = useState(false)
  const el = useRef<HTMLDivElement>(null)
  const insetsRef = useRef(insets)
  insetsRef.current = insets

  useEffect(() => {
    const node = el.current
    if (!node) return
    node.style.background = theme.background
    node.style.opacity = '1'
    let armed = true
    let raf = 0

    function start(target: HTMLDivElement): void {
      const rect = target.getBoundingClientRect()
      const geometry = revealGeometry(rect.width, rect.height, insetsRef.current)
      const reduced = prefersReducedMotion()
      const t0 = performance.now()
      const step = (now: number): void => {
        const elapsed = now - t0
        if (reduced) {
          target.style.opacity = String(fadeOpacity(elapsed))
          if (elapsed >= REVEAL_FADE_MS) return setDone(true)
        } else {
          const p = revealProgress(elapsed, REVEAL_MS)
          target.style.background = revealGradient(geometry, revealFront(geometry, p), theme.background)
          if (p >= 1) return setDone(true)
        }
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }

    const unsubscribe = addAfterEffect(() => {
      if (!armed) return
      armed = false
      raf = requestAnimationFrame(() => start(node))
    })

    return () => {
      armed = false
      unsubscribe()
      cancelAnimationFrame(raf)
    }
  }, [])

  if (done) return null
  return (
    <div
      ref={el}
      data-map-reveal
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ background: theme.background }}
    />
  )
}
