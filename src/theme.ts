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
   * tokens may share its hue (drafting's escalator is also violet): the street layer is veiled under an interior.
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
  },
  drafting: {
    name: 'drafting',
    background: '#f3efe4',
    gridCell: '#e2dccb',
    gridSection: '#cfc7b0',
    routeLineMix: { toward: '#2b2b2b', amount: 0.15 },
    lineMono: '#2b2b2b',
    lineWidth: 1.25,
    stationFill: '#f3efe4',
    stationStroke: '#2b2b2b',
    stationFocus: '#a63d2f',
    stationTieWidth: 1,
    train: '#2b2b2b',
    here: '#c71f7a',
    hereAccuracyOpacity: 0.15,
    hereLineWidth: 1.5,
    trainSelectedRim: '#6a00c8',
    trainCarSideShade: 0.6,
    trainCarEndShade: 0.8,
    statusLive: '#2f6b3a',
    statusWarn: '#8a5a00',
    statusError: '#a63d2f',
    ink: '#2b2b2b',
    inkDim: '#6b6655',
    panel: 'rgba(243, 239, 228, 0.9)',
    panelBorder: '#2b2b2b',
    fontSans: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
    fontMono: mono,
    interiorStroke: '#2b2b2b',
    interiorTrack: '#a63d2f',
    interiorEntrance: '#a63d2f',
    interiorFine: '#8a8370',
    interiorElevator: '#1d6f8f',
    interiorEscalator: '#7b2cbf',
    interiorLineWidth: 1.25,
    interiorFineWidth: 1,
    interiorDepthFade: 0.5,
  },
  terminal: {
    name: 'terminal',
    background: '#000000',
    gridCell: '#06210f',
    gridSection: '#0d4a22',
    routeLineMix: { toward: '#33ff66', amount: 1 },
    lineMono: '#33ff66',
    lineWidth: 1.5,
    stationFill: '#000000',
    stationStroke: '#33ff66',
    stationFocus: '#ffffff',
    stationTieWidth: 1,
    train: '#eaffef',
    here: '#5ce1ff',
    hereAccuracyOpacity: 0.15,
    hereLineWidth: 1.5,
    trainSelectedRim: '#d07800',
    trainCarSideShade: 0.45,
    trainCarEndShade: 0.7,
    statusLive: '#33ff66',
    statusWarn: '#ffff66',
    statusError: '#ff5555',
    ink: '#33ff66',
    inkDim: '#1f9940',
    panel: 'rgba(0, 0, 0, 0.85)',
    panelBorder: '#33ff66',
    fontSans: mono,
    fontMono: mono,
    interiorStroke: '#33ff66',
    interiorTrack: '#eaffef',
    interiorEntrance: '#ffffff',
    interiorFine: '#1f9940',
    interiorElevator: '#ff66cc',
    interiorEscalator: '#33ccff',
    interiorLineWidth: 1.5,
    interiorFineWidth: 1,
    interiorDepthFade: 0.5,
  },
} as const satisfies Record<string, Theme>

export type ThemeName = keyof typeof THEMES

export const DEFAULT_THEME: ThemeName = 'blueprint'

function isThemeName(value: string | null): value is ThemeName {
  return value !== null && Object.hasOwn(THEMES, value)
}

/** Resolve a theme from a URL search string such as `?theme=drafting`. Unknown names fall back to the default. */
export function resolveTheme(search: string): Theme {
  const requested = new URLSearchParams(search).get('theme')
  return THEMES[isThemeName(requested) ? requested : DEFAULT_THEME]
}

export const theme: Theme = resolveTheme(window.location.search)

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
