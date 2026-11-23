import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { RingGeometry, type Mesh } from 'three'
import type { Ground } from '../lib/projection'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { FOCUS_OUTSIDE_INNER, FOCUS_OUTSIDE_OUTER, tripMarkRadius, type ReticleClearance } from '../lib/tripMarkSize'
import type { TripMarkRole } from '../lib/tripMarks'
import { theme } from '../theme'
import { cameraDistance, focusScaleFactor, markerRadiusPx, screenScale, tripMarkRadiusPx } from './cameraDistance'
import { reticleClearanceInto } from './hereShape'
import { MARKER_MIN_METERS, MARKER_Y, RING_INNER, SEGMENTS, TRIP_MARK_MIN_METERS } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

interface FocusRingProps {
  position: Ground
  /** The trip mark on this station, if any: while the trip shows, the ring draws just outside it. */
  tripRole: TripMarkRole | null
  /** This frame's trip look (SubwayLines, -0.25). */
  levels: EmphasisLevels
  /** The location fix's ground point while its reticle shows: a start mark grown round it grows this ring too. */
  fix: Ground | null
}

/**
 * The focus ring of a focused station that has no interior (the fallback marker): `theme.stationFocus`,
 * a little larger than its neighbours, drawn above the trains so a passing train can't hide which station is
 * selected. Same geometry and per-frame size as the instanced ring it covers; on a station the shown trip marks, a
 * band just outside the mark's halo instead (FOCUS_OUTSIDE_INNER..OUTER of its drawn radius, `tripMarkRadius` as
 * TripMarks sizes it, a start grown round the reticle included), so the two rings don't cross.
 * The scale and geometry are written only when they change. A station with an interior draws no ring (the interior marks it).
 */
export function FocusRing({ position, tripRole, levels, fix }: FocusRingProps) {
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(
    () => ({
      own: new RingGeometry(RING_INNER, 1, SEGMENTS).rotateX(-Math.PI / 2),
      outside: new RingGeometry(FOCUS_OUTSIDE_INNER, FOCUS_OUTSIDE_OUTER, SEGMENTS).rotateX(-Math.PI / 2),
    }),
    [],
  )
  const drawn = useRef<{ scale: number; outside: boolean | null }>({ scale: NaN, outside: null })
  const reticle = useMemo<ReticleClearance>(() => ({ outerM: 0, gapM: 0 }), [])

  useEffect(
    () => () => {
      geometry.own.dispose()
      geometry.outside.dispose()
    },
    [geometry],
  )

  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const d = cameraDistance(state)
    const outside = tripRole !== null && levels.tripVisible
    let s: number
    if (outside) s = tripMarkRadius(tripRole, screenScale(d, tripMarkRadiusPx(d), TRIP_MARK_MIN_METERS), position, fix, reticleClearanceInto(reticle, d))
    else {
      const base = screenScale(d, markerRadiusPx(d), MARKER_MIN_METERS)
      s = base * focusScaleFactor(d, base)
    }
    const last = drawn.current
    if (s === last.scale && outside === last.outside) return
    last.scale = s
    if (outside !== last.outside) m.geometry = outside ? geometry.outside : geometry.own
    last.outside = outside
    m.scale.setScalar(s)
  })

  return (
    <mesh ref={mesh} geometry={geometry.own} position={[position.x, MARKER_Y, position.z]} renderOrder={RENDER_ORDER.focusRing}>
      <meshBasicMaterial color={theme.stationFocus} transparent depthTest={false} depthWrite={false} />
    </mesh>
  )
}
