/** Build-time feature switches: plain constants, no remote flag service. Typed `boolean`, not a literal, so either value typechecks. */
export const FEATURES: { readonly navigation: boolean } = {
  /** Trip planning (2q7.51): directions picks, the trip panel and announcer, and everything they load and draw. */
  navigation: false,
}
