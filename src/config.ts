/**
 * Build-time feature switches: plain constants, no remote flag service. Typed `boolean`, not a literal, so either
 * value typechecks. `?nav=1` (or `on`, `true`) turns navigation on for that page load, to try it on the deployed site.
 */
export function resolveNavigation(search: string): boolean {
  const value = new URLSearchParams(search).get('nav')
  return value === '1' || value === 'on' || value === 'true'
}

export const FEATURES: { readonly navigation: boolean } = {
  /** Trip planning (2q7.51): directions picks, the trip panel and announcer, and everything they load and draw. */
  navigation: typeof window !== 'undefined' && resolveNavigation(window.location.search),
}
