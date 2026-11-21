import { useFrame } from '@react-three/fiber'
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, type Group, type InstancedMesh, type Mesh, type MeshBasicMaterial } from 'three'
import type { StationId } from '../data/schema'
import type { LiveLayer } from '../data/useLive'
import { clockNow } from '../lib/live/clock'
import { carMix, carsReach } from '../lib/live/consist'
import type { BandView } from '../lib/bandOffset'
import { createSlotTable, FADE_S, freeSlot, isLeaving, reconcileSlots, slotScale, stepSlot, TRAIN_CAPACITY } from '../lib/live/slots'
import type { TrainPickSource } from '../lib/live/trainPick'
import { createTrackPoint, trackPointInto } from '../lib/live/trackPoint'
import { trainRouteId } from '../lib/live/trainRoute'
import { interiorOpacity, veilWeight } from '../lib/interiorReveal'
import { writeInstanceMatrix } from '../lib/markerMatrices'
import type { Network } from '../lib/network'
import { hopDistance } from '../lib/realtime/position'
import { routeLineColor } from '../lib/routeColor'
import { tiltT } from '../lib/tilt'
import { useTrainSelection } from '../lib/trainSelection'
import { theme } from '../theme'
import { cameraDistance, getControls, screenScale } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { SpanCars } from './SpanCars'
import { TrainCars } from './TrainCars'
import { trainRadiusPx } from './trainSize'
import { useSpanCars } from './useSpanCars'
import { useTrainCars } from './useTrainCars'

const DOT_MIN_METERS = 2.5
/** The background-colored disc behind each dot, as a multiple of the dot's radius, so a dot stays visible on its own line. */
const HALO_RATIO = 1.5
const DOT_Y = 0.5
const SEGMENTS = 16
/** The selected train's dot (and its background halo, the gap) draws this much larger, with a rim of RIM_PX outside. */
const SELECTED_GROWTH = 1.6
const RIM_PX = 2.5

interface LiveTrainsProps extends LiveLayer {
  network: Network
  /** Filled while mounted, so a click can be tested against the trains as drawn. */
  trainPick: RefObject<TrainPickSource | null>
  /** The station whose interior is loaded (null for none): its platform trains draw above the veil as it reveals. */
  interiorStationId: StationId | null
  /** This frame's band view, written by SubwayLines before this frame runs: dots, cars and picks sit on the drawn bands. */
  view: BandView
}

/**
 * One instanced dot per live trip, plus a background-colored halo behind it. Slots are stable per
 * trip, so a dot keeps its color and smoothed position across polls; each frame evaluates the
 * poll's hop plan at the live clock and writes matrices without allocating. Zoomed in, each dot
 * unfolds into its train's cars (carMix): the dot shrinks by 1 - mix as the train lengthens by mix.
 */
export function LiveTrains({ trips, offsetS, patterns, network, trainPick, interiorStationId, view }: LiveTrainsProps) {
  const dots = useRef<InstancedMesh>(null)
  const halo = useRef<InstancedMesh>(null)
  // The selected train's dot is drawn on its own, above every other dot: rim, background gap, then the dot.
  const selected = useRef<Group>(null)
  const rim = useRef<Mesh>(null)
  const selectedHalo = useRef<Mesh>(null)
  const selectedDot = useRef<Mesh<CircleGeometry, MeshBasicMaterial>>(null)
  const cars = useTrainCars()
  const spanCars = useSpanCars(cars)
  const spans = (interiorStationId !== null && network.platformSpans.get(interiorStationId)) || null
  const table = useMemo(() => createSlotTable(TRAIN_CAPACITY), [])
  const { selectedKey } = useTrainSelection()
  /** The slot drawn as selected, -1 for none. Read once per frame. */
  const selectedSlot = useRef(-1)
  /** Each slot's dot color (shared Color objects), so the selected dot can take it without allocating. */
  const slotColors = useMemo(() => new Array<Color | null>(TRAIN_CAPACITY).fill(null), [])
  const point = useMemo(createTrackPoint, [])
  const range = useMemo(() => ({ start: 0, count: 0 }), [])
  const geometry = useMemo(
    () => ({
      dot: new CircleGeometry(1, SEGMENTS).rotateX(-Math.PI / 2),
      halo: new CircleGeometry(HALO_RATIO, SEGMENTS).rotateX(-Math.PI / 2),
      rim: new CircleGeometry(1, SEGMENTS).rotateX(-Math.PI / 2),
    }),
    [],
  )
  const colors = useMemo(
    () => ({
      // A mono line mix (amount 1) draws every line one color, so route colors would vanish into the lines: use the train color.
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
      geometry.rim.dispose()
    },
    [geometry],
  )

  const colorSlot = useCallback(
    (d: InstancedMesh, i: number) => {
      const trip = table.trips[i]
      const routeId = trip ? trainRouteId(trip, network.routeById, patterns) : null
      const color = (routeId !== null && colors.byRoute.get(routeId)) || colors.fallback
      d.setColorAt(i, color)
      slotColors[i] = color
      cars.setSlot(i, routeId, color)
    },
    [table, network, patterns, colors, cars, slotColors],
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
    spanCars.prepare()
    for (let i = 0; i < TRAIN_CAPACITY; i++) colorSlot(d, i)
    cars.setSelected(selectedSlot.current)
    d.instanceColor!.needsUpdate = true
    d.count = h.count = 0
  }, [colorSlot, cars, spanCars])

  useLayoutEffect(() => {
    trainPick.current = { table, consistOf: cars.consistOf, y: DOT_Y, carHeightM: cars.carHeightM, view }
    return () => {
      trainPick.current = null
    }
  }, [trainPick, table, cars, view])

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

  // After the reconcile above, so a slot reused by another trip since the last poll loses the highlight.
  useLayoutEffect(() => {
    const slot = selectedKey === null ? -1 : (table.byKey.get(selectedKey) ?? -1)
    if (slot === selectedSlot.current) return
    cars.setSelected(slot)
    selectedSlot.current = slot
  }, [selectedKey, trips, table, cars])

  useFrame((state, dt) => {
    const d = dots.current
    const h = halo.current
    const r = rim.current
    const g = selected.current
    const sh = selectedHalo.current
    const sd = selectedDot.current
    if (!d || !h || !r || !g || !sh || !sd) return
    const perfMs = performance.now()
    const now = clockNow(offsetS, perfMs)
    const localS = perfMs / 1000
    const camera = cameraDistance(state)
    const mix = carMix(camera)
    const scale = screenScale(camera, trainRadiusPx(camera), DOT_MIN_METERS) * (1 - mix)
    const carsOn = mix > 0
    if (carsOn) cars.beginFrame(camera, view.depth)
    const center = getControls(state)?.target
    const reach = carsReach(camera, tiltT(camera))
    const out = d.instanceMatrix.array as Float32Array
    const sel = selectedSlot.current
    let dotScale = 0
    let rimRadius = 0

    for (let i = 0; i < table.high; i++) {
      const trip = table.trips[i]
      if (!trip) continue
      const shown = stepSlot(table, i, hopDistance(trip.plan, trip.geometry, now), now, localS, dt)
      const drawn = table.drawGeometry[i]!
      // On its band, at the track's height: below the street where the line descends to a station.
      trackPointInto(drawn, shown, view, point)
      const y = DOT_Y + point.y
      const k = slotScale(table, i, localS, FADE_S)
      if (k === 0 && isLeaving(table, i)) {
        writeInstanceMatrix(out, i, 0, 0, 0, 0)
        cars.clear(i)
        freeSlot(table, i)
      } else {
        if (i === sel) {
          // Its instance is hidden; the selected meshes draw it above the rest.
          writeInstanceMatrix(out, i, 0, 0, 0, 0)
          dotScale = scale * k * SELECTED_GROWTH
          // Fades out with the dot as the cars (which carry their own rim) unfold.
          rimRadius = dotScale * HALO_RATIO + screenScale(camera, RIM_PX, 0) * k * (1 - mix)
          g.position.set(point.x, y, point.z)
          const color = slotColors[i]
          if (color) sd.material.color.copy(color)
        } else writeInstanceMatrix(out, i, point.x, y, point.z, scale * k)
        if (!carsOn) continue
        const dx = center ? point.x - center.x : 0
        const dz = center ? point.z - center.z : 0
        if (dx * dx + dz * dz < reach * reach) {
          cars.writeTrain(i, drawn, view, shown, mix, k)
        } else cars.hide(i)
      }
    }
    h.instanceMatrix.array.set(out)
    g.visible = rimRadius > 0
    if (rimRadius > 0) {
      r.scale.setScalar(rimRadius)
      sh.scale.setScalar(Math.max(dotScale, 1e-6))
      sd.scale.setScalar(Math.max(dotScale, 1e-6))
    }
    d.count = h.count = mix >= 1 ? 0 : table.high
    cars.commit(table.high, carsOn)
    const reveal = interiorOpacity(camera)
    spanCars.write(table, spans, reveal, veilWeight(reveal, view.depth), mix, localS, sel, slotColors, cars.consistOf)
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
      <group ref={selected} visible={false}>
        <mesh ref={rim} geometry={geometry.rim} frustumCulled={false} renderOrder={RENDER_ORDER.selectedTrainRim}>
          <meshBasicMaterial color={theme.trainSelectedRim} transparent depthTest={false} depthWrite={false} />
        </mesh>
        <mesh ref={selectedHalo} geometry={geometry.halo} frustumCulled={false} renderOrder={RENDER_ORDER.selectedTrainHalo}>
          <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
        </mesh>
        <mesh ref={selectedDot} geometry={geometry.dot} frustumCulled={false} renderOrder={RENDER_ORDER.selectedTrain}>
          <meshBasicMaterial transparent depthTest={false} depthWrite={false} />
        </mesh>
      </group>
      <TrainCars layer={cars} />
      <SpanCars layer={spanCars} />
    </>
  )
}
