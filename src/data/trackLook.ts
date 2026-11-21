/**
 * TEMPORARY until the track spacing is picked (underground-pah.5 look round). `?tracks=a|b|off`
 * picks how far each direction's track sits right of its shape: a = 4.7 m (measured at Bedford Av,
 * the default), b = 3 m, off = 0 (both directions on one line). Read once at load and passed to
 * `buildNetwork`; everything else, realtime geometry included, reads `network.trackOffsetM`
 * and never imports this file (it reads `window`, and the realtime tests run in Node).
 * Once decided, remove together:
 * - this file: replace `trackOffsetM` with one exported constant (in src/lib/trackOffset.ts)
 * - src/lib/trackOffset.ts: `TRACK_OFFSETS`, `resolveTrackOffset`, and their tests in
 *   trackOffset.test.ts (point scripts/lib/trackAlignment.test.ts at the constant)
 * - AGENTS.md: the `?tracks=` TEMPORARY note in the rendering conventions and this file's entry
 *   in the src/data map
 */
import { resolveTrackOffset } from '../lib/trackOffset'

export const trackOffsetM = resolveTrackOffset(window.location.search)
