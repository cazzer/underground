import { useEffect, useMemo } from 'react'
import { Color, InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three'
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
    const c = new Color(routeLineColor(r.color, mix, theme.background))
    colors.set(r.id, [c.r, c.g, c.b])
  }
  return buildLineBuffers(paths, order, (id) => {
    const c = colors.get(id)
    if (!c) throw new Error(`No color for route "${id}"`)
    return c
  })
}

/** Dash pattern in world meters (TEMPORARY with ?approx=b, see approxLook.ts). */
export interface LineDash {
  size: number
  gap: number
}

/** Line buffers plus, for a dashed layer, two dash distances per segment (start, end; 0, 0 stays solid). */
export interface DashableLineBuffers extends LineBuffers {
  distances?: Float32Array
}

/**
 * One merged LineSegments2 (a single draw call) for `buffers`; null when there is nothing to
 * draw. Rebuilt when `buffers` changes, disposed on change and unmount. LineSegments2 sets its
 * material's resolution from the viewport (CSS pixels) before each render, so linewidth is in
 * CSS pixels at any dpr. With `dash`, the material is dashed in world meters along `buffers.distances` (written
 * as-is, not by computeLineDistances); a dashed material drops every segment's round end caps.
 */
export function useLineLayer(
  buffers: DashableLineBuffers | null,
  renderOrder: number,
  linewidth = theme.lineWidth,
  dash?: LineDash,
): LineSegments2 | null {
  const dashSize = dash?.size
  const gapSize = dash?.gap
  const lines = useMemo(() => {
    if (!buffers || buffers.positions.length === 0) return null
    const geometry = new LineSegmentsGeometry().setPositions(buffers.positions).setColors(buffers.colors)
    const material = new LineMaterial({
      vertexColors: true,
      linewidth,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    if (dashSize !== undefined && gapSize !== undefined) {
      if (buffers.distances?.length !== buffers.positions.length / 3) throw new Error('A dashed line layer needs two distances per segment')
      const d = new InstancedInterleavedBuffer(buffers.distances, 2, 1)
      geometry.setAttribute('instanceDistanceStart', new InterleavedBufferAttribute(d, 1, 0))
      geometry.setAttribute('instanceDistanceEnd', new InterleavedBufferAttribute(d, 1, 1))
      material.dashed = true
      material.dashSize = dashSize
      material.gapSize = gapSize
    }
    const l = new LineSegments2(geometry, material)
    l.renderOrder = renderOrder
    return l
  }, [buffers, renderOrder, linewidth, dashSize, gapSize])

  useEffect(
    () => () => {
      lines?.geometry.dispose()
      lines?.material.dispose()
    },
    [lines],
  )

  return lines
}
