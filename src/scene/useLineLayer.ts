import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { Color } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { RouteId } from '../data/schema'
import { buildLineBuffers, type LineBuffers, type Rgb } from '../lib/lineBuffers'
import type { Network, ShapePath } from '../lib/network'
import { routeLineColor, type RouteLineMix } from '../lib/routeColor'
import { theme } from '../theme'

/** Line buffers for `paths`, each colored by its route's GTFS color under `mix`. */
export function routeLineBuffers(network: Network, paths: readonly ShapePath[], mix: RouteLineMix): LineBuffers {
  const order = new Map(network.routes.map((r, i) => [r.id, i]))
  const colors = new Map<RouteId, Rgb>()
  for (const r of network.routes) {
    // Color(hex) converts sRGB to linear, which is what vertex colors must be.
    const c = new Color(routeLineColor(r.color, mix))
    colors.set(r.id, [c.r, c.g, c.b])
  }
  return buildLineBuffers(paths, order, (id) => {
    const c = colors.get(id)
    if (!c) throw new Error(`No color for route "${id}"`)
    return c
  })
}

/**
 * One merged LineSegments2 (a single draw call) for `buffers`; null when there is nothing to
 * draw. Rebuilt when `buffers` changes, disposed on change and unmount.
 */
export function useLineLayer(buffers: LineBuffers | null, renderOrder: number): LineSegments2 | null {
  const size = useThree((s) => s.size)
  const lines = useMemo(() => {
    if (!buffers || buffers.positions.length === 0) return null
    const geometry = new LineSegmentsGeometry().setPositions(buffers.positions).setColors(buffers.colors)
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: theme.lineWidth,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const l = new LineSegments2(geometry, material)
    l.renderOrder = renderOrder
    return l
  }, [buffers, renderOrder])

  useEffect(
    () => () => {
      lines?.geometry.dispose()
      lines?.material.dispose()
    },
    [lines],
  )

  // Linewidth is in pixels of this resolution; CSS pixels keep it the same at any dpr.
  useLayoutEffect(() => {
    lines?.material.resolution.set(size.width, size.height)
  }, [lines, size.width, size.height])

  return lines
}
