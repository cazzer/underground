import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { InterleavedBufferAttribute } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { useFocus } from '../lib/focus'
import type { Network } from '../lib/network'
import { depthFactor, depthScaleY } from '../lib/tilt'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { MARKER_Y } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

/**
 * Ties fade in from TIE_FROM_DEPTH of the depth factor, fully shown TIE_RAMP later: below that a tie is shorter on
 * screen than the ring radius, a stray tick under the ring rather than a connection.
 */
const TIE_FROM_DEPTH = 0.3
const TIE_RAMP = 0.3
const tieOpacity = (depth: number): number => Math.min(Math.max((depth - TIE_FROM_DEPTH) / TIE_RAMP, 0), 1)

interface StationTiesProps {
  network: Network
}

/**
 * A thin vertical tie from each street-level station marker down to its platform tracks, for stations whose
 * tracks descend to a station depth (network.stationTrackY), so a tilted view shows which sunken line the
 * marker belongs to. It drops straight down from the GTFS station point, which sits between the tracks: right
 * for island platforms, roughly right for side platforms. One merged LineSegments2 drawn at the depth factor
 * (tilt.ts): scale.y follows it as the lines' does, so each tie ends on its sunken track; the opacity ramps in
 * once the tie is long enough to read (tieOpacity).
 * The focused station draws no marker, so its tie is left out too (swapped to the end and not drawn).
 */
export function StationTies({ network }: StationTiesProps) {
  const { focusedId } = useFocus()
  const ties = useMemo(() => {
    const positions: number[] = []
    const indexOf = new Map<string, number>()
    for (const [id, y] of network.stationTrackY) {
      const station = network.stationById.get(id)
      if (!station) throw new Error(`Station tie: unknown station ${id}`)
      indexOf.set(id, positions.length / 6)
      positions.push(station.pos.x, MARKER_Y, station.pos.z, station.pos.x, y, station.pos.z)
    }
    if (positions.length === 0) return null
    const material = new LineMaterial({
      color: theme.stationStroke,
      linewidth: theme.stationTieWidth,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const l = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material)
    l.renderOrder = RENDER_ORDER.stationTie
    l.frustumCulled = false
    return { lines: l, all: new Float32Array(positions), indexOf }
  }, [network])
  const lines = ties?.lines ?? null
  const lastDepth = useRef(NaN)

  // Every tie but the focused one: its segment trades places with the last, which is then not drawn.
  useLayoutEffect(() => {
    if (!ties) return
    const attr = ties.lines.geometry.attributes.instanceStart as InterleavedBufferAttribute
    const buf = attr.data.array as Float32Array
    buf.set(ties.all)
    const n = ties.all.length / 6
    const i = focusedId ? ties.indexOf.get(focusedId) : undefined
    if (i !== undefined && i !== n - 1) buf.copyWithin(i * 6, (n - 1) * 6, n * 6)
    ties.lines.geometry.instanceCount = i === undefined ? n : n - 1
    attr.data.needsUpdate = true
  }, [ties, focusedId])

  useEffect(
    () => () => {
      lines?.geometry.dispose()
      lines?.material.dispose()
    },
    [lines],
  )

  useFrame((state) => {
    if (!lines) return
    const depth = depthFactor(cameraDistance(state))
    if (depth === lastDepth.current) return
    lastDepth.current = depth
    const opacity = tieOpacity(depth)
    lines.visible = opacity > 0
    lines.scale.y = depthScaleY(depth)
    lines.material.opacity = opacity
  })

  return lines && <primitive object={lines} />
}
