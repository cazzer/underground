export interface TokenBucket {
  capacity: number
  refillPerS: number
  tokens: number
  updatedAt: number
}

/** Starts full. */
export function createBucket(capacity: number, refillPerS: number, now: number): TokenBucket {
  return { capacity, refillPerS, tokens: capacity, updatedAt: now }
}

function refill(bucket: TokenBucket, now: number): void {
  // A clock that stepped back adds nothing.
  const elapsedS = Math.max(0, now - bucket.updatedAt) / 1000
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsedS * bucket.refillPerS)
  bucket.updatedAt = Math.max(bucket.updatedAt, now)
}

/** Takes one token from every bucket, or from none when any is empty. */
export function tryTake(buckets: TokenBucket[], now: number): boolean {
  for (const b of buckets) refill(b, now)
  if (buckets.some((b) => b.tokens < 1)) return false
  for (const b of buckets) b.tokens -= 1
  return true
}

/** Milliseconds until `tryTake` on these buckets could succeed (0 when it can now). */
export function msUntilToken(buckets: TokenBucket[], now: number): number {
  let wait = 0
  for (const b of buckets) {
    refill(b, now)
    if (b.tokens < 1) wait = Math.max(wait, ((1 - b.tokens) / b.refillPerS) * 1000)
  }
  return Math.ceil(wait)
}
