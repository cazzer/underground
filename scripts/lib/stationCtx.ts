/** Shared lookups for the station merge. */
import type { Entrance, InteriorSource, Level } from '../../src/data/stationSchema.ts'
import { text } from './check.ts'
import type { Frame } from './stationGeometry.ts'

export interface Ctx {
  frame: Frame
  levels: Map<string, Level>
  street: Level
}

export const srcs = (...s: InteriorSource[]): InteriorSource[] => [...new Set(s)].sort()

export function levelOf(ctx: Ctx, id: unknown, path: string): Level {
  const level = ctx.levels.get(text(id, path))
  if (!level) throw new Error(`${path}: unknown level ${JSON.stringify(id)}; levels are ${[...ctx.levels.keys()].join(', ')}`)
  return level
}

export function entranceOf(entrances: Map<string, Entrance>, id: unknown, path: string): Entrance {
  const e = entrances.get(text(id, path))
  if (!e) throw new Error(`${path}: unknown entrance ${JSON.stringify(id)}`)
  return e
}
