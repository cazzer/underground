import { useThree } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { useFocus } from '../lib/focus'
import { carMix } from '../lib/live/consist'
import { nearestTrain, trainScreenPoints, type TrainPickInput, type TrainPickSource } from '../lib/live/trainPick'
import type { Station } from '../lib/network'
import { choosePick, nearestStation, trainHitPx, type Pick, type ScreenPoint, type ToScreen } from '../lib/pick'
import { useTrainSelection } from '../lib/trainSelection'
import { cameraDistance, focusScaleFactor, markerRadiusPx, screenScale } from './cameraDistance'
import { MARKER_MIN_METERS } from './markerShape'

/** Pointer travel (px) above which a press is a pan, not a click. Fingertip taps drift more than a mouse. */
const CLICK_SLOP_PX = { mouse: 6, touch: 10 }

interface ScenePickerProps {
  stations: readonly Station[]
  /** The live layer's slots, while it is mounted. */
  trainPick: RefObject<TrainPickSource | null>
}

interface Press {
  x: number
  y: number
  touch: boolean
}

/**
 * Click and tap picking for stations and trains, in screen space: on a still click (never per frame) every
 * station and live train is projected to pixels and the nearest within its hit radius wins (a station
 * unless a train is clearly closer, or the station is already open). Listens on the canvas alongside MapControls without ever stopping
 * or preventing its events, and ignores multi-touch gestures. Hovering a target shows a pointer cursor.
 */
export function ScenePicker({ stations, trainPick }: ScenePickerProps) {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const { focusedId, select } = useFocus()
  const { selectTrain } = useTrainSelection()
  const positions = useMemo(() => stations.map((s) => s.pos), [stations])
  // Read at pick time, so a focus change doesn't re-subscribe the listeners mid-press.
  const focusedIndex = useRef(-1)
  useEffect(() => {
    focusedIndex.current = focusedId ? stations.findIndex((s) => s.id === focusedId) : -1
  }, [focusedId, stations])

  const picker = useMemo(() => {
    const v = new Vector3()
    const view = { width: 1, height: 1, left: 0, top: 0 }
    const click: ScreenPoint = { x: 0, y: 0 }
    const marker = { scale: 0, focusScale: 1 }
    /** One input object, refilled on each pick. */
    let input: TrainPickInput | null = null
    const toScreen: ToScreen = (x, y, z, out) => {
      v.set(x, y, z).project(get().camera)
      // Outside the clip depth range is behind the camera (or past `far`): never a target.
      if (v.z < -1 || v.z > 1) return false
      out.x = ((v.x + 1) / 2) * view.width
      out.y = ((1 - v.y) / 2) * view.height
      return true
    }
    // The markers as Stations.tsx draws them, so the whole drawn marker is a target when it outgrows STATION_HIT_PX.
    const radiusM = (i: number): number => (i === focusedIndex.current ? marker.scale * marker.focusScale : marker.scale)
    /** Canvas size (r3f measures it on resize) and this moment's pick input; null trains without a live layer. */
    const begin = (): TrainPickInput | null => {
      const state = get()
      view.width = state.size.width
      view.height = state.size.height
      view.left = state.size.left
      view.top = state.size.top
      const d = cameraDistance(state)
      marker.scale = screenScale(d, markerRadiusPx(d), MARKER_MIN_METERS)
      marker.focusScale = focusScaleFactor(d, marker.scale)
      const src = trainPick.current
      if (!src) return null
      input ??= { ...src, mix: 0, localS: 0 }
      input.table = src.table
      input.consistOf = src.consistOf
      input.y = src.y
      input.carHeightM = src.carHeightM
      input.mix = carMix(d)
      input.localS = performance.now() / 1000
      return input
    }
    const pickAt = (clientX: number, clientY: number, touch: boolean): Pick | null => {
      const trains = begin()
      click.x = clientX - view.left
      click.y = clientY - view.top
      const station = nearestStation(positions, toScreen, click, radiusM)
      const train = trains ? nearestTrain(trains, toScreen, click, trainHitPx(touch, station)) : null
      return choosePick(station, train, focusedIndex.current)
    }
    const trainAt = (key: string) => {
      const trains = begin()
      const slot = trains?.table.byKey.get(key)
      const p = trains && slot !== undefined ? trainScreenPoints(trains, slot, toScreen) : null
      if (!p) return null
      const client = (q: ScreenPoint | null) => (q ? { x: q.x + view.left, y: q.y + view.top } : null)
      return { ...client(p.dot)!, rear: client(p.rear), front: client(p.front) }
    }
    return { pickAt, trainAt }
  }, [get, positions, trainPick])

  useEffect(() => {
    const el = gl.domElement
    const presses = new Map<number, Press>()
    // A second finger makes it a gesture (pinch); nothing it ends selects anything.
    let gesture = false
    let hoverFrame = 0
    let hoverX = 0
    let hoverY = 0

    const onDown = (e: PointerEvent) => {
      // A primary pointer starts a fresh press: drop any left over from presses that ended off the window.
      if (e.isPrimary) {
        presses.clear()
        gesture = false
      }
      presses.set(e.pointerId, { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' })
      if (presses.size > 1) gesture = true
    }
    const onUp = (e: PointerEvent) => {
      const press = presses.get(e.pointerId)
      presses.delete(e.pointerId)
      const wasGesture = gesture
      if (presses.size === 0) gesture = false
      // Released off the canvas (over the HUD): not a click on the map.
      if (!press || wasGesture || e.button > 0 || e.target !== el) return
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP_PX[press.touch ? 'touch' : 'mouse']) return
      const pick = picker.pickAt(e.clientX, e.clientY, press.touch)
      if (pick?.kind === 'station') select(stations[pick.index]!.id)
      else if (pick?.kind === 'train') {
        const key = trainPick.current?.table.keys[pick.index]
        if (key) selectTrain(key)
      }
    }
    const onCancel = (e: PointerEvent) => {
      presses.delete(e.pointerId)
      if (presses.size === 0) gesture = false
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons !== 0) return
      hoverX = e.clientX
      hoverY = e.clientY
      if (hoverFrame !== 0) return
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0
        el.style.cursor = picker.pickAt(hoverX, hoverY, false) ? 'pointer' : ''
      })
    }
    const onLeave = () => {
      cancelAnimationFrame(hoverFrame)
      hoverFrame = 0
      el.style.cursor = ''
    }

    el.addEventListener('pointerdown', onDown)
    // On the window, so a press released off the canvas is still forgotten.
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      onLeave()
    }
  }, [gl, picker, stations, select, selectTrain, trainPick])

  // Dev-only test tooling: `__underground.trainAt(key)` gives a train's viewport position to click.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, trainAt: picker.trainAt }
    return () => {
      if (window.__underground) delete window.__underground.trainAt
    }
  }, [picker])

  return null
}
