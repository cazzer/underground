import type { RouteLineMix } from './lib/routeColor'

/** Every color, line width, and font token lives here. Never hardcode these elsewhere. */
export interface Theme {
  name: string
  /** Canvas and page background. */
  background: string
  /** Faint ground grid (cell lines, then every-10th section lines). */
  gridCell: string
  gridSection: string
  /** How a route's GTFS color is drawn: mixed toward a theme color (amount 1 = mono). */
  routeLineMix: RouteLineMix
  /** TEMPORARY (removed with ?lines=, see LineHighlight.tsx): single line color for the mono looks a and c. */
  lineMono: string
  /** Line width in screen pixels. */
  lineWidth: number
  /** Center-to-center gap, CSS px, between routes drawn side by side in a shared corridor (bandOffset.ts). */
  bandPitchPx: number
  stationFill: string
  stationStroke: string
  stationFocus: string
  /** The vertical tie from a station marker down to its sunken platform tracks (StationTies.tsx), CSS px. */
  stationTieWidth: number
  train: string
  /** "You are here" marker and its accuracy disc; at least 3:1 on the background and distinct from the focus and train colors (theme.test.ts). */
  here: string
  /** 0..1 fill of the accuracy disc, and the width in screen pixels of its edge and the reticle. */
  hereAccuracyOpacity: number
  hereLineWidth: number
  /**
   * Rim drawn around the selected train (dot and cars), outside a background-colored gap. A hue no route line
   * uses, at least 3:1 on the background; theme.test.ts holds it apart from every route line color. Interior
   * tokens may share its hue: the street layer is veiled under an interior.
   */
  trainSelectedRim: string
  /** Train car shading: linear multipliers of the car color on its sides and ends (the roof is 1). */
  trainCarSideShade: number
  trainCarEndShade: number
  /** Live-trains state in the HUD: connected, delayed, failed. Each is at least 4.5:1 on the background (theme.test.ts). */
  statusLive: string
  statusWarn: string
  statusError: string
  /** HUD */
  ink: string
  inkDim: string
  panel: string
  panelBorder: string
  fontSans: string
  fontMono: string
  /** Station interior: outlines and stairs; track centerlines; street entrances; steps, guides, fare lines. */
  interiorStroke: string
  interiorTrack: string
  interiorEntrance: string
  interiorFine: string
  /**
   * Station interior machines: elevators and escalators. Each stays at least 3:1 on the background on the
   * deepest level (faded by `interiorDepthFade × MACHINE_DEPTH_FADE_SHARE`), and apart from the other interior
   * tokens and statusError (which 9wc.5 will use for outages), also under simulated red-green color
   * blindness (theme.test.ts).
   */
  interiorElevator: string
  interiorEscalator: string
  /** Interior line widths in screen pixels (strong and fine strokes). */
  interiorLineWidth: number
  interiorFineWidth: number
  /** 0..1: how far the deepest level's strokes mix toward the background (depth cue). */
  interiorDepthFade: number
  /** Dash and gap of a generated interior's platform and slab outlines and slab guides, in world meters. */
  interiorApproxDash: number
  interiorApproxGap: number
  /**
   * The focused station's streets (StationStreets.tsx), a faint street-level layer under the route lines. Faint by
   * color, not alpha (a translucent LineSegments2 beads at its joints); at least 2.5:1 on the background, since the
   * interior veil dims it, and apart from the selected-train rim (theme.test.ts).
   */
  streetStroke: string
  /** Street line width in CSS px. */
  streetWidth: number
}

/** Machines (elevators, escalators) take this share of `interiorDepthFade`, so the deepest ones stay 3:1. */
export const MACHINE_DEPTH_FADE_SHARE = 0.5

const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export const THEMES = {
  blueprint: {
    name: 'blueprint',
    background: '#0b2147',
    gridCell: '#16376e',
    gridSection: '#2a5aa8',
    routeLineMix: { toward: '#ffffff', amount: 0.3 },
    lineMono: '#5ce1ff',
    lineWidth: 1.5,
    bandPitchPx: 2.5,
    stationFill: '#0b2147',
    stationStroke: '#ffffff',
    stationFocus: '#ffd166',
    stationTieWidth: 1,
    train: '#ffffff',
    here: '#5ce1ff',
    hereAccuracyOpacity: 0.15,
    hereLineWidth: 1.5,
    trainSelectedRim: '#ff5cf0',
    trainCarSideShade: 0.55,
    trainCarEndShade: 0.75,
    statusLive: '#7cf5a6',
    statusWarn: '#ffd166',
    statusError: '#ff6b6b',
    ink: '#e6f6ff',
    inkDim: '#8fb4de',
    panel: 'rgba(11, 33, 71, 0.82)',
    panelBorder: '#5ce1ff',
    fontSans: mono,
    fontMono: mono,
    interiorStroke: '#e6f6ff',
    interiorTrack: '#5ce1ff',
    interiorEntrance: '#ffd166',
    interiorFine: '#8fb4de',
    interiorElevator: '#c38cff',
    interiorEscalator: '#7cf5a6',
    interiorLineWidth: 1.5,
    interiorFineWidth: 1,
    interiorDepthFade: 0.5,
    interiorApproxDash: 1.5,
    interiorApproxGap: 0.75,
    streetStroke: '#4a6aa0',
    streetWidth: 1,
  },
} as const satisfies Record<string, Theme>

/** Blueprint is the only theme (the user's pick). Every token above is its value. */
export const theme: Theme = THEMES.blueprint

/**
 * TEMPORARY until the lines look is picked (8x4.3 options round); remove with the unchosen
 * variants. `?lines=a`: mono lines plus the focused station's routes in color; `b` (default):
 * route colors via routeLineMix; `c`: mono at overview, route colors fade in when zoomed in.
 */
export type LinesMode = 'a' | 'b' | 'c'

export function resolveLinesMode(search: string): LinesMode {
  const requested = new URLSearchParams(search).get('lines')
  return requested === 'a' || requested === 'c' ? requested : 'b'
}

export const linesMode: LinesMode = resolveLinesMode(window.location.search)

/** Mix rule for the always-on line layer under the current lines mode. */
export function baseLineMix(t: Theme, mode: LinesMode): RouteLineMix {
  return mode === 'b' ? t.routeLineMix : { toward: t.lineMono, amount: 1 }
}

/** Expose HUD tokens as CSS variables; Tailwind reads them via `@theme inline` in index.css. */
export function applyThemeCss(t: Theme, root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--ug-bg': t.background,
    '--ug-ink': t.ink,
    '--ug-ink-dim': t.inkDim,
    '--ug-panel': t.panel,
    '--ug-panel-border': t.panelBorder,
    '--ug-focus': t.stationFocus,
    '--ug-here': t.here,
    '--ug-status-live': t.statusLive,
    '--ug-status-warn': t.statusWarn,
    '--ug-status-error': t.statusError,
    '--ug-font-sans': t.fontSans,
    '--ug-font-mono': t.fontMono,
  }
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
}
