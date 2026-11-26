import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, DynamicDrawUsage, MeshBasicMaterial, type Group, type InstancedMesh } from 'three'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import { AMENITY_ORDER, GLYPHS, type AmenityKind } from '../lib/amenityGlyphs'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { interiorOpacity } from '../lib/interiorReveal'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Network } from '../lib/network'
import type { Presence } from '../lib/presence'
import { depthFactor, depthScaleY } from '../lib/tilt'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { theme } from '../theme'
import { frameChanged, newAmenityFrame, TIERS, writeAmenityFrame, type AmenityFrame, type Tier, type TierArrays } from './amenityFrame'
import { glyphGeometry, plateGeometry } from './amenityGeometry'
import { markSizesInto, newMarkSizes } from './amenitySizes'
import { cameraDistance } from './cameraDistance'
import type { InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { clearAmenityBlockers, useAmenityBlockerSlot, writeAmenityBlockers } from './useAmenityBlockers'
import { useAmenityCovers } from './useAmenityCovers'
import { useAmenityLayout } from './useAmenityLayout'
import { useAmenityProbe, type AmenityView } from './useAmenityProbe'

const ORDERS: Record<Tier, { plate: number } & Record<AmenityKind, number>> = {
  under: { plate: RENDER_ORDER.amenityPlate, csc: RENDER_ORDER.amenityCsc, restroom: RENDER_ORDER.amenityRestroom },
  over: { plate: RENDER_ORDER.amenityPlateOver, csc: RENDER_ORDER.amenityCscOver, restroom: RENDER_ORDER.amenityRestroomOver },
}

interface HasAzimuth {
  getAzimuthalAngle?: () => number
}
interface HasTarget {
  target: { x: number; z: number }
}
const ORIGIN = { x: 0, z: 0 }
/** Marks within this many camera distances of the view's target may be on screen (the tilt's horizon guard is 1.5). */
const BLOCKER_REACH = 2

interface StationAmenitiesProps {
  network: Network
  /** The amenities file once loaded; null draws nothing. */
  amenities: AmenitiesFile | null
  /** Every shown interior (useSceneInteriors) and its presence: a mark whose station one covers moves past its hull. */
  shown: readonly InteriorModel[]
  presences: ReadonlyMap<string, Presence>
  /** This frame's trip look: while the trip's marks show, the first plate keeps clear of their halo. */
  levels: EmphasisLevels
  /** The street labels keep clear of the marks on screen (one slot). */
  blockers: LabelBlockers
  /** The HUD's bands and the station panel: a covered row is chosen to show in the free rect a landing leaves. */
  insets: Insets
  panel: ScreenRect | null
}

type Meshes = Record<Tier, { plate: InstancedMesh | null; glyph: Record<AmenityKind, InstancedMesh | null> }>

/**
 * Every listed station's amenity marks (enp.5): a background plate and an extruded `theme.amenityMark` pictogram
 * (amenityGlyphs' pieces) per amenity, in a row across the screen anchored on the station's clear bearing
 * (amenityPlacement.ts, laid out in idle time by useAmenityLayout) just past its marker, inside 1250 m only, fading in
 * with the interiors (interiorOpacity). Flat top-down (height × the depth factor), yawed to the camera azimuth so each
 * reads upright. A mark whose station a shown interior covers slides to a row just off that interior's hull
 * (useAmenityCovers) as its presence eases in, handing off from its copy under the veil (4.57 to 4.605) to one over
 * it (7.61 to 7.625). Instanced, depth testing off, no handlers (never picked); matrices are rewritten only when the view or
 * a presence changes, materials' opacity only on change, never as JSX props (o3r.9).
 */
export function StationAmenities({ network, amenities, shown, presences, levels, blockers, insets, panel }: StationAmenitiesProps) {
  const group = useRef<Group>(null)
  const meshes = useRef<Meshes>({
    under: { plate: null, glyph: { restroom: null, csc: null } },
    over: { plate: null, glyph: { restroom: null, csc: null } },
  })
  const marks = useAmenityLayout(network, amenities)
  const frame = useMemo(() => newAmenityFrame(marks), [marks])
  const frameRef = useRef<AmenityFrame | null>(null)
  frameRef.current = frame
  useAmenityCovers(frame, shown, presences, insets, panel)
  // Stable ref callbacks, one per mesh, so a re-render doesn't detach and reattach them.
  const refs = useMemo(() => {
    const out = {} as Record<Tier, { plate: (m: InstancedMesh | null) => void } & Record<AmenityKind, (m: InstancedMesh | null) => void>>
    for (const tier of TIERS) {
      const slots = meshes.current[tier]
      out[tier] = {
        plate: (m) => {
          slots.plate = m
        },
        restroom: (m) => {
          slots.glyph.restroom = m
        },
        csc: (m) => {
          slots.glyph.csc = m
        },
      }
    }
    return out
  }, [])

  const geometry = useMemo(
    () => ({ plate: plateGeometry(), restroom: glyphGeometry(GLYPHS.restroom, theme.amenitySideShade), csc: glyphGeometry(GLYPHS.csc, theme.amenitySideShade) }),
    [],
  )
  const material = useMemo(
    () => ({
      plate: new MeshBasicMaterial({ color: theme.background, transparent: true, depthTest: false, depthWrite: false }),
      glyph: new MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false }),
    }),
    [],
  )
  useEffect(
    () => () => {
      for (const g of Object.values(geometry)) g.dispose()
      material.plate.dispose()
      material.glyph.dispose()
    },
    [geometry, material],
  )
  const scratch = useMemo(() => ({ sizes: newMarkSizes(), tiers: null as Record<Tier, TierArrays> | null }), [])
  const view = useRef<AmenityView>({ opacity: 0, sizes: scratch.sizes })
  const slot = useAmenityBlockerSlot(blockers)
  useAmenityProbe(frameRef, view)

  // Usage, colors and the tiers' arrays before the first frame (the shader compiles with instance colors only if set).
  useLayoutEffect(() => {
    const g = group.current
    if (g) g.visible = false
    const arrays = {} as Record<Tier, TierArrays>
    for (const tier of TIERS) {
      const m = meshes.current[tier]
      const plate = m.plate
      if (!plate) return
      plate.instanceMatrix.setUsage(DynamicDrawUsage)
      const glyph = {} as Record<AmenityKind, Float32Array>
      for (const kind of AMENITY_ORDER) {
        const mesh = m.glyph[kind]
        if (!mesh) {
          glyph[kind] = new Float32Array(0)
          continue
        }
        mesh.instanceMatrix.setUsage(DynamicDrawUsage)
        const c = new Color(theme.amenityMark)
        for (let j = 0; j < mesh.count; j++) mesh.setColorAt(j, c)
        mesh.instanceColor!.needsUpdate = true
        glyph[kind] = mesh.instanceMatrix.array as Float32Array
      }
      arrays[tier] = { plate: plate.instanceMatrix.array as Float32Array, glyph }
    }
    scratch.tiers = arrays
    frame.drawnP.fill(NaN)
    frame.last.d = NaN
    return () => {
      scratch.tiers = null
    }
  }, [frame, scratch])

  useFrame((state) => {
    const g = group.current
    const tiers = scratch.tiers
    if (!g || !tiers) return
    const d = cameraDistance(state)
    const op = interiorOpacity(d)
    view.current.opacity = op
    if (op <= 0) {
      if (g.visible) g.visible = false
      clearAmenityBlockers(blockers, slot.current)
      return
    }
    if (!g.visible) g.visible = true
    if (material.glyph.opacity !== op) {
      material.glyph.opacity = op
      material.plate.opacity = op
    }
    const az = (state.controls as HasAzimuth | null)?.getAzimuthalAngle?.() ?? 0
    const depth = depthScaleY(depthFactor(d))
    const trip = levels.tripVisible
    if (frameChanged(frame, d, az, depth, trip)) {
      markSizesInto(scratch.sizes, d, trip)
      writeAmenityFrame(frame, tiers, scratch.sizes, d, az, depth, trip)
      const m = meshes.current
      for (let t = 0; t < TIERS.length; t++) {
        const tier = m[TIERS[t]!]
        tier.plate!.instanceMatrix.needsUpdate = true
        for (let k = 0; k < AMENITY_ORDER.length; k++) {
          const mesh = tier.glyph[AMENITY_ORDER[k]!]
          if (!mesh) continue
          mesh.instanceMatrix.needsUpdate = true
        }
      }
    }
    const target = (state.controls as HasTarget | null)?.target ?? ORIGIN
    writeAmenityBlockers(blockers, slot.current, frame, state.camera, state.size.width, state.size.height, az, scratch.sizes.plate, target, BLOCKER_REACH * d)
  })

  if (marks.length === 0) return null
  return (
    <group ref={group}>
      {TIERS.map((tier) => (
        <group key={tier}>
          <instancedMesh
            ref={refs[tier].plate}
            args={[geometry.plate, material.plate, marks.length]}
            frustumCulled={false}
            renderOrder={ORDERS[tier].plate}
          />
          {AMENITY_ORDER.map((kind) =>
            frame.byKind[kind].length === 0 ? null : (
              <instancedMesh
                key={kind}
                ref={refs[tier][kind]}
                args={[geometry[kind], material.glyph, frame.byKind[kind].length]}
                frustumCulled={false}
                renderOrder={ORDERS[tier][kind]}
              />
            ),
          )}
        </group>
      ))}
    </group>
  )
}
