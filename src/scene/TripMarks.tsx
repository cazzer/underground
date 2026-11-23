import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, RingGeometry, type InstancedMesh, type MeshBasicMaterial } from 'three'
import { interiorOpacity } from '../lib/interiorReveal'
import { dimLineRgbInto, srgb01 } from '../lib/lineDim'
import { writeInstanceMatrix } from '../lib/markerMatrices'
import type { Ground } from '../lib/projection'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { markRadius, startRadiusNearFix } from '../lib/tripMarkSize'
import type { TripMark } from '../lib/tripMarks'
import { theme } from '../theme'
import { cameraDistance, screenScale, tripMarkRadiusPx } from './cameraDistance'
import { RETICLE_MIN_METERS, RETICLE_PX, TICK_OUTER } from './hereShape'
import { MARKER_Y, SEGMENTS, TRIP_MARK_DOT, TRIP_MARK_HALO, TRIP_MARK_INNER, TRIP_MARK_MIN_METERS } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

const NO_MARKS: readonly TripMark[] = []
const BACKGROUND = srgb01(theme.background)
/** The grown start ring ends this far outside the location reticle. */
const RETICLE_GAP_PX = 2

interface TripMarksProps {
  /** Where the trip boards, changes and alights (TripRouteDraw.marks; held by SubwayLines while it eases out). */
  marks: readonly TripMark[] | null
  /** Stations the focused, loaded interior covers: their marks fade out as it reveals (it marks them itself). */
  hidden: readonly string[]
  /** The location fix's ground point while its reticle shows (read only, to keep the start ring clear of it); null for none. */
  fix: Ground | null
  /** This frame's look, written by SubwayLines at -0.25. */
  levels: EmphasisLevels
}

/**
 * A theme.exitPath ring round each station the trip boards, changes or alights at, over the station markers and under
 * the trains: a background halo disc under it, and a dot filling the start and the end (a change stays hollow and draws
 * at CHANGE_MARK_SHARE of their size). A start under the location reticle grows past it. The marks the focused interior
 * covers draw as a second set that fades by 1 − interiorOpacity, so they go as the interior comes in, not when it loads.
 * No event handlers and not in ScenePicker, so a mark never takes a pick.
 */
export function TripMarks({ marks, hidden, fix, levels }: TripMarksProps) {
  const list = marks ?? NO_MARKS
  const sets = useMemo(() => {
    const ids = new Set(hidden)
    return { open: list.filter((m) => !ids.has(m.stationId)), covered: list.filter((m) => ids.has(m.stationId)) }
  }, [list, hidden])
  return (
    <>
      <MarkSet marks={sets.open} covered={false} fix={fix} levels={levels} />
      <MarkSet marks={sets.covered} covered fix={fix} levels={levels} />
    </>
  )
}

interface MarkSetProps {
  marks: readonly TripMark[]
  /** Under the focused interior: fades out as it reveals. */
  covered: boolean
  fix: Ground | null
  levels: EmphasisLevels
}

/**
 * Three InstancedMeshes (halo, ring, dot). The matrices are rewritten only when the scale, the fix or the marks change,
 * the color only when the list view's dim does; opacity per frame. No allocation per frame.
 */
function MarkSet({ marks, covered, fix, levels }: MarkSetProps) {
  const halo = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const dot = useRef<InstancedMesh>(null)
  const geometry = useMemo(
    () => ({
      halo: new CircleGeometry(TRIP_MARK_HALO, SEGMENTS).rotateX(-Math.PI / 2),
      ring: new RingGeometry(TRIP_MARK_INNER, 1, SEGMENTS).rotateX(-Math.PI / 2),
      dot: new CircleGeometry(TRIP_MARK_DOT, SEGMENTS).rotateX(-Math.PI / 2),
    }),
    [],
  )
  useEffect(
    () => () => {
      geometry.halo.dispose()
      geometry.ring.dispose()
      geometry.dot.dispose()
    },
    [geometry],
  )
  const pink = useMemo(() => {
    const c = new Color(theme.exitPath)
    return new Float32Array([c.r, c.g, c.b])
  }, [])
  const tint = useMemo(() => new Float32Array(3), [])
  const drawn = useRef<{ base: number; fix: Ground | null; marks: readonly TripMark[] | null; dim: number }>({ base: NaN, fix: null, marks: null, dim: NaN })

  useLayoutEffect(() => {
    for (const m of [halo.current, ring.current, dot.current]) m?.instanceMatrix.setUsage(DynamicDrawUsage)
    // A new count remounts the meshes, whose materials start at the full color again.
    drawn.current.marks = null
    drawn.current.dim = NaN
  }, [marks])

  useFrame((state) => {
    const h = halo.current
    const r = ring.current
    const d = dot.current
    if (!h || !r || !d) return
    const distance = cameraDistance(state)
    const opacity = levels.tripOpacity * (covered ? 1 - interiorOpacity(distance) : 1)
    const visible = levels.tripVisible && opacity > 0
    h.visible = r.visible = d.visible = visible
    if (!visible) return
    const hm = h.material as MeshBasicMaterial
    const rm = r.material as MeshBasicMaterial
    const dm = d.material as MeshBasicMaterial
    hm.opacity = rm.opacity = dm.opacity = opacity
    const last = drawn.current
    if (levels.tripDim !== last.dim) {
      last.dim = levels.tripDim
      dimLineRgbInto(tint, pink, BACKGROUND, levels.tripDim)
      rm.color.setRGB(tint[0]!, tint[1]!, tint[2]!)
      dm.color.copy(rm.color)
    }
    const base = screenScale(distance, tripMarkRadiusPx(distance), TRIP_MARK_MIN_METERS)
    if (base === last.base && fix === last.fix && marks === last.marks) return
    last.base = base
    last.fix = fix
    last.marks = marks
    const reticleOuter = TICK_OUTER * screenScale(distance, RETICLE_PX, RETICLE_MIN_METERS)
    const gap = screenScale(distance, RETICLE_GAP_PX, 0)
    const hs = h.instanceMatrix.array as Float32Array
    const ds = d.instanceMatrix.array as Float32Array
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]!
      let radius = markRadius(m.role, base)
      if (m.role === 'start') radius = startRadiusNearFix(radius, m.pos, fix, reticleOuter, gap)
      writeInstanceMatrix(hs, i, m.pos.x, MARKER_Y, m.pos.z, radius)
      writeInstanceMatrix(ds, i, m.pos.x, MARKER_Y, m.pos.z, m.role === 'change' ? 0 : radius)
    }
    r.instanceMatrix.array.set(hs)
    h.instanceMatrix.needsUpdate = r.instanceMatrix.needsUpdate = d.instanceMatrix.needsUpdate = true
  })

  if (marks.length === 0) return null
  const n = marks.length
  // `args` are read once, when a mesh is made, so the count keys it: a new count makes new meshes.
  return (
    <>
      <instancedMesh key={`halo-${n}`} ref={halo} args={[geometry.halo, undefined, n]} frustumCulled={false} renderOrder={RENDER_ORDER.tripMarkHalo}>
        <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`ring-${n}`} ref={ring} args={[geometry.ring, undefined, n]} frustumCulled={false} renderOrder={RENDER_ORDER.tripMark}>
        <meshBasicMaterial color={theme.exitPath} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`dot-${n}`} ref={dot} args={[geometry.dot, undefined, n]} frustumCulled={false} renderOrder={RENDER_ORDER.tripMarkDot}>
        <meshBasicMaterial color={theme.exitPath} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
    </>
  )
}
