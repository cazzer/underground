import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, RingGeometry, type InstancedMesh, type MeshBasicMaterial } from 'three'
import { dimLineRgbInto, srgb01 } from '../lib/lineDim'
import { writeMarkerMatrices } from '../lib/markerMatrices'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import type { TripMark } from '../lib/tripMarks'
import { theme } from '../theme'
import { cameraDistance, screenScale, tripMarkRadiusPx } from './cameraDistance'
import { MARKER_Y, SEGMENTS, TRIP_MARK_DOT, TRIP_MARK_HALO, TRIP_MARK_INNER, TRIP_MARK_MIN_METERS } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

const NO_MARKS: readonly TripMark[] = []
const BACKGROUND = srgb01(theme.background)

interface TripMarksProps {
  /** Where the trip boards, changes and alights (TripRouteDraw.marks; held by SubwayLines while it eases out). */
  marks: readonly TripMark[] | null
  /** Stations whose mark hides: the focused station's, and its complex's, while its interior is shown (it marks them). */
  hidden: readonly string[]
  /** This frame's look, written by SubwayLines at -0.25. */
  levels: EmphasisLevels
}

/**
 * A theme.exitPath ring round each station the trip boards, changes or alights at, over the station markers and under
 * the trains: a background halo under it, and a dot filling the start and the end (a change stays hollow). Instanced;
 * the matrices are rewritten only when the scale or the hidden marks change, the color only when the list view's dim
 * does. Fades in by opacity with the trip. No event handlers and not in ScenePicker, so a mark never takes a pick.
 */
export function TripMarks({ marks, hidden, levels }: TripMarksProps) {
  const list = marks ?? NO_MARKS
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
  const positions = useMemo(() => list.map((m) => m.pos), [list])
  /** Mark indices collapsed in every mesh, and in the dot's also every change (hollow). */
  const collapsed = useMemo(() => {
    const ids = new Set(hidden)
    const all: number[] = []
    const dots: number[] = []
    list.forEach((m, i) => {
      if (ids.has(m.stationId)) all.push(i)
      if (ids.has(m.stationId) || m.role === 'change') dots.push(i)
    })
    return { all, dots }
  }, [list, hidden])
  const pink = useMemo(() => {
    const c = new Color(theme.exitPath)
    return new Float32Array([c.r, c.g, c.b])
  }, [])
  const tint = useMemo(() => new Float32Array(3), [])
  const drawn = useRef({ scale: NaN, collapsed: null as typeof collapsed | null, dim: NaN })

  useLayoutEffect(() => {
    for (const m of [halo.current, ring.current, dot.current]) m?.instanceMatrix.setUsage(DynamicDrawUsage)
    // A new count remounts the meshes, whose materials start at the full color again.
    drawn.current.scale = NaN
    drawn.current.dim = NaN
  }, [list])

  useFrame((state) => {
    const h = halo.current
    const r = ring.current
    const d = dot.current
    if (!h || !r || !d) return
    const visible = levels.tripVisible
    h.visible = r.visible = d.visible = visible
    if (!visible) return
    const hm = h.material as MeshBasicMaterial
    const rm = r.material as MeshBasicMaterial
    const dm = d.material as MeshBasicMaterial
    hm.opacity = rm.opacity = dm.opacity = levels.tripOpacity
    const last = drawn.current
    if (levels.tripDim !== last.dim) {
      last.dim = levels.tripDim
      dimLineRgbInto(tint, pink, BACKGROUND, levels.tripDim)
      rm.color.setRGB(tint[0]!, tint[1]!, tint[2]!)
      dm.color.copy(rm.color)
    }
    const distance = cameraDistance(state)
    const scale = screenScale(distance, tripMarkRadiusPx(distance), TRIP_MARK_MIN_METERS)
    if (scale === last.scale && collapsed === last.collapsed) return
    last.scale = scale
    last.collapsed = collapsed
    const out = h.instanceMatrix.array as Float32Array
    writeMarkerMatrices(out, positions, MARKER_Y, scale, collapsed.all)
    r.instanceMatrix.array.set(out)
    writeMarkerMatrices(d.instanceMatrix.array as Float32Array, positions, MARKER_Y, scale, collapsed.dots)
    h.instanceMatrix.needsUpdate = r.instanceMatrix.needsUpdate = d.instanceMatrix.needsUpdate = true
  })

  if (list.length === 0) return null
  const n = list.length
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
