/** A User Timing measure `name` from `start` (a `performance.now()` value) to now; `?debug` and devtools read it. */
export function measureSince(name: string, start: number): void {
  performance.measure(name, { start, end: performance.now() })
}
