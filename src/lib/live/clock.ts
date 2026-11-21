/** A snapshot older than this (by the live clock) is dropped when a poll fails, so ghosts can't drift for long. */
export const SNAPSHOT_MAX_AGE_S = 120

/**
 * The live clock is `offsetS + performance.now() / 1000`: the Worker's `generatedAt` plus the time since
 * it arrived, so it never reads the device clock. Each poll yields `generatedAt - receivedPerfMs / 1000`;
 * a memoized response is up to 15 s old and would give a low sample, so the offset is the maximum
 * over all polls. That keeps the clock monotone and as fresh as the freshest sample.
 */
export function updateClockOffset(prev: number | null, generatedAt: number, receivedPerfMs: number): number {
  const sample = generatedAt - receivedPerfMs / 1000
  return prev === null ? sample : Math.max(prev, sample)
}

/** Epoch seconds on the live clock. */
export function clockNow(offsetS: number, perfMs: number): number {
  return offsetS + perfMs / 1000
}
