/** Below-street templates: cut-and-cover under a mezzanine, and shallow side platforms entered from the street
 *  on each side. Levels from the classifier's depths (street 0, negative below). */
import { roundM } from '../stationGeometry.ts'
import type { GeneratedStation } from '../stationInputs.ts'
import { buildFromTemplate } from './build.ts'
import type { TemplateInputs, TemplateLevels } from './build.ts'
import type { TemplateCtx } from './context.ts'

function subwayLevels(ctx: TemplateCtx, withMezzanine: boolean): TemplateLevels {
  const { platform, mezzanine } = ctx.params.depths
  if (platform.y >= 0) throw new Error(`platform depth ${platform.y} m is not below the street`)
  const mezz = withMezzanine && mezzanine ? mezzanine : null
  return {
    street: { id: 'street', name: 'Street', kind: 'street', y: 0 },
    mezzanine: mezz ? { id: 'mezzanine', name: 'Mezzanine', kind: 'mezzanine', y: roundM(mezz.y) } : null,
    platform: { id: 'platform', name: 'Platform', kind: 'platform', y: roundM(platform.y) },
    depths: { platform: platform.source, ...(mezz ? { mezzanine: mezz.source } : {}) },
  }
}

/** Mezzanine slabs over the platforms (none when the classifier found no mezzanine evidence). */
export function cutCover(ctx: TemplateCtx, inputs: TemplateInputs, log: string[]): GeneratedStation {
  if (ctx.params.platformType === 'mixed') throw new Error('mixed island and side platforms: no template')
  return buildFromTemplate(ctx, subwayLevels(ctx, ctx.params.hasMezzanine), inputs, log)
}

/** No mezzanine: a street stair lands on the nearer side platform; a platform no stair reaches gets one from the
 *  nearest entrance that does not cross another platform, else the station is skipped. */
export function shallow(ctx: TemplateCtx, inputs: TemplateInputs, log: string[]): GeneratedStation {
  return buildFromTemplate(ctx, subwayLevels(ctx, false), inputs, log)
}
