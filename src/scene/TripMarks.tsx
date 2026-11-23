import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, RingGeometry, Shape, ShapeGeometry, type InstancedMesh, type MeshBasicMaterial } from 'three'
import { interiorOpacity } from '../lib/interiorReveal'
import { dimLineRgbInto, srgb01 } from '../lib/lineDim'
import { writeInstanceMatrix } from '../lib/markerMatrices'
import type { Ground } from '../lib/projection'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { tripMarkRadius, type ReticleClearance } from '../lib/tripMarkSize'
import type { TripMark } from '../lib/tripMarks'
import { theme } from '../theme'
import { cameraDistance, screenScale, tripMarkRadiusPx } from './cameraDistance'
import { reticleClearanceInto } from './hereShape'
import { MARKER_Y, SEGMENTS, SKIP_CROSS_HALF, SKIP_CROSS_WIDTH, TRIP_MARK_DOT, TRIP_MARK_HALO, TRIP_MARK_INNER, TRIP_MARK_MIN_METERS } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

const NO_MARKS: readonly TripMark[] = []
const BACKGROUND = srgb01(theme.background)

/** Whose marks these are: a trip's (theme.exitPath) or a picked service change's (theme.changeSkipMark). */
export type MarkLook = 'trip' | 'change'

const markColor = (look: MarkLook): string => (look === 'change' ? theme.changeSkipMark : theme.exitPath)

/**
 * An X filling a skip mark's ring: two arms SKIP_CROSS_WIDTH wide, each reaching SKIP_CROSS_HALF from the center (the
 * ring's inner edge), as one outline (a plus turned 45 degrees), so no part draws twice while it fades. Flat on the ground.
 */
function crossGeometry(): ShapeGeometry {
  const w = SKIP_CROSS_WIDTH / 2
  const l = SKIP_CROSS_HALF
  const outline: [number, number][] = [[w, l], [-w, l], [-w, w], [-l, w], [-l, -w], [-w, -w], [-w, -l], [w, -l], [w, -w], [l, -w], [l, w], [w, w]]
  const shape = new Shape()
  outline.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  return new ShapeGeometry(shape).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2)
}

interface TripMarksProps {
  /** Where the trip boards, changes and alights (TripRouteDraw.marks; held by SubwayLines while it eases out). */
  marks: readonly TripMark[] | null
  /** Stations the focused, loaded interior covers: their marks fade out as it reveals (it marks them itself). */
  hidden: readonly string[]
  /** The location fix's ground point while its reticle shows (read only, to keep the start ring clear of it); null for none. */
  fix: Ground | null
  /** This frame's look, written by SubwayLines at -0.25. */
  levels: EmphasisLevels
  /** The route view's kind (TripRouteDraw.kind): its marks' colour. */
  look: MarkLook
}

/**
 * A theme.exitPath ring round each station the trip boards, changes or alights at, over the station markers and under
 * the trains: a background halo disc under it, and a dot filling the start and the end (a change stays hollow and draws
 * at CHANGE_MARK_SHARE of their size). A start under the location reticle grows past it. The marks the focused interior
 * covers draw as a second set that fades by 1 − interiorOpacity, so they go as the interior comes in, not when it loads.
 * A service change's skipped station (role `skip`, look `change`) is a theme.changeSkipMark ring at full size with a
 * cross in it and no dot: the skip reads by shape, not colour alone. No event handlers and not in ScenePicker, so a
 * mark never takes a pick.
 */
export function TripMarks({ marks, hidden, fix, levels, look }: TripMarksProps) {
  const list = marks ?? NO_MARKS
  const sets = useMemo(() => {
    const ids = new Set(hidden)
    return { open: list.filter((m) => !ids.has(m.stationId)), covered: list.filter((m) => ids.has(m.stationId)) }
  }, [list, hidden])
  return (
    <>
      <MarkSet marks={sets.open} covered={false} fix={fix} levels={levels} look={look} />
      <MarkSet marks={sets.covered} covered fix={fix} levels={levels} look={look} />
    </>
  )
}

interface MarkSetProps {
  marks: readonly TripMark[]
  /** Under the focused interior: fades out as it reveals. */
  covered: boolean
  fix: Ground | null
  levels: EmphasisLevels
  look: MarkLook
}

/**
 * Four InstancedMeshes (halo, ring, dot, cross). The matrices are rewritten only when the scale, the reticle's size, the fix or the marks change,
 * the color only when the list view's dim or the look does; opacity per frame. No allocation per frame.
 */
function MarkSet({ marks, covered, fix, levels, look }: MarkSetProps) {
  const halo = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const dot = useRef<InstancedMesh>(null)
  const cross = useRef<InstancedMesh>(null)
  const geometry = useMemo(
    () => ({
      halo: new CircleGeometry(TRIP_MARK_HALO, SEGMENTS).rotateX(-Math.PI / 2),
      ring: new RingGeometry(TRIP_MARK_INNER, 1, SEGMENTS).rotateX(-Math.PI / 2),
      dot: new CircleGeometry(TRIP_MARK_DOT, SEGMENTS).rotateX(-Math.PI / 2),
      cross: crossGeometry(),
    }),
    [],
  )
  useEffect(
    () => () => {
      geometry.halo.dispose()
      geometry.ring.dispose()
      geometry.dot.dispose()
      geometry.cross.dispose()
    },
    [geometry],
  )
  const color = markColor(look)
  const full = useMemo(() => {
    const c = new Color(color)
    return new Float32Array([c.r, c.g, c.b])
  }, [color])
  const tint = useMemo(() => new Float32Array(3), [])
  const reticle = useMemo<ReticleClearance>(() => ({ outerM: 0, gapM: 0 }), [])
  /** What the matrices were last written for: every input of tripMarkRadius, so they never go stale. */
  const drawn = useRef<{ base: number; outerM: number; gapM: number; fix: Ground | null; marks: readonly TripMark[] | null; dim: number }>({
    base: NaN,
    outerM: NaN,
    gapM: NaN,
    fix: null,
    marks: null,
    dim: NaN,
  })

  useLayoutEffect(() => {
    for (const m of [halo.current, ring.current, dot.current, cross.current]) m?.instanceMatrix.setUsage(DynamicDrawUsage)
    // A new count remounts the meshes, whose materials start at the full color again; a new look recolors them.
    drawn.current.marks = null
    drawn.current.dim = NaN
  }, [marks, look])

  useFrame((state) => {
    const h = halo.current
    const r = ring.current
    const d = dot.current
    const x = cross.current
    if (!h || !r || !d || !x) return
    const distance = cameraDistance(state)
    const opacity = levels.tripOpacity * (covered ? 1 - interiorOpacity(distance) : 1)
    const visible = levels.tripVisible && opacity > 0
    h.visible = r.visible = d.visible = x.visible = visible
    if (!visible) return
    const hm = h.material as MeshBasicMaterial
    const rm = r.material as MeshBasicMaterial
    const dm = d.material as MeshBasicMaterial
    const xm = x.material as MeshBasicMaterial
    hm.opacity = rm.opacity = dm.opacity = xm.opacity = opacity
    const last = drawn.current
    if (levels.tripDim !== last.dim) {
      last.dim = levels.tripDim
      dimLineRgbInto(tint, full, BACKGROUND, levels.tripDim)
      rm.color.setRGB(tint[0]!, tint[1]!, tint[2]!)
      dm.color.copy(rm.color)
      xm.color.copy(rm.color)
    }
    const base = screenScale(distance, tripMarkRadiusPx(distance), TRIP_MARK_MIN_METERS)
    reticleClearanceInto(reticle, distance)
    if (base === last.base && reticle.outerM === last.outerM && reticle.gapM === last.gapM && fix === last.fix && marks === last.marks) return
    last.base = base
    last.outerM = reticle.outerM
    last.gapM = reticle.gapM
    last.fix = fix
    last.marks = marks
    const hs = h.instanceMatrix.array as Float32Array
    const ds = d.instanceMatrix.array as Float32Array
    const xs = x.instanceMatrix.array as Float32Array
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i]!
      const radius = tripMarkRadius(m.role, base, m.pos, fix, reticle)
      const skip = m.role === 'skip'
      writeInstanceMatrix(hs, i, m.pos.x, MARKER_Y, m.pos.z, radius)
      writeInstanceMatrix(ds, i, m.pos.x, MARKER_Y, m.pos.z, m.role === 'change' || skip ? 0 : radius)
      writeInstanceMatrix(xs, i, m.pos.x, MARKER_Y, m.pos.z, skip ? radius : 0)
    }
    r.instanceMatrix.array.set(hs)
    h.instanceMatrix.needsUpdate = r.instanceMatrix.needsUpdate = d.instanceMatrix.needsUpdate = x.instanceMatrix.needsUpdate = true
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
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`dot-${n}`} ref={dot} args={[geometry.dot, undefined, n]} frustumCulled={false} renderOrder={RENDER_ORDER.tripMarkDot}>
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh key={`cross-${n}`} ref={cross} args={[geometry.cross, undefined, n]} frustumCulled={false} renderOrder={RENDER_ORDER.changeSkipCross}>
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
    </>
  )
}
