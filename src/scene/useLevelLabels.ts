import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type RefObject } from 'react'
import { Vector3, type Group } from 'three'
import type { LevelLabel } from '../lib/interiorFraming'
import type { LabelBlockers } from '../lib/labelBlockers'
import { RECT } from '../lib/labelGeometry'
import { clearLabelTop } from '../lib/labelKeepOut'

/** A background-colored halo instead of a filled chip, so strokes show through; the street labels share it. */
export const LABEL_HALO = '[text-shadow:0_0_2px_var(--ug-bg),0_0_2px_var(--ug-bg),0_0_5px_var(--ug-bg)]'
const CLASS = `pointer-events-none absolute top-0 left-0 -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-ink-dim uppercase tracking-widest ${LABEL_HALO}`
const EPS = 0.01

/** How far a label keeps clear of a keep-out point, px; at most this many points are read. */
const KEEP_OUT_PAD_PX = 6
const MAX_KEEP_OUT = 16
const keepXY = new Float32Array(MAX_KEEP_OUT * 2)

const world = new Vector3()
const toCamera = new Vector3()
const lookDir = new Vector3()

/**
 * Level labels as plain DOM elements in the canvas's container, placed each frame by projecting their group-local
 * points through the interior group (so they follow its depth scale). Not drei's Html: that mounts a React root per
 * label and unmounts it inside a layout-effect cleanup, which React 19 reports as "unmount a root while already
 * rendering" whenever the scene commits inside a DOM render (StrictMode's mount cycle at a hash load).
 * `opacity` is read every frame; a label at 0 is hidden, as is one behind the camera. Register it after the frame
 * that scales `group`, so a label never trails its levels by a frame. Each shown label's canvas rect goes to
 * `blockers` (its version bumped on any change), so the street labels keep clear of it; the sizes are measured after
 * mount, after the fonts load and on resize. A label drops just below any `keepOut` point (group-local x, y, z
 * triples: the exit path's start) it would cover on screen.
 */
export function useLevelLabels(
  labels: LevelLabel[],
  group: RefObject<Group | null>,
  opacity: RefObject<number>,
  blockers: LabelBlockers,
  keepOut: RefObject<Float32Array>,
): void {
  const host = useThree((s) => s.gl.domElement.parentElement)
  const els = useRef<HTMLDivElement[]>([])
  const last = useRef<{ x: number; y: number; opacity: number; behind: boolean; w: number; h: number }[]>([])

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
    const state = made.map(() => ({ x: NaN, y: NaN, opacity: NaN, behind: false, w: 0, h: 0 }))
    // One read pass after the writes, so one layout; a label hidden behind the camera keeps its last size.
    const measure = () => {
      made.forEach((el, i) => {
        if (el.offsetWidth > 0) state[i]!.w = el.offsetWidth
        if (el.offsetHeight > 0) state[i]!.h = el.offsetHeight
      })
      blockers.version++
    }
    measure()
    els.current = made
    last.current = state
    let live = true
    document.fonts.ready.then(
      () => {
        if (live) measure()
      },
      (err: unknown) => console.error('Level labels: waiting for fonts failed', err),
    )
    window.addEventListener('resize', measure)
    return () => {
      live = false
      window.removeEventListener('resize', measure)
      for (const el of made) el.remove()
      els.current = []
      last.current = []
      blockers.count = 0
      blockers.version++
    }
  }, [host, labels, blockers])

  useFrame(({ camera, size }) => {
    const g = group.current
    const list = els.current
    if (!g || list.length === 0) return
    camera.updateMatrixWorld()
    g.updateWorldMatrix(true, false)
    camera.getWorldDirection(lookDir)
    const o = opacity.current
    const room = blockers.rects.length / RECT
    let count = 0
    let changed = false
    const pts = keepOut.current
    const n = Math.min(pts.length / 3, MAX_KEEP_OUT)
    for (let k = 0; k < n; k++) {
      world.set(pts[3 * k]!, pts[3 * k + 1]!, pts[3 * k + 2]!).applyMatrix4(g.matrixWorld).project(camera)
      const ok = world.z < 1
      keepXY[2 * k] = ok ? (world.x * size.width) / 2 + size.width / 2 : NaN
      keepXY[2 * k + 1] = ok ? (-world.y * size.height) / 2 + size.height / 2 : NaN
    }
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
      const y = clearLabelTop(x, (-world.y * size.height) / 2 + size.height / 2, prev.w, prev.h, keepXY, n, KEEP_OUT_PAD_PX)
      if (!(Math.abs(x - prev.x) <= EPS && Math.abs(y - prev.y) <= EPS)) {
        el.style.transform = `translate3d(${x}px,${y}px,0)`
        prev.x = x
        prev.y = y
      }
      // -translate-x-1/2: the label's top edge is centered on (x, y).
      if (count < room) changed = writeBlocker(blockers.rects, count++, x - prev.w / 2, y, x + prev.w / 2, y + prev.h) || changed
    }
    if (changed || count !== blockers.count) {
      blockers.count = count
      blockers.version++
    }
  })
}

/** Writes packed rect `r` and says whether it changed. */
function writeBlocker(rects: Float32Array, r: number, left: number, top: number, right: number, bottom: number): boolean {
  const o = r * RECT
  // Float32 storage: compare after the write's rounding.
  const was0 = rects[o]
  const was1 = rects[o + 1]
  const was2 = rects[o + 2]
  const was3 = rects[o + 3]
  rects[o] = left
  rects[o + 1] = top
  rects[o + 2] = right
  rects[o + 3] = bottom
  return rects[o] !== was0 || rects[o + 1] !== was1 || rects[o + 2] !== was2 || rects[o + 3] !== was3
}
