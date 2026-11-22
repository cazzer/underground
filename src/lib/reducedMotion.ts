const QUERY = '(prefers-reduced-motion: reduce)'

/** Anything with a `matchMedia`, so tests can pass a stub. */
export interface MediaHost {
  matchMedia: (query: string) => { matches: boolean }
}

/**
 * A reader of the live prefers-reduced-motion setting. The query list is made on first read, so
 * importing this module never touches `window` (the pure tests run in node).
 */
export function createReducedMotion(host: () => MediaHost): () => boolean {
  let list: { matches: boolean } | null = null
  return () => (list ??= host().matchMedia(QUERY)).matches
}

/** prefers-reduced-motion: reduce, read live (a changed setting shows on the next call). The one query the app shares. */
export const prefersReducedMotion = createReducedMotion(() => window)
