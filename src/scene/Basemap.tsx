/**
 * The citywide basemap: faint roads, water and parks from the tile store (useBasemapTiles.ts), one LineSegments2 per
 * class (basemapLayer.ts), under the route lines. Each frame (priority 0, after the store's update) it rewrites the
 * pooled buffers when the drawn tile set changed, re-mixes each class's stroke and resizes the bbox edge fade when the
 * camera distance changed (classFade.ts, edgeFade.ts), moves the road mask to the focused station's street layer, if
 * one is drawn (streetMask.ts), and lets a pool that has stayed mostly empty shrink. Every class thins out away from
 * the network and stops at the spec bbox (edgeFade.ts). A steady frame allocates nothing.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color } from 'three'
import type { BasemapConfig } from '../data/basemapConfig'
import { classVisibility } from '../lib/basemap/classFade'
import { edgeFadeFor, NETWORK_FADE_M, NETWORK_PAD_M, sceneBox } from '../lib/basemap/edgeFade'
import { BASEMAP_CLASSES, type BasemapClass } from '../lib/basemap/featureClass'
import { networkHull } from '../lib/basemap/networkHull'
import { maskInner, type StreetMask } from '../lib/basemap/streetMask'
import { planPool } from '../lib/basemap/tilePool'
import type { Station } from '../lib/network'
import { interiorOpacity } from '../lib/interiorReveal'
import { theme } from '../theme'
import { createExtentUniforms, createMaskUniforms } from './basemapLineMaterial'
import { createClassLayer, type ClassLayer } from './basemapLayer'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { useBasemapTiles } from './useBasemapTiles'

const LAYER_ORDER: Readonly<Record<BasemapClass, number>> = {
  park: RENDER_ORDER.basemapPark,
  water: RENDER_ORDER.basemapWater,
  path: RENDER_ORDER.basemapPath,
  minor: RENDER_ORDER.basemapMinor,
  major: RENDER_ORDER.basemapMajor,
  highway: RENDER_ORDER.basemapHighway,
}

/** Water and parks are areas the station's streets don't redraw, so only roads are masked. */
const MASKED: ReadonlySet<BasemapClass> = new Set(['highway', 'major', 'minor', 'path'])

interface ClassEntry {
  cls: BasemapClass
  layer: ClassLayer
  /** Linear, as material colors are. */
  stroke: Color
}

/** What the layers hold and were last drawn at; made with them, so new layers never start from old state. */
interface Drawn {
  version: number
  order: number[]
  distance: number
}

interface BasemapProps {
  config: BasemapConfig
  /** The network's stations: the basemap thins out away from their outline. */
  stations: readonly Station[]
  /** Written by StationStreets while a station street layer is mounted. */
  mask: StreetMask
}

export function Basemap({ config, stations, mask }: BasemapProps) {
  const store = useBasemapTiles(config)
  const maskUniforms = useMemo(createMaskUniforms, [])
  const background = useMemo(() => new Color(theme.background), [])
  const { entries, extent, drawn } = useMemo(() => {
    const hull = networkHull(stations.map((s) => s.pos))
    const extent = createExtentUniforms(sceneBox(config.bbox), edgeFadeFor(Infinity), hull, NETWORK_PAD_M, NETWORK_FADE_M)
    // Water and parks share a mask that is never written: strength 0, so they are never masked.
    const unmasked = createMaskUniforms()
    const entries: ClassEntry[] = BASEMAP_CLASSES.map((cls) => ({
      cls,
      layer: createClassLayer({
        width: theme.basemap[cls].width,
        renderOrder: LAYER_ORDER[cls],
        mask: MASKED.has(cls) ? maskUniforms : unmasked,
        extent,
      }),
      stroke: new Color(theme.basemap[cls].stroke),
    }))
    const drawn: Drawn = { version: -1, order: [], distance: -1 }
    return { entries, extent, drawn }
  }, [maskUniforms, config, stations])

  useEffect(() => () => entries.forEach((e) => e.layer.dispose()), [entries])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = {
      ...window.__underground,
      basemapSegments: () => ({
        distance: drawn.distance,
        classes: Object.fromEntries(entries.map((e) => [e.cls, { used: e.layer.used, capacity: e.layer.capacity, visible: e.layer.line.visible }])),
      }),
    }
    return () => {
      if (window.__underground) delete window.__underground.basemapSegments
    }
  }, [entries, drawn])

  useFrame((state) => {
    if (store.version !== drawn.version) {
      const t0 = import.meta.env.DEV ? performance.now() : 0
      drawn.version = store.version
      const tiles = new Map(store.drawn.map((t) => [t.key, t]))
      const plan = planPool(drawn.order, [...tiles.keys()])
      drawn.order = plan.order
      for (const e of entries) e.layer.apply(plan.order, plan.keep, (key) => tiles.get(key)?.classes[e.cls])
      if (import.meta.env.DEV) performance.measure('basemap:apply', { start: t0, end: performance.now() })
    }
    const now = state.clock.elapsedTime
    for (const e of entries) e.layer.tick(now)
    const d = cameraDistance(state)
    if (d !== drawn.distance) {
      drawn.distance = d
      for (const e of entries) e.layer.setVisibility(classVisibility(e.cls, d), e.stroke, background)
      extent.edgeFadeM.value = edgeFadeFor(d)
    }
    if (mask.present) {
      maskUniforms.maskCenter.value.set(mask.x, mask.z)
      maskUniforms.maskInner.value = maskInner(mask.radiusM)
      maskUniforms.maskOuter.value = mask.radiusM
      // The station's streets draw at this opacity (StationStreets.tsx); the roads give way by as much.
      maskUniforms.maskStrength.value = interiorOpacity(d)
    } else {
      maskUniforms.maskStrength.value = 0
    }
  }, 0)

  return (
    <group>
      {entries.map((e) => (
        <primitive key={e.cls} object={e.layer.line} />
      ))}
    </group>
  )
}
