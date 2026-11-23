/** The citywide street and intersection search entries (2q7.13), from the street pin and the stations. Pure:
 *  build-street-index.ts reads the files and writes the Worker's index (streetIndexPack.ts). The contract and the rules
 *  kept are in worker/src/streetIndexSchema.ts. A street is one record per (borough, street key) with a site per nearby
 *  station; an intersection is a node two differently named streets share, nodes within INTERSECTION_MERGE_M of each
 *  other (the two carriageways of one crossing) taken as one, sited at the one nearest their mean. The borough is the nearest station's. */
import type { Borough, Station } from '../../src/data/schema.ts'
import type { IntersectionEntry, SearchSite, StreetEntry, StreetRank, StreetSearchEntry } from './streetIndexTypes.ts'
import { toGround, toLatLon, type Ground } from '../../src/lib/projection.ts'
import { isClosedRing, isStreet } from '../../src/lib/streetClass.ts'
import { streetKey } from './entranceStreet.ts'
import type { Pin } from './streetsPin.ts'

/** Shared nodes of one street pair closer than this are one intersection. */
export const INTERSECTION_MERGE_M = 100
/** A vertex is border-ambiguous when a station of another borough is within this multiple of its nearest station. */
const BORDER_RATIO = 1.25

export const STREET_RANK: Readonly<Record<string, StreetRank>> = {
  trunk: 4, trunk_link: 4, primary: 4, primary_link: 4, secondary: 3, secondary_link: 3, tertiary: 2, tertiary_link: 2,
  residential: 1, unclassified: 1, living_street: 1, pedestrian: 1, service: 0,
}

const SUFFIXES: Readonly<Record<string, string>> = {
  street: 'St', avenue: 'Av', place: 'Pl', road: 'Rd', boulevard: 'Blvd', drive: 'Dr', lane: 'Ln', parkway: 'Pkwy',
  square: 'Sq', highway: 'Hwy', turnpike: 'Tpke',
}
const COMPASS: Readonly<Record<string, string>> = { north: 'N', south: 'S', east: 'E', west: 'W' }

/** The MTA-style short form: "North 7th Street" is "N 7 St", "Avenue U" "Av U", "Ocean Avenue North" "Ocean Av N", "Saint
 *  Marks Place" "St Marks Pl". A leading compass word is only shortened before a number, and a trailing one after a street type
 *  ("West St", "West End Av" and "East Broadway" keep it); "Lafayette Court" has no short form. */
export function displayStreetName(name: string): string {
  const words = name.trim().split(/\s+/).map((w) => w.replace(/^(\d+)(?:st|nd|rd|th)$/i, '$1'))
  if (words.length >= 2) {
    const compass = COMPASS[words[words.length - 1]!.toLowerCase()]
    // A street type then a compass suffix ("Park Avenue South") shortens both; otherwise only a last-word type does.
    const type = compass !== undefined && words.length >= 3 && SUFFIXES[words[words.length - 2]!.toLowerCase()] !== undefined ? words.length - 2 : words.length - 1
    if (type === words.length - 2) words[words.length - 1] = compass!
    words[type] = SUFFIXES[words[type]!.toLowerCase()] ?? words[type]!
    if (words.length === 2 && words[0]!.toLowerCase() === 'avenue' && /^(?:[A-Za-z]|\d+)$/.test(words[1]!)) words[0] = 'Av'
    if (words[0]!.toLowerCase() === 'saint') words[0] = 'St'
  }
  if (words.length >= 3 && /^\d+$/.test(words[1]!)) words[0] = COMPASS[words[0]!.toLowerCase()] ?? words[0]!
  return words.join(' ')
}

export interface StreetIndexStats {
  streets: number
  sites: number
  intersections: number
  /** Street keys that have a record in more than one borough. */
  multiBoroughKeys: number
  /** Street-way vertices with a station of another borough within 1.25x of the nearest one's distance. */
  borderAmbiguousVertices: number
  /** Streets whose display name did not keep the street key, so the OSM name stands. */
  displayFallbacks: number
}

interface StationPoint extends Ground {
  id: string
  borough: Borough
}

interface Vertex extends Ground {
  station: number
  borough: Borough
}

interface Group {
  borough: Borough
  key: string
  names: Map<string, number>
  rank: StreetRank
  /** Per station index: the nearest point on the group's segments that have an endpoint nearest that station. */
  nearest: Map<number, Ground & { d: number }>
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5
const dist = (a: Ground, b: Ground): number => Math.hypot(a.x - b.x, a.z - b.z)

function nearestPoint(a: Ground, b: Ground, p: Ground): Ground & { d: number } {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  const q = { x: a.x + t * dx, z: a.z + t * dz }
  return { ...q, d: dist(q, p) }
}

/** The nearest station (the lower id on a tie, `points` being sorted by id) and the nearest one of another borough. */
function nearestStation(p: Ground, points: readonly StationPoint[]): { index: number; ambiguous: boolean } {
  let index = 0
  let best = Infinity
  const ds = points.map((s, i) => {
    const d = dist(p, s)
    if (d < best) {
      best = d
      index = i
    }
    return d
  })
  const borough = points[index]!.borough
  return { index, ambiguous: points.some((s, i) => s.borough !== borough && ds[i]! <= best * BORDER_RATIO) }
}

function site(p: Ground, point: StationPoint): SearchSite {
  const ll = toLatLon(p)
  return [round5(ll.lat), round5(ll.lon), point.id]
}

function chooseName(group: Group, stats: StreetIndexStats): string {
  const [osm] = [...group.names].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))[0]!
  const display = displayStreetName(osm)
  if (streetKey(display) === group.key) return display
  stats.displayFallbacks++
  return osm
}

/** Clusters of `ids` (ascending), single-linked within INTERSECTION_MERGE_M. */
function cluster(ids: readonly number[], at: (id: number) => Ground): number[][] {
  const parent = ids.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) if (dist(at(ids[i]!), at(ids[j]!)) <= INTERSECTION_MERGE_M) parent[root(j)] = root(i)
  }
  const out = new Map<number, number[]>()
  ids.forEach((id, i) => out.set(root(i), [...(out.get(root(i)) ?? []), id]))
  return [...out.values()]
}

export function buildStreetIndex(pin: Pin, stations: readonly Station[]): { entries: StreetSearchEntry[]; stats: StreetIndexStats } {
  const points: StationPoint[] = [...stations].sort((a, b) => byCodeUnit(a.id, b.id)).map((s) => ({ id: s.id, borough: s.borough, ...toGround(s) }))
  const stats: StreetIndexStats = { streets: 0, sites: 0, intersections: 0, multiBoroughKeys: 0, borderAmbiguousVertices: 0, displayFallbacks: 0 }
  const vertices = new Map<number, Vertex>()
  const groups = new Map<string, Group>()
  const nodeKeys = new Map<number, Set<string>>()

  const vertexOf = (id: number): Vertex => {
    let v = vertices.get(id)
    if (v === undefined) {
      const node = pin.nodes.get(id)
      if (node === undefined) throw new Error(`node ${id} is not in the pin`)
      const g = toGround({ lat: node[0], lon: node[1] })
      const near = nearestStation(g, points)
      if (near.ambiguous) stats.borderAmbiguousVertices++
      v = { ...g, station: near.index, borough: points[near.index]!.borough }
      vertices.set(id, v)
    }
    return v
  }

  for (const { way } of pin.ways) {
    const name = way.tags.name ?? null
    const highway = way.tags.highway ?? ''
    if (!isStreet({ highway, name }, isClosedRing(way.nodes))) continue
    const rank = STREET_RANK[highway]
    if (rank === undefined) throw new Error(`way ${way.id}: highway=${highway} has no street rank`)
    const key = streetKey(name!)
    const vs = way.nodes.map(vertexOf)
    const groupOf = (borough: Borough): Group => {
      const gk = `${borough}\t${key}`
      let g = groups.get(gk)
      if (g === undefined) {
        g = { borough, key, names: new Map(), rank, nearest: new Map() }
        groups.set(gk, g)
      }
      return g
    }
    for (const borough of new Set(vs.map((v) => v.borough))) {
      const g = groupOf(borough)
      g.names.set(name!, (g.names.get(name!) ?? 0) + 1)
      g.rank = Math.max(g.rank, rank) as StreetRank
    }
    way.nodes.forEach((id) => {
      const keys = nodeKeys.get(id) ?? new Set<string>()
      keys.add(key)
      nodeKeys.set(id, keys)
    })
    for (let i = 0; i + 1 < vs.length; i++) {
      for (const s of new Set([vs[i]!.station, vs[i + 1]!.station])) {
        const g = groupOf(points[s]!.borough)
        const hit = nearestPoint(vs[i]!, vs[i + 1]!, points[s]!)
        const prev = g.nearest.get(s)
        if (prev === undefined || hit.d < prev.d) g.nearest.set(s, hit)
      }
    }
  }

  const streets: StreetEntry[] = []
  const display = new Map<Group, string>()
  const keysByBorough = new Map<string, Set<Borough>>()
  for (const g of groups.values()) {
    const name = chooseName(g, stats)
    display.set(g, name)
    const sites = [...g.nearest].map(([s, p]) => site(p, points[s]!)).sort((a, b) => byCodeUnit(a[2], b[2]))
    streets.push({ kind: 'street', name, borough: g.borough, rank: g.rank, sites })
    stats.sites += sites.length
    keysByBorough.set(g.key, (keysByBorough.get(g.key) ?? new Set()).add(g.borough))
  }
  stats.multiBoroughKeys = [...keysByBorough.values()].filter((b) => b.size > 1).length
  const streetNames = new Set<string>()
  for (const s of streets) {
    const id = `${s.borough}\t${s.name}`
    if (streetNames.has(id)) throw new Error(`two streets are named ${s.name} in ${s.borough}`)
    streetNames.add(id)
  }

  // Intersections: every pair of differently keyed streets at a shared node, by (borough, pair).
  const pairs = new Map<string, number[]>()
  for (const id of [...nodeKeys.keys()].sort((a, b) => a - b)) {
    const keys = [...nodeKeys.get(id)!].sort(byCodeUnit)
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const pk = `${vertices.get(id)!.borough}\t${keys[i]}\t${keys[j]}`
        pairs.set(pk, [...(pairs.get(pk) ?? []), id])
      }
    }
  }
  const intersections: IntersectionEntry[] = []
  for (const [pk, ids] of pairs) {
    const [borough, ka, kb] = pk.split('\t') as [Borough, string, string]
    const a = groups.get(`${borough}\t${ka}`)!
    const b = groups.get(`${borough}\t${kb}`)!
    const [first, second] = a.rank !== b.rank ? (a.rank > b.rank ? [a, b] : [b, a]) : byCodeUnit(display.get(a)!, display.get(b)!) <= 0 ? [a, b] : [b, a]
    for (const ns of cluster(ids, (id) => vertices.get(id)!)) {
      // The member node nearest the mean (the lower id on a tie), so the site is on both streets.
      const mean = { x: ns.reduce((sum, id) => sum + vertices.get(id)!.x, 0) / ns.length, z: ns.reduce((sum, id) => sum + vertices.get(id)!.z, 0) / ns.length }
      let node = ns[0]!
      for (const id of ns) if (dist(vertices.get(id)!, mean) < dist(vertices.get(node)!, mean)) node = id
      intersections.push({
        kind: 'intersection',
        names: [display.get(first)!, display.get(second)!],
        borough,
        rank: Math.min(a.rank, b.rank) as StreetRank,
        site: site(vertices.get(node)!, points[vertices.get(node)!.station]!),
      })
    }
  }
  stats.intersections = intersections.length
  const seen = new Set<string>()
  for (const x of intersections) {
    const id = `${x.borough}\t${x.names.join('\t')}\t${x.site[0]}\t${x.site[1]}`
    if (seen.has(id)) throw new Error(`two ${x.names.join(' & ')} intersections at ${x.site[0]},${x.site[1]} in ${x.borough}`)
    seen.add(id)
  }

  const text = (e: StreetSearchEntry): string => (e.kind === 'street' ? e.name : e.names.join(' & '))
  const at = (e: StreetSearchEntry): [number, number] => (e.kind === 'street' ? [e.sites[0]![0], e.sites[0]![1]] : [e.site[0], e.site[1]])
  const order = (x: StreetSearchEntry, y: StreetSearchEntry): number =>
    byCodeUnit(text(x), text(y)) || byCodeUnit(x.borough, y.borough) || at(x)[0] - at(y)[0] || at(x)[1] - at(y)[1]
  stats.streets = streets.length
  return { entries: [...streets.sort(order), ...intersections.sort(order)], stats }
}
