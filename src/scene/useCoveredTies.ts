import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, type InterleavedBufferAttribute } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { interiorOpacity } from '../lib/interiorReveal'
import { dimLineRgbInto, srgb01 } from '../lib/lineDim'
import type { Network } from '../lib/network'
import type { Presence } from '../lib/presence'
import { depthFactor, depthScaleY } from '../lib/tilt'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { theme } from '../theme'
import { DimLineMaterial, writeLineDim } from './bandLineMaterial'
import { cameraDistance } from './cameraDistance'
import { MARKER_Y } from './markerShape'
import { RENDER_ORDER } from './renderOrder'
import type { CoveredStation } from './useSceneInteriors'

const BACKGROUND = srgb01(theme.background)
// Vertex colors carry the stroke; the material's color is the identity multiplier.
const WHITE = new Color(1, 1, 1)

/**
 * The ties of the stations a drawn interior other than the focused one stands in for (o3r.4), as their own layer: each
 * tie's color mixes toward the background by interiorOpacity x its interior's presence (per vertex, rewritten only
 * when that changes), so it fades as the interior reveals instead of dropping out; once fully faded it leaves the
 * drawn ties, so it masks nothing. Opacity, depth scale and the trip
 * dim follow StationTies' main layer (`opacity` gives its tie opacity for a depth). Allocation-free per frame.
 */
export function useCoveredTies(network: Network, covered: readonly CoveredStation[], levels: EmphasisLevels, opacity: (depth: number) => number): LineSegments2 | null {
  const layer = useMemo(() => {
    const list = covered.filter((c) => network.stationTrackY.has(c.id))
    if (list.length === 0) return null
    const stroke = new Color(theme.stationStroke)
    const positions: number[] = []
    const colors = new Float32Array(list.length * 6)
    list.forEach((c, k) => {
      const station = network.stationById.get(c.id)
      if (!station) throw new Error(`Station tie: unknown station ${c.id}`)
      positions.push(station.pos.x, MARKER_Y, station.pos.z, station.pos.x, network.stationTrackY.get(c.id)!, station.pos.z)
      for (let j = 0; j < 6; j += 3) colors.set([stroke.r, stroke.g, stroke.b], k * 6 + j)
    })
    const geometry = new LineSegmentsGeometry().setPositions(positions).setColors(colors)
    const material = new DimLineMaterial(
      { color: WHITE, vertexColors: true, linewidth: theme.stationTieWidth, transparent: true, depthTest: false, depthWrite: false },
      theme.background,
    )
    const lines = new LineSegments2(geometry, material)
    lines.renderOrder = RENDER_ORDER.stationTie
    lines.frustumCulled = false
    const presence: Presence[] = list.map((c) => c.presence)
    return {
      lines,
      presence,
      /** Every tie's two points, and its color at the last write (6 floats each), to compact the drawn ones from. */
      positions: Float32Array.from(positions),
      colors,
      /** 1 while fully faded: left out of the drawn ties, so it doesn't mask the lines it crosses. */
      gone: new Uint8Array(list.length),
      stroke: Float32Array.of(stroke.r, stroke.g, stroke.b),
      rgb: new Float32Array(3),
      last: new Float32Array(list.length).fill(NaN),
      depth: { last: NaN },
    }
  }, [network, covered])

  useEffect(
    () => () => {
      layer?.lines.geometry.dispose()
      layer?.lines.material.dispose()
    },
    [layer],
  )

  useFrame((state) => {
    if (!layer) return
    const { lines } = layer
    const d = cameraDistance(state)
    writeLineDim(lines.material, levels.networkDim)
    const depth = depthFactor(d)
    if (depth !== layer.depth.last) {
      layer.depth.last = depth
      const o = opacity(depth)
      lines.visible = o > 0
      lines.scale.y = depthScaleY(depth)
      lines.material.opacity = o
    }
    const reveal = interiorOpacity(d)
    let changed = false
    for (let k = 0; k < layer.presence.length; k++) {
      const amount = reveal * layer.presence[k]!.value
      if (amount === layer.last[k]) continue
      layer.last[k] = amount
      layer.gone[k] = amount >= 1 ? 1 : 0
      dimLineRgbInto(layer.rgb, layer.stroke, BACKGROUND, amount)
      layer.colors.set(layer.rgb, k * 6)
      layer.colors.set(layer.rgb, k * 6 + 3)
      changed = true
    }
    if (!changed) return
    // The ties not fully faded, compacted to the front with their colors; only those draw.
    const at = lines.geometry.attributes.instanceStart as InterleavedBufferAttribute
    const ac = lines.geometry.attributes.instanceColorStart as InterleavedBufferAttribute
    const pos = at.data.array as Float32Array
    const col = ac.data.array as Float32Array
    let n = 0
    for (let k = 0; k < layer.presence.length; k++) {
      if (layer.gone[k] === 1) continue
      for (let j = 0; j < 6; j++) {
        pos[n * 6 + j] = layer.positions[k * 6 + j]!
        col[n * 6 + j] = layer.colors[k * 6 + j]!
      }
      n++
    }
    lines.geometry.instanceCount = n
    at.data.needsUpdate = true
    ac.data.needsUpdate = true
  })

  return layer?.lines ?? null
}
