/** Files the street and intersection entries into their hash buckets (2q7.13). Pure; the rule is src/lib/searchBucket.ts. */
import type { StreetSearchEntry, StreetSearchShard } from '../../src/data/searchSchema.ts'
import { bucketOf, entryBucketKeys, SEARCH_FORMAT, STREET_BUCKETS } from '../../src/lib/searchBucket.ts'

export const STREET_ATTRIBUTION = '© OpenStreetMap contributors'

/** One shard per bucket, STREET_BUCKETS of them, in bucket order. An entry goes into the shard of each of its bucket
 *  keys (so a few of them are in two or three), in the order given. */
export function bucketStreetShards(entries: readonly StreetSearchEntry[], osmTimestamp: string): StreetSearchShard[] {
  const shards: StreetSearchShard[] = Array.from({ length: STREET_BUCKETS }, (_, bucket) => ({
    format: SEARCH_FORMAT,
    family: 'streets',
    bucket,
    buckets: STREET_BUCKETS,
    license: 'ODbL-1.0',
    attribution: [STREET_ATTRIBUTION],
    osmTimestamp,
    entries: [],
  }))
  for (const entry of entries) {
    const names = entry.kind === 'street' ? [entry.name] : entry.names
    for (const b of new Set(entryBucketKeys(names).map((k) => bucketOf(k, STREET_BUCKETS)))) shards[b]!.entries.push(entry)
  }
  return shards
}
