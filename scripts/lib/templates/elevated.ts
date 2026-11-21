/** Elevated and viaduct stations, 2 or 3 tracks: the street (0) is the lowest level, a station house sits below
 *  the platforms (default +4 m) and the platforms on top (default +8 m), unless the classifier's depths say otherwise.
 *  Street stairs and street machines have their entrance at the lower end (the merge allows either end). */
import { roundM } from '../stationGeometry.ts'
import type { GeneratedStation } from '../stationInputs.ts'
import { buildFromTemplate } from './build.ts'
import type { TemplateInputs } from './build.ts'
import type { TemplateCtx } from './context.ts'

export function elevated(ctx: TemplateCtx, inputs: TemplateInputs, log: string[]): GeneratedStation {
  const { platform, mezzanine } = ctx.params.depths
  if (platform.y <= 0) throw new Error(`platform height ${platform.y} m is not above the street`)
  const house = ctx.params.hasMezzanine && mezzanine ? mezzanine : null
  return buildFromTemplate(
    ctx,
    {
      street: { id: 'street', name: 'Street', kind: 'street', y: 0 },
      mezzanine: house ? { id: 'station-house', name: 'Station house', kind: 'mezzanine', y: roundM(house.y) } : null,
      platform: { id: 'platform', name: 'Platform', kind: 'platform', y: roundM(platform.y) },
      depths: { platform: platform.source, ...(house ? { 'station-house': house.source } : {}) },
    },
    inputs,
    log,
  )
}
