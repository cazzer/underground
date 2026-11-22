import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, RingGeometry, type InstancedMesh } from 'three'
import { useFocus } from '../lib/focus'
import { writeMarkerMatrices } from '../lib/markerMatrices'
import type { Station } from '../lib/network'
import { theme } from '../theme'
import { cameraDistance, markerRadiusPx, screenScale } from './cameraDistance'
import { FocusRing } from './FocusRing'
import { MARKER_MIN_METERS, MARKER_Y, RING_INNER, SEGMENTS } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

interface StationsProps {
  stations: readonly Station[]
  /** Draw the focused station's marker too (it has no interior, or its load failed). */
  focusedMarker: boolean
  /** The focused station's complex siblings whose interior is loaded: their markers hide with the focused one's. */
  hiddenSiblings: readonly string[]
}

/**
 * All station markers as two instanced meshes (fill, then ring). The focused station's marker is hidden
 * (its panel and interior mark it), and so are its complex siblings' (the one interior covers them); they stay
 * pickable, since ScenePicker picks in screen space. A station with no
 * interior (`focusedMarker`) keeps its marker, plus a `theme.stationFocus` FocusRing above the trains.
 */
export function Stations({ stations, focusedMarker, hiddenSiblings }: StationsProps) {
  const fill = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const { focusedId } = useFocus()
  const focusedIndex = useMemo(
    () => (focusedId ? stations.findIndex((s) => s.id === focusedId) : -1),
    [stations, focusedId],
  )
  /** Marker instances to collapse: the focused one unless it is drawn as the fallback, and every hidden sibling. */
  const hidden = useMemo(() => {
    const indexOf = new Map(stations.map((s, i) => [s.id, i]))
    const out: number[] = []
    if (focusedIndex >= 0 && !focusedMarker) out.push(focusedIndex)
    for (const id of hiddenSiblings) {
      const i = indexOf.get(id)
      if (i !== undefined) out.push(i)
    }
    return out
  }, [stations, focusedIndex, focusedMarker, hiddenSiblings])
  const positions = useMemo(() => stations.map((s) => s.pos), [stations])
  // Pre-rotated flat on the ground, so each instance matrix is only scale plus translate.
  const geometry = useMemo(
    () => ({
      fill: new CircleGeometry(1, SEGMENTS).rotateX(-Math.PI / 2),
      ring: new RingGeometry(RING_INNER, 1, SEGMENTS).rotateX(-Math.PI / 2),
    }),
    [],
  )
  const stroke = useMemo(() => new Color(theme.stationStroke), [])
  const drawn = useRef<{ scale: number; hidden: readonly number[] | null }>({ scale: NaN, hidden: null })

  useEffect(
    () => () => {
      geometry.fill.dispose()
      geometry.ring.dispose()
    },
    [geometry],
  )

  // Ring colors must exist before the first frame, or the shader compiles without instance colors.
  useLayoutEffect(() => {
    const f = fill.current
    const r = ring.current
    if (!f || !r) return
    f.instanceMatrix.setUsage(DynamicDrawUsage)
    r.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < stations.length; i++) r.setColorAt(i, stroke)
    r.instanceColor!.needsUpdate = true
    drawn.current.scale = NaN
  }, [stations, stroke])

  useFrame((state) => {
    const f = fill.current
    const r = ring.current
    if (!f || !r) return
    const d = cameraDistance(state)
    const scale = screenScale(d, markerRadiusPx(d), MARKER_MIN_METERS)
    const last = drawn.current
    if (scale === last.scale && hidden === last.hidden) return
    last.scale = scale
    last.hidden = hidden
    // Scale 0 collapses a hidden instance, so neither its fill nor its ring draws.
    writeMarkerMatrices(f.instanceMatrix.array as Float32Array, positions, MARKER_Y, scale, hidden)
    r.instanceMatrix.array.set(f.instanceMatrix.array)
    f.instanceMatrix.needsUpdate = true
    r.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        ref={fill}
        args={[geometry.fill, undefined, stations.length]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.stationFill}
      >
        <meshBasicMaterial color={theme.stationFill} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={ring}
        args={[geometry.ring, undefined, stations.length]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.stationRing}
      >
        {/* Default white material: the per-instance colors are the ring colors. */}
        <meshBasicMaterial transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      {focusedMarker && focusedIndex >= 0 && <FocusRing position={stations[focusedIndex]!.pos} />}
    </>
  )
}
