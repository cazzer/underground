import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color } from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import type { ExitChoice } from '../lib/exitChoice'
import { RAIL_DROP_M } from '../lib/interiorGeometry'
import { BOARD_HALF_M, exitPathBuffers } from '../lib/interiorPath'
import { interiorOpacity } from '../lib/interiorReveal'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { exitPathLook } from './exitPathLook'
import { ENTRANCE_SIZE_M, splitLevelOf, STEP_RISE_M, type InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { useLineLayer, type LineDash } from './useLineLayer'

const DASH: LineDash = { size: theme.exitPathDash, gap: theme.exitPathGap }
// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const COLOR = new Color(exitPathLook.color)
const RGB = [COLOR.r, COLOR.g, COLOR.b] as const

interface ExitPathProps {
  model: InteriorModel
  choice: ExitChoice
}

/**
 * The trip's way out over the focused interior, inside its group (so it shares the anchor, the depth factor and the
 * visibility): one layer with the interior's base strokes, under the lifted trains, and one over them. It fades in
 * with the interior (`interiorOpacity`); dashed on an estimated layout or for an estimated walk.
 */
export function ExitPath({ model, choice }: ExitPathProps) {
  const layers = useMemo(
    () =>
      exitPathBuffers(model.interior, choice, {
        yScale: model.yScale,
        stepRise: STEP_RISE_M,
        railDrop: RAIL_DROP_M,
        entranceSize: ENTRANCE_SIZE_M,
        splitLevel: splitLevelOf(model.interior),
        rgb: RGB,
        dashInStation: choice.probable,
        restroke: exitPathLook.restroke,
        boardHalfM: BOARD_HALF_M,
      }),
    [model, choice],
  )
  const dash = layers.dashed ? DASH : undefined
  const under = useLineLayer(layers.under, RENDER_ORDER.exitPath, theme.exitPathWidth, dash)
  const over = useLineLayer(layers.over, RENDER_ORDER.exitPathOver, theme.exitPathWidth, dash)
  const shown = useRef(-1)
  /** The layers the last frame wrote: a rebuilt one has a fresh material to bring to the opacity. */
  const shownUnder = useRef<LineSegments2 | null>(null)
  const shownOver = useRef<LineSegments2 | null>(null)

  useFrame((state) => {
    const o = interiorOpacity(cameraDistance(state))
    if (o === shown.current && under === shownUnder.current && over === shownOver.current) return
    shown.current = o
    shownUnder.current = under
    shownOver.current = over
    if (under) under.material.opacity = o
    if (over) over.material.opacity = o
  })

  return (
    <>
      {under && <primitive object={under} />}
      {over && <primitive object={over} />}
    </>
  )
}
