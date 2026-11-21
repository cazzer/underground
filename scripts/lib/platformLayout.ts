/** Result types of the island/side analysis. v is measured from `center`, to the right of `bearingDeg`. */
import type { LocalPoint } from '../../src/data/stationSchema.ts'

export interface PlatformLayout {
  /** OSM ways merged into this one physical platform (a split island is two ways). */
  osmWays: number[]
  kind: 'island' | 'side'
  centerV: number
  widthM: number
  uRange: [number, number]
  /** Track beside each long edge: side +1 is the edge at larger v. `trackRef` is "estimated" without track data. */
  edges: { side: -1 | 1; offsetV: number; trackRef: string }[]
}

export interface LayoutAnalysis {
  bearingDeg: number
  center: LocalPoint
  platformType: 'island' | 'side' | 'mixed' | null
  trackCount: number
  trackOffsetsV: number[]
  layouts: PlatformLayout[]
  /** Confidence to subtract. Each deduction has a line in `reasons`. */
  penalty: number
  /** Confidence ceiling (1 when none applies). */
  cap: number
  reasons: string[]
  /** No track was near any platform; the layout came from polygons alone. */
  geometryOnly: boolean
}
