import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type RefObject } from 'react'
import { Vector3, type Group } from 'three'
import type { LevelLabel } from '../lib/interiorFraming'

/** A background-colored halo instead of a filled chip, so strokes show through; the street labels share it. */
export const LABEL_HALO = '[text-shadow:0_0_2px_var(--ug-bg),0_0_2px_var(--ug-bg),0_0_5px_var(--ug-bg)]'
const CLASS = `pointer-events-none absolute top-0 left-0 -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-ink-dim uppercase tracking-widest ${LABEL_HALO}`
const EPS = 0.01

const world = new Vector3()
const toCamera = new Vector3()
const lookDir = new Vector3()

/**
 * Level labels as plain DOM elements in the canvas's container, placed each frame by projecting their group-local
 * points through the interior group (so they follow its depth scale). Not drei's Html: that mounts a React root per
 * label and unmounts it inside a layout-effect cleanup, which React 19 reports as "unmount a root while already
 * rendering" whenever the scene commits inside a DOM render (StrictMode's mount cycle at a hash load).
 * `opacity` is read every frame; a label at 0 is hidden, as is one behind the camera. Register it after the frame
 * that scales `group`, so a label never trails its levels by a frame.
 */
export function useLevelLabels(labels: LevelLabel[], group: RefObject<Group | null>, opacity: RefObject<number>): void {
  const host = useThree((s) => s.gl.domElement.parentElement)
  const els = useRef<HTMLDivElement[]>([])
  const last = useRef<{ x: number; y: number; opacity: number; behind: boolean }[]>([])

  useEffect(() => {
    if (!host) return
    const made = labels.map((label) => {
      const el = document.createElement('div')
      el.className = CLASS
      el.style.zIndex = '0'
      el.style.visibility = 'hidden'
      el.textContent = label.text
      host.appendChild(el)
      return el
    })
    els.current = made
    last.current = made.map(() => ({ x: NaN, y: NaN, opacity: NaN, behind: false }))
    return () => {
      for (const el of made) el.remove()
      els.current = []
      last.current = []
    }
  }, [host, labels])

  useFrame(({ camera, size }) => {
    const g = group.current
    const list = els.current
    if (!g || list.length === 0) return
    camera.updateMatrixWorld()
    g.updateWorldMatrix(true, false)
    camera.getWorldDirection(lookDir)
    const o = opacity.current
    for (let i = 0; i < list.length; i++) {
      const el = list[i]!
      const prev = last.current[i]!
      const p = labels[i]!.position
      world.set(p[0], p[1], p[2]).applyMatrix4(g.matrixWorld)
      toCamera.copy(world).sub(camera.position)
      const behind = toCamera.angleTo(lookDir) > Math.PI / 2
      if (behind !== prev.behind) {
        el.style.display = behind ? 'none' : ''
        prev.behind = behind
      }
      if (o !== prev.opacity) {
        el.style.opacity = String(o)
        el.style.visibility = o > 0 ? 'visible' : 'hidden'
        prev.opacity = o
      }
      if (behind || o <= 0) continue
      world.project(camera)
      const x = (world.x * size.width) / 2 + size.width / 2
      const y = (-world.y * size.height) / 2 + size.height / 2
      if (!(Math.abs(x - prev.x) <= EPS && Math.abs(y - prev.y) <= EPS)) {
        el.style.transform = `translate3d(${x}px,${y}px,0)`
        prev.x = x
        prev.y = y
      }
    }
  })
}
