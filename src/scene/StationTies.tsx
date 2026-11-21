import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { Network } from '../lib/network'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { MARKER_Y } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

/**
 * Full strength up close, gone by FADE_END. Farther out the tie is only a few pixels long, a stray tick under
 * the ring rather than a connection: at 600 m it is shorter on screen than the ring radius.
 */
const FADE_START = 350
const FADE_END = 550

interface StationTiesProps {
  network: Network
}

/**
 * A thin vertical tie from each street-level station marker down to its platform tracks, for stations whose
 * tracks descend to a station depth (network.stationTrackY), so a tilted view shows which sunken line the
 * marker belongs to. It drops straight down from the GTFS station point, which sits between the tracks: right
 * for island platforms, roughly right for side platforms. One merged LineSegments2, faded out by distance.
 */
export function StationTies({ network }: StationTiesProps) {
  const lines = useMemo(() => {
    const positions: number[] = []
    for (const [id, y] of network.stationTrackY) {
      const station = network.stationById.get(id)
      if (!station) throw new Error(`Station tie: unknown station ${id}`)
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
    return l
  }, [network])
  const lastFade = useRef(NaN)

  useEffect(
    () => () => {
      lines?.geometry.dispose()
      lines?.material.dispose()
    },
    [lines],
  )

  useFrame((state) => {
    if (!lines) return
    const fade = Math.min(Math.max((cameraDistance(state) - FADE_START) / (FADE_END - FADE_START), 0), 1)
    if (fade === lastFade.current) return
    lastFade.current = fade
    lines.visible = fade < 1
    lines.material.opacity = 1 - fade
  })

  return lines && <primitive object={lines} />
}
