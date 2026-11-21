import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, type InstancedMesh } from 'three'
import type { LiveLayer } from '../data/useLive'
import { clockNow } from '../lib/live/clock'
import { carMix } from '../lib/live/consist'
import { createSlotTable, FADE_S, freeSlot, isLeaving, reconcileSlots, slotScale, stepSlot, TRAIN_CAPACITY } from '../lib/live/slots'
import { trainRouteId } from '../lib/live/trainRoute'
import { writeInstanceMatrix } from '../lib/markerMatrices'
import type { Network } from '../lib/network'
import { hopDistance } from '../lib/realtime/position'
import { pointAtDistanceInto } from '../lib/realtime/polyline'
import { routeLineColor } from '../lib/routeColor'
import { theme } from '../theme'
import { cameraDistance, screenScale } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { TrainCars } from './TrainCars'
import { trainRadiusPx } from './trainSize'
import { useTrainCars } from './useTrainCars'

const DOT_MIN_METERS = 2.5
/** The background-colored disc behind each dot, as a multiple of the dot's radius, so a dot stays visible on its own line. */
const HALO_RATIO = 1.5
const DOT_Y = 0.5
const SEGMENTS = 16

interface LiveTrainsProps extends LiveLayer {
  network: Network
}

/**
 * One instanced dot per live trip, plus a background-colored halo behind it. Slots are stable per
 * trip, so a dot keeps its color and smoothed position across polls; each frame evaluates the
 * poll's hop plan at the live clock and writes matrices without allocating. Zoomed in, each dot
 * unfolds into its train's cars (carMix): the dot shrinks by 1 - mix as the train lengthens by mix.
 */
export function LiveTrains({ trips, offsetS, patterns, network }: LiveTrainsProps) {
  const dots = useRef<InstancedMesh>(null)
  const halo = useRef<InstancedMesh>(null)
  const cars = useTrainCars()
  const table = useMemo(() => createSlotTable(TRAIN_CAPACITY), [])
  const point = useMemo(() => ({ x: 0, z: 0 }), [])
  const range = useMemo(() => ({ start: 0, count: 0 }), [])
  const geometry = useMemo(
    () => ({
      dot: new CircleGeometry(1, SEGMENTS).rotateX(-Math.PI / 2),
      halo: new CircleGeometry(HALO_RATIO, SEGMENTS).rotateX(-Math.PI / 2),
    }),
    [],
  )
  const colors = useMemo(
    () => ({
      // A mono theme (terminal) draws every line one color, so route colors would vanish into the lines: use the train color.
      byRoute: new Map(
        theme.routeLineMix.amount >= 1
          ? []
          : network.routes.map((r) => [r.id, new Color(routeLineColor(r.color, theme.routeLineMix, theme.background))]),
      ),
      fallback: new Color(theme.train),
    }),
    [network],
  )

  useEffect(
    () => () => {
      geometry.dot.dispose()
      geometry.halo.dispose()
    },
    [geometry],
  )

  const colorSlot = useCallback(
    (d: InstancedMesh, i: number) => {
      const trip = table.trips[i]
      const routeId = trip ? trainRouteId(trip, network.routeById, patterns) : null
      const color = (routeId !== null && colors.byRoute.get(routeId)) || colors.fallback
      d.setColorAt(i, color)
      cars.setSlot(i, routeId, color)
    },
    [table, network, patterns, colors, cars],
  )

  // Instance colors must exist before the first frame, or the shader compiles without them.
  // Every slot is colored from the table, so a remount (StrictMode) restores the colors it resets.
  useLayoutEffect(() => {
    const d = dots.current
    const h = halo.current
    if (!d || !h) return
    d.instanceMatrix.setUsage(DynamicDrawUsage)
    h.instanceMatrix.setUsage(DynamicDrawUsage)
    cars.prepare()
    for (let i = 0; i < TRAIN_CAPACITY; i++) colorSlot(d, i)
    d.instanceColor!.needsUpdate = true
    d.count = h.count = 0
  }, [colorSlot, cars])

  useLayoutEffect(() => {
    const d = dots.current
    if (!d) return
    const perfMs = performance.now()
    const { needsColor, overflow } = reconcileSlots(table, trips, perfMs / 1000, {
      dataNow: clockNow(offsetS, perfMs),
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
    for (const i of needsColor) colorSlot(d, i)
    if (needsColor.length > 0) d.instanceColor!.needsUpdate = true
    if (overflow > 0) console.warn(`Live trains: ${overflow} trips over the ${TRAIN_CAPACITY}-slot capacity are not drawn`)
  }, [trips, offsetS, table, colorSlot])

  useFrame((state, dt) => {
    const d = dots.current
    const h = halo.current
    if (!d || !h) return
    const perfMs = performance.now()
    const now = clockNow(offsetS, perfMs)
    const localS = perfMs / 1000
    const camera = cameraDistance(state)
    const mix = carMix(camera)
    const scale = screenScale(camera, trainRadiusPx(camera), DOT_MIN_METERS) * (1 - mix)
    const carsOn = mix > 0
    if (carsOn) cars.beginFrame(camera)
    const out = d.instanceMatrix.array as Float32Array

    for (let i = 0; i < table.high; i++) {
      const trip = table.trips[i]
      if (!trip) continue
      const shown = stepSlot(table, i, hopDistance(trip.plan, trip.geometry, now), now, localS, dt)
      pointAtDistanceInto(table.drawGeometry[i]!.line, shown, point)
      const k = slotScale(table, i, localS, FADE_S)
      if (k === 0 && isLeaving(table, i)) {
        writeInstanceMatrix(out, i, 0, 0, 0, 0)
        cars.clear(i)
        freeSlot(table, i)
      } else {
        writeInstanceMatrix(out, i, point.x, DOT_Y, point.z, scale * k)
        if (carsOn) cars.writeTrain(i, table.drawGeometry[i]!.line, shown, mix, k)
      }
    }
    h.instanceMatrix.array.set(out)
    d.count = h.count = mix >= 1 ? 0 : table.high
    cars.commit(table.high, carsOn)
    // Upload only the slots in use. three empties the ranges after each upload, so the (reused) range goes back in.
    range.count = table.high * 16
    d.instanceMatrix.updateRanges.push(range)
    h.instanceMatrix.updateRanges.push(range)
    d.instanceMatrix.needsUpdate = true
    h.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        ref={halo}
        args={[geometry.halo, undefined, TRAIN_CAPACITY]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.trainHalo}
      >
        <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={dots}
        args={[geometry.dot, undefined, TRAIN_CAPACITY]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.trains}
      >
        {/* Default white material: the per-instance colors are the dot colors. */}
        <meshBasicMaterial transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <TrainCars layer={cars} />
    </>
  )
}
