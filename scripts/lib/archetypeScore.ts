/** Scoring of archetype results against the Wikipedia-checked layout oracle and the pathways topology.
 *  Pure: formats text for scripts/score-archetypes.ts to print. Nothing here is written to a file. */
import type { Archetype, ArchetypeResult } from './archetype.ts'
import type { DeclinedStation, OracleStation } from './layoutOracle.ts'
import type { StationTopology } from './pathwaysTopology.ts'

export interface Classified {
  stationId: string
  name: string
  result: ArchetypeResult
}

const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`)
const pad = (s: string | number, w: number): string => String(s).padEnd(w)

export function distribution(all: Classified[], bar: number): string[] {
  const count = (pred: (c: Classified) => boolean): Map<Archetype, number> => {
    const m = new Map<Archetype, number>()
    for (const c of all.filter(pred)) m.set(c.result.archetype, (m.get(c.result.archetype) ?? 0) + 1)
    return m
  }
  const total = count(() => true)
  const clear = count((c) => c.result.confidence >= bar)
  const clearing = all.filter((c) => c.result.confidence >= bar).length
  const lines = [`Archetype distribution over ${all.length} stations (all / at or above ${bar}):`]
  for (const [a, n] of [...total.entries()].sort((x, y) => y[1] - x[1])) lines.push(`  ${pad(a, 24)} ${pad(n, 5)} ${clear.get(a) ?? 0}`)
  lines.push(`Coverage at the bar: ${pct(clearing, all.length)}`)
  return lines
}

export interface OracleOutcome {
  oracle: OracleStation
  result: ArchetypeResult
  /** Platform type and track count both right. */
  correct: boolean
  problems: string[]
}

export function judge(oracle: OracleStation, result: ArchetypeResult): OracleOutcome {
  const problems: string[] = []
  if (!result.params) problems.push(`no params (${result.archetype}, ${result.confidence.toFixed(2)})`)
  else {
    if (result.params.platformType !== oracle.platformType) problems.push(`platform type ${result.params.platformType}, article says ${oracle.platformType}`)
    if (result.params.trackCount !== oracle.tracks) problems.push(`${result.params.trackCount} tracks, article says ${oracle.tracks}`)
    if (oracle.mezzanine !== null && result.params.hasMezzanine !== oracle.mezzanine) problems.push(`mezzanine ${result.params.hasMezzanine}, article says ${oracle.mezzanine}`)
  }
  const structural = problems.filter((p) => !p.startsWith('mezzanine'))
  return { oracle, result, correct: structural.length === 0, problems }
}

export function oracleReport(outcomes: OracleOutcome[], bar: number): string[] {
  const lines = [`Oracle: ${outcomes.length} stations (agent-checked against Wikipedia, not human-checked)`]
  const kinds = ['island', 'side', 'mixed'] as const
  const real = outcomes
  lines.push('Platform type, rows = article, columns = classifier (none = no params):')
  lines.push(`  ${pad('', 8)}${[...kinds, 'none'].map((k) => pad(k, 8)).join('')}`)
  for (const k of kinds) {
    const row = real.filter((o) => o.oracle.platformType === k)
    const cell = (c: string): number => row.filter((o) => (o.result.params?.platformType ?? 'none') === c).length
    lines.push(`  ${pad(k, 8)}${[...kinds, 'none'].map((c) => pad(cell(c), 8)).join('')}`)
  }
  const withParams = real.filter((o) => o.result.params)
  const trackOk = withParams.filter((o) => o.result.params!.trackCount === o.oracle.tracks).length
  const stated = withParams.filter((o) => o.oracle.mezzanine !== null)
  const mezzOk = stated.filter((o) => o.result.params!.hasMezzanine === o.oracle.mezzanine).length
  lines.push(`Track count accuracy: ${pct(trackOk, withParams.length)}`)
  lines.push(`Mezzanine agreement (where the article says): ${pct(mezzOk, stated.length)}`)
  const above = outcomes.filter((o) => o.result.confidence >= bar)
  lines.push(`Precision at or above ${bar} (platform type and track count right): ${pct(above.filter((o) => o.correct).length, above.length)}`)
  lines.push(`Recall of clearing the bar among non-declined: ${pct(real.filter((o) => o.result.confidence >= bar).length, real.length)}`)
  lines.push('Per oracle station (archetype, confidence, problems):')
  for (const o of outcomes) {
    lines.push(`  ${o.correct && o.problems.length === 0 ? 'ok  ' : o.correct ? 'mezz' : 'MISS'} ${pad(o.oracle.stationId, 5)}${pad(o.oracle.name, 34)}${pad(o.result.archetype, 24)}${o.result.confidence.toFixed(2)}  ${o.problems.join('; ')}`)
  }
  return lines
}

export function declinedReport(declined: DeclinedStation[], results: Map<string, ArchetypeResult>, bar: number): string[] {
  const rows = declined.map((d) => ({ d, r: results.get(d.stationId)! }))
  const below = rows.filter((x) => x.r.confidence < bar).length
  const lines = [`Declined stations (complexes and multi-level): ${pct(below, rows.length)} stay below ${bar}`]
  for (const { d, r } of rows) lines.push(`  ${r.confidence < bar ? 'ok  ' : 'MISS'} ${pad(d.stationId, 5)}${pad(d.name, 34)}${pad(d.reason, 12)}${pad(r.archetype, 24)}${r.confidence.toFixed(2)}`)
  return lines
}

export function pathwaysReport(all: Classified[], topo: Map<string, StationTopology>): string[] {
  const rows = all.filter((c) => c.result.params?.trackCount === 2 && topo.has(c.stationId))
  const lines = [`Pathways cross-check on ${rows.length} classified 2-track stations that have pathways data:`]
  const checks: [string, (c: Classified, t: StationTopology) => boolean][] = [
    ['hasMezzanine', (c, t) => c.result.params!.hasMezzanine === t.hasMezzanine],
    ['perDirection (side platforms <-> disjoint links)', (c, t) => (c.result.params!.platformType === 'side') === (t.perDirection === true)],
    ['sharedConnector (island <-> one connector for both)', (c, t) => (c.result.params!.platformType === 'island') === t.sharedConnector],
  ]
  const bad: string[] = []
  for (const [label, ok] of checks) {
    const wrong = rows.filter((c) => !ok(c, topo.get(c.stationId)!))
    lines.push(`  ${label}: agree ${pct(rows.length - wrong.length, rows.length)}`)
    for (const c of wrong) {
      const t = topo.get(c.stationId)!
      bad.push(`  ${pad(label.split(' ')[0]!, 14)}${pad(c.stationId, 5)}${pad(c.name, 34)}classifier ${c.result.params!.platformType}/mezz ${c.result.params!.hasMezzanine} (${c.result.confidence.toFixed(2)}); pathways mezz ${t.hasMezzanine} count ${t.mezzanineCount} perDirection ${t.perDirection} shared ${t.sharedConnector}`)
    }
  }
  lines.push('Pathways disagreements:', ...bad)
  return lines
}
