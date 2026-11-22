/** Station complexes: one interior file covers several stations. Pure. The client has its own copy of the
 *  member helpers (src/data/interiorLoad.ts); its extensionless imports can't load under the scripts' nodenext. */
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { list, text } from './check.ts'

const ID = /^[A-Za-z0-9]+$/

/** Every station the interior covers (its own alone unless it is a complex). */
export function membersOf(interior: Pick<StationInterior, 'stationId' | 'memberStationIds'>): readonly string[] {
  return interior.memberStationIds ?? [interior.stationId]
}

/** The member that owns a child stop: the longest member id that prefixes it (a "6" station and a "635" one). */
export function trackOwner(stopId: string, members: readonly string[]): string | undefined {
  let owner: string | undefined
  for (const m of members) {
    if (stopId.startsWith(m) && (owner === undefined || m.length > owner.length)) owner = m
  }
  return owner
}

/** Validates an authored `memberStationIds` (undefined when absent): sorted, unique, 2+, `stationId` first. */
export function checkMembers(stationId: string, raw: unknown, path: string): string[] | undefined {
  if (raw === undefined) return undefined
  const members = list(raw, path).map((m, i) => text(m, `${path}[${i}]`))
  if (members.length < 2) throw new Error(`${path}: a complex needs at least 2 members, got ${members.length}`)
  members.forEach((m, i) => {
    if (!ID.test(m) || m === 'index') throw new Error(`${path}[${i}]: ${JSON.stringify(m)} is not a usable station id`)
    if (i > 0 && m === members[i - 1]) throw new Error(`${path}[${i}]: duplicate member ${m}`)
    if (i > 0 && m < members[i - 1]!) throw new Error(`${path}[${i}]: members must be sorted ascending, ${m} comes after ${members[i - 1]}`)
  })
  if (members[0] !== stationId) throw new Error(`${path}: stationId ${stationId} must be the first member, got ${members[0]}`)
  return members
}
