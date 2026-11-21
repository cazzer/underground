import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, DynamicDrawUsage, RingGeometry, type InstancedMesh } from 'three'
import { useFocus } from '../lib/focus'
import { writeMarkerMatrices } from '../lib/markerMatrices'
import type { Station } from '../lib/network'
import { theme } from '../theme'
import { cameraDistance, markerRadiusPx, screenScale } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'

const MARKER_MIN_METERS = 6
const MARKER_Y = 0.2
const FOCUS_SCALE = 1.4
const SEGMENTS = 24

interface StationsProps {
  stations: readonly Station[]
}

/** All station markers as two instanced meshes (fill, then ring), picked by instanceId. */
export function Stations({ stations }: StationsProps) {
  const fill = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const { focusedId, select } = useFocus()
  const focusedIndex = useMemo(
    () => (focusedId ? stations.findIndex((s) => s.id === focusedId) : -1),
    [stations, focusedId],
  )
  const positions = useMemo(() => stations.map((s) => s.pos), [stations])
  // Pre-rotated flat on the ground, so each instance matrix is only scale plus translate.
  const geometry = useMemo(
    () => ({
      fill: new CircleGeometry(1, SEGMENTS).rotateX(-Math.PI / 2),
      ring: new RingGeometry(0.78, 1, SEGMENTS).rotateX(-Math.PI / 2),
    }),
    [],
  )
  const colors = useMemo(() => ({ stroke: new Color(theme.stationStroke), focus: new Color(theme.stationFocus) }), [])
  const drawn = useRef({ scale: NaN, focusedIndex: -1 })
  const coloredIndex = useRef(-1)

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
    for (let i = 0; i < stations.length; i++) r.setColorAt(i, colors.stroke)
    r.instanceColor!.needsUpdate = true
    coloredIndex.current = -1
    drawn.current.scale = NaN
  }, [stations, colors])

  useLayoutEffect(() => {
    const r = ring.current
    if (!r || coloredIndex.current === focusedIndex) return
    if (coloredIndex.current >= 0) r.setColorAt(coloredIndex.current, colors.stroke)
    if (focusedIndex >= 0) r.setColorAt(focusedIndex, colors.focus)
    r.instanceColor!.needsUpdate = true
    coloredIndex.current = focusedIndex
  }, [focusedIndex, colors])

  useFrame((state) => {
    const f = fill.current
    const r = ring.current
    if (!f || !r) return
    const d = cameraDistance(state)
    const scale = screenScale(d, markerRadiusPx(d), MARKER_MIN_METERS)
    const last = drawn.current
    if (scale === last.scale && focusedIndex === last.focusedIndex) return
    last.scale = scale
    last.focusedIndex = focusedIndex
    writeMarkerMatrices(f.instanceMatrix.array as Float32Array, positions, MARKER_Y, scale, focusedIndex, FOCUS_SCALE)
    r.instanceMatrix.array.set(f.instanceMatrix.array)
    f.instanceMatrix.needsUpdate = true
    r.instanceMatrix.needsUpdate = true
    // Raycasting recomputes it lazily from the new matrices.
    f.boundingSphere = null
  })

  return (
    <>
      <instancedMesh
        ref={fill}
        args={[geometry.fill, undefined, stations.length]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.stationFill}
        onClick={(e) => {
          e.stopPropagation()
          const station = e.instanceId === undefined ? undefined : stations[e.instanceId]
          if (station) select(station.id)
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
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
    </>
  )
}
