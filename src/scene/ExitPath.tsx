import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { Color } from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { MAX_DECKS } from '../lib/interiorDecks'
import { RAIL_DROP_M } from '../lib/interiorGeometry'
import { BOARD_HALF_M, exitPathBuffers, type StationPathChoice } from '../lib/interiorPath'
import { interiorOpacity } from '../lib/interiorReveal'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { exitPathLook } from './exitPathLook'
import { ENTRANCE_SIZE_M, STEP_RISE_M, type InteriorModel } from './interiorModel'
import { strokeOrders } from './renderOrder'
import { useLineLayer, type LineDash } from './useLineLayer'

const DASH: LineDash = { size: theme.exitPathDash, gap: theme.exitPathGap }
// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const COLOR = new Color(exitPathLook.color)
const RGB = [COLOR.r, COLOR.g, COLOR.b] as const
const NO_KEEP_OUT = new Float32Array(0)

interface ExitPathProps {
  model: InteriorModel
  /** The way out at the trip's To station, or a change of trains through the complex. */
  choice: StationPathChoice
  /** Where the path's start goes for the level labels to keep clear of (StationInterior's); emptied on unmount. */
  keepOut: RefObject<Float32Array>
}

/**
 * The trip's way out, or its transfer, over the focused interior, inside its group (so it shares the anchor, the depth factor and the
 * visibility): one layer per stroke band (`model.decks`), each over that band's interior strokes and under the next
 * deck's lifted trains (`strokeOrders(band, count).exitPath`: 9.3 for band 0, 9.8 for the top band). It fades in with
 * the interior (`interiorOpacity`); dashed on an estimated layout or for an estimated walk. A transfer marks both
 * trains: where the rider steps off and the next train's track.
 */
export function ExitPath({ model, choice, keepOut }: ExitPathProps) {
  const layers = useMemo(
    () =>
      exitPathBuffers(model.interior, choice, {
        yScale: model.yScale,
        stepRise: STEP_RISE_M,
        railDrop: RAIL_DROP_M,
        entranceSize: ENTRANCE_SIZE_M,
        decks: model.decks,
        rgb: RGB,
        // Dashes mean the geometry is estimated (generated or `approximate`), as the interior's own strokes. A transfer
        // that is only probable because a slab doesn't state fare control draws solid: its layout is surveyed.
        dashInStation: model.interior.generated !== undefined || model.interior.approximate === true,
        restroke: exitPathLook.restroke,
        boardHalfM: BOARD_HALF_M,
      }),
    [model, choice],
  )
  if (layers.bands.length > MAX_DECKS + 1) throw new Error(`Station path at ${model.stationId}: ${layers.bands.length} bands; at most ${MAX_DECKS + 1} draw`)
  useEffect(() => {
    const ref = keepOut
    ref.current = layers.keepOut
    return () => {
      ref.current = NO_KEEP_OUT
    }
  }, [layers, keepOut])
  const dash = layers.dashed ? DASH : undefined
  const count = layers.bands.length
  const order = (band: number) => (band < count ? strokeOrders(band, count).exitPath : 0)
  // A fixed four (MAX_DECKS + 1), so the hook count never changes; bands the station lacks stay null.
  const b0 = useLineLayer(layers.bands[0] ?? null, order(0), theme.exitPathWidth, dash)
  const b1 = useLineLayer(layers.bands[1] ?? null, order(1), theme.exitPathWidth, dash)
  const b2 = useLineLayer(layers.bands[2] ?? null, order(2), theme.exitPathWidth, dash)
  const b3 = useLineLayer(layers.bands[3] ?? null, order(3), theme.exitPathWidth, dash)
  const shown = useRef(-1)
  /** The layer the last frame wrote first: a rebuilt set has fresh materials to bring to the opacity. */
  const shownLayers = useRef<(LineSegments2 | null)[]>([])

  useFrame((state) => {
    const o = interiorOpacity(cameraDistance(state))
    const s = shownLayers.current
    if (o === shown.current && s[0] === b0 && s[1] === b1 && s[2] === b2 && s[3] === b3) return
    shown.current = o
    shownLayers.current = [b0, b1, b2, b3]
    if (b0) b0.material.opacity = o
    if (b1) b1.material.opacity = o
    if (b2) b2.material.opacity = o
    if (b3) b3.material.opacity = o
  })

  return (
    <>
      {b0 && <primitive object={b0} />}
      {b1 && <primitive object={b1} />}
      {b2 && <primitive object={b2} />}
      {b3 && <primitive object={b3} />}
    </>
  )
}
