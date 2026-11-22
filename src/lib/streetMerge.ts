/** A complex lead's street layer: the lead's street file plus the entrances of its members' files that it lacks. The
 *  files are built per station and clip a station to 300 m, dropping entrances over 260 m from it, so a complex's far
 *  members (Port Authority at Times Sq) have entrances the lead's file does not carry. Pure; the lines stay the lead's. */
import type { StationStreets, StreetEntrance } from '../data/streetSchema'
import { namedLines, type NamedLine } from './entranceText'
import { ENTRANCE_MATCH_M } from './entranceMarks'
import { toGround } from './projection'

/** The file's coordinates are integer decimeters. */
const DM_PER_M = 10

/**
 * The street files a station's layer is built from: a complex's lead (`memberIds[0] === stationId`, 2+ members) reads
 * every member's, lead first; anything else (a lone station, a non-lead member, an unknown id: `[]`) only its own.
 */
export function streetFileIds(stationId: string, memberIds: readonly string[]): readonly string[] {
  return memberIds.length >= 2 && memberIds[0] === stationId ? memberIds : [stationId]
}

export interface MergedStreets {
  /**
   * The lead's file (its ways, nodes, anchor and radii as fetched), its own entrances first and unchanged, then each
   * member entrance that no earlier file has, nearest the lead's point first, moved to the lead's decimeters. Not
   * sorted by x, z; may lie past `radiusM`.
   */
  file: StationStreets
  /** Every member's named streets (`namedLines`) in meters from the lead's anchor: wording only, never drawn. */
  extraLines: NamedLine[]
}

interface Placed {
  entrance: StreetEntrance
  /** Meters from the lead's anchor. */
  x: number
  z: number
}

/**
 * The lead's file with each member entrance that no entrance of an earlier file (the lead, then the members in order)
 * matches: the same type within ENTRANCE_MATCH_M on the scene ground. Entrances of one file never match each other (two
 * stairs 1 m apart both stay). An added entrance keeps its own file's join fields (street, cross, side, plaza,
 * stopIds); its x/z are rounded to the lead's decimeters. The added ones follow the lead's in order of their distance
 * from the lead's point, nearest first (a tie keeps member order, then file order).
 */
export function mergeComplexStreets(lead: StationStreets, members: readonly StationStreets[]): MergedStreets {
  const leadGround = toGround(lead.anchor)
  const kept: { x: number; z: number; type: string }[] = lead.entrances.map((e) => ({
    x: e.x / DM_PER_M,
    z: e.z / DM_PER_M,
    type: e.type,
  }))
  const added: Placed[] = []
  const extraLines: NamedLine[] = []
  for (const member of members) {
    const g = toGround(member.anchor)
    const dx = g.x - leadGround.x
    const dz = g.z - leadGround.z
    extraLines.push(...namedLines(member, dx, dz))
    // Compared against the earlier files only, so one file's own entrances never remove each other.
    const earlier = kept.length
    for (const e of member.entrances) {
      const x = dx + e.x / DM_PER_M
      const z = dz + e.z / DM_PER_M
      let seen = false
      for (let i = 0; i < earlier && !seen; i++) {
        const k = kept[i]!
        seen = k.type === e.type && Math.hypot(k.x - x, k.z - z) <= ENTRANCE_MATCH_M
      }
      if (seen) continue
      kept.push({ x, z, type: e.type })
      added.push({ entrance: { ...e, x: Math.round(x * DM_PER_M), z: Math.round(z * DM_PER_M) }, x, z })
    }
  }
  // Array.prototype.sort is stable, so equal distances keep member then file order.
  added.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
  return { file: { ...lead, entrances: [...lead.entrances, ...added.map((a) => a.entrance)] }, extraLines }
}
