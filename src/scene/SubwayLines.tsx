import { useMemo } from 'react'
import type { Network } from '../lib/network'
import { baseLineMix, linesMode, theme } from '../theme'
import { LineFade, LineHighlight } from './LineHighlight'
import { RENDER_ORDER } from './renderOrder'
import { routeLineBuffers, useLineLayer } from './useLineLayer'

interface SubwayLinesProps {
  network: Network
}

/** Every shape of every route, merged into one draw call. */
export function SubwayLines({ network }: SubwayLinesProps) {
  const buffers = useMemo(
    () => routeLineBuffers(network, network.shapes, baseLineMix(theme, linesMode)),
    [network],
  )
  const lines = useLineLayer(buffers, RENDER_ORDER.lines)
  return (
    <>
      {lines && <primitive object={lines} />}
      {linesMode === 'a' && <LineHighlight network={network} />}
      {linesMode === 'c' && <LineFade network={network} />}
    </>
  )
}
