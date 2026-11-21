import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { interiorOpacity } from '../lib/interiorReveal'
import type { Rgb } from '../lib/lineBuffers'
import type { Network } from '../lib/network'
import { platformMaskBuffers } from '../lib/platformMask'
import { routeLineColor } from '../lib/routeColor'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'

const linear = (hex: string): Rgb => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

interface PlatformTrackMaskProps {
  network: Network
  stationId: string
}

/**
 * Along the focused station's platforms the interior draws its own track a meter or so beside the map's; as the
 * interior reveals, this mask fades the map track out there (opacity = interior opacity), so only the interior's
 * remains. It is the map track's platform run redrawn in the background color, blending back into the route color
 * at the platform ends, over the map lines and under the markers and trains. Its own LineSegments2 (one small
 * draw call), not part of the merged map lines. Colored like the lines up close, where every lines mode shows
 * the route colors (theme.routeLineMix).
 */
export function PlatformTrackMask({ network, stationId }: PlatformTrackMaskProps) {
  const lines = useMemo(() => {
    const spans = network.platformSpans.get(stationId)
    if (!spans) return null
    const colors = new Map(network.routes.map((r) => [r.id, linear(routeLineColor(r.color, theme.routeLineMix, theme.background))]))
    const buffers = platformMaskBuffers(
      network.shapes,
      spans,
      (path) => {
        const c = colors.get(path.routeId)
        if (!c) throw new Error(`No color for route "${path.routeId}"`)
        return c
      },
      linear(theme.background),
    )
    if (buffers.positions.length === 0) return null
    const geometry = new LineSegmentsGeometry().setPositions(buffers.positions).setColors(buffers.colors)
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: theme.lineWidth,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    })
    const l = new LineSegments2(geometry, material)
    l.renderOrder = RENDER_ORDER.platformTrackMask
    l.visible = false
    return l
  }, [network, stationId])

  useEffect(
    () => () => {
      lines?.geometry.dispose()
      lines?.material.dispose()
    },
    [lines],
  )

  useFrame((state) => {
    if (!lines) return
    const o = interiorOpacity(cameraDistance(state))
    lines.material.opacity = o
    lines.visible = o > 0
  })

  return lines && <primitive object={lines} />
}
