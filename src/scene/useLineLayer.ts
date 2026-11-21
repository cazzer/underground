import { useEffect, useMemo } from 'react'
import { Color, InstancedBufferAttribute, InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { RouteId } from '../data/schema'
import { buildLineBuffers, type LineBuffers, type Rgb } from '../lib/lineBuffers'
import type { Network, ShapePath } from '../lib/network'
import { routeLineColor, type RouteLineMix } from '../lib/routeColor'
import { theme } from '../theme'
import { BAND_END, BAND_START, BandLineMaterial, FADE_ATTRIBUTE } from './bandLineMaterial'

/** Line buffers for `paths`, each colored by its route's GTFS color under `mix`, with their band inputs. */
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

/**
 * One merged LineSegments2 (a single draw call) for `buffers`; null when there is nothing to
 * draw. Rebuilt when `buffers` changes, disposed on change and unmount. LineSegments2 sets its
 * material's resolution from the viewport (CSS pixels) before each render, so linewidth is in
 * CSS pixels at any dpr. Buffers with `bands` (route lines) draw with BandLineMaterial, which shifts each
 * segment end by its band offset on the GPU (and fades it by its FADE_ATTRIBUTE weight); the band uniforms are
 * written per frame in SubwayLines.
 */
export function useLineLayer(
  buffers: LineBuffers | null,
  renderOrder: number,
  linewidth = theme.lineWidth,
): LineSegments2 | null {
  const lines = useMemo(() => {
    if (!buffers || buffers.positions.length === 0) return null
    const geometry = new LineSegmentsGeometry().setPositions(buffers.positions).setColors(buffers.colors)
    const params = { vertexColors: true, linewidth, transparent: true, depthTest: false, depthWrite: false }
    let material: LineMaterial
    if (buffers.bands) {
      const band = new InstancedInterleavedBuffer(buffers.bands, 8, 1)
      geometry.setAttribute(BAND_START, new InterleavedBufferAttribute(band, 4, 0))
      geometry.setAttribute(BAND_END, new InterleavedBufferAttribute(band, 4, 4))
      // Zero until a platform fade is written (SubwayLines); always present, so the shader never reads a stale
      // default attribute value.
      geometry.setAttribute(FADE_ATTRIBUTE, new InstancedBufferAttribute(new Float32Array(buffers.bands.length / 4), 2))
      material = new BandLineMaterial(params)
    } else {
      material = new LineMaterial(params)
    }
    const l = new LineSegments2(geometry, material)
    l.renderOrder = renderOrder
    return l
  }, [buffers, renderOrder, linewidth])

  useEffect(
    () => () => {
      lines?.geometry.dispose()
      lines?.material.dispose()
    },
    [lines],
  )

  return lines
}
