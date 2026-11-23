import type { BasemapClass } from './lib/basemap/featureClass'
import type { RouteLineMix } from './lib/routeColor'

/** Every color, line width, and font token lives here. Never hardcode these elsewhere. */
export interface Theme {
  name: string
  /** Canvas and page background. */
  background: string
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
   * The pin on a searched place, street or intersection (PlacePin.tsx): a diamond outline and dot. At least 3:1 on the
   * background and held apart from `here`, `stationFocus`, `exitPath`, the selected-train rim and every drawn route
   * color, also under simulated red-green color blindness (theme.test.ts). Its shape (a diamond, not a ring) carries the rest.
   */
  placePin: string
  /** The pin outline's width in CSS px. */
  placePinWidth: number
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
   * tokens, also under simulated red-green color blindness (theme.test.ts).
   */
  interiorElevator: string
  interiorEscalator: string
  /**
   * An out-of-service elevator or escalator (drawn with an X): 3:1 on the background at the deepest machine
   * fade, and apart from every other interior token, also under simulated deuteranopia and protanopia
   * (theme.test.ts). The same value as statusError, which marks the same thing in the station panel.
   */
  interiorOutage: string
  /** Interior line widths in screen pixels (strong and fine strokes). */
  interiorLineWidth: number
  interiorFineWidth: number
  /** 0..1: how far the deepest level's strokes mix toward the background (depth cue). */
  interiorDepthFade: number
  /** Dash and gap of a generated interior's platform and slab outlines and slab guides, in world meters. */
  interiorApproxDash: number
  interiorApproxGap: number
  /**
   * The focused station's streets (StationStreets.tsx), a faint street-level layer under the route lines. At rest it
   * is faint by color and drawn opaque (a translucent LineSegments2 beads at its joints); it fades in with the
   * interior reveal through material.opacity, as the interior does, so it is briefly translucent mid-fade (accepted),
   * and its last 70 m mix to the background (streetBuffers.ts). A neutral gray, 2.5:1 to 4:1 on the
   * background (fainter than the route lines), at least 60 in sRGB from every drawn route color
   * (theme.test.ts). With the station's interior loaded under look A they draw above the veil instead,
   * at a fainter stroke, 1.8 to 2:1 (veiledStreetHex in streetVeil.ts; the test keeps that range), built into
   * their vertex colors: the interior is the subject, and the DOM labels carry the street names. TEMPORARY `?streets=under`
   * (streetsLook.ts) keeps them under the veil, where look A leaves them at about 1.25:1, a floor the test keeps;
   * `?streets=over` draws them above it at full color; both for the ost.7 look card.
   */
  streetStroke: string
  /** Street line width in CSS px. */
  streetWidth: number
  /**
   * The citywide basemap (Basemap.tsx), one stroke and width (CSS px) per class, under
   * every route line. All 1 px (a wider stroke marks only the subway). Roads are blue-grays fainter than `streetStroke`
   * and every drawn route color, in steps: highway (bluer, about 2.5:1) over major (about 2:1) over minor (about
   * 1.45:1) over path (at least 1.3:1); highway also differs from major by tone. Water a teal and parks a green, each
   * 1.5:1 to 2.5:1. All
   * stay 60 in sRGB from the route colors, the rim and `here`, and 0.05 in OKLab from each other
   * across water, park and roads (themeBasemap.test.ts). Drawn opaque; a class fades by mixing toward the background.
   */
  basemap: Readonly<Record<BasemapClass, { stroke: string; width: number }>>
  /**
   * The trip's way out at its To station (ExitPath.tsx): centerline, restroked connectors, the exit's entrance and the
   * board marker. 3:1 on the background, apart from every interior token, the focus and location colors and every
   * drawn route color, and under simulated deuteranopia and protanopia from the interior's structural and machine
   * tokens (theme.test.ts). Not held apart from trainSelectedRim: both mark the trip's own things. Also the trip's walks
   * between stations (TripDashes.tsx) and its board, change and alight rings (TripMarks.tsx) on the map, at least 2.5:1
   * over every route dimmed by `tripNetworkDim` and on the background when faint (themeTrip.test.ts).
   */
  exitPath: string
  /** Exit path line width in CSS px. */
  exitPathWidth: number
  /** Dash and gap of the exit path on an estimated layout (and of an estimated walk outside), world meters. */
  exitPathDash: number
  exitPathGap: number
  /**
   * The trip's route (TripLines.tsx) while the trip panel is in front: the rest of the network mixes this far toward
   * the background (in sRGB, by color, never opacity; at least 1.2:1 left, themeTrip.test.ts), the opened journey's
   * ride legs draw at full color `tripLineWidth` CSS px wide, and in the list view (no journey opened) the first
   * journey's draw at the base width, mixed `tripFaintDim` toward the background, still clearly above the network.
   */
  tripNetworkDim: number
  tripFaintDim: number
  tripLineWidth: number
  /**
   * Dash and gap, CSS px at the view's target (world meters times the dash scale written per frame), of the trip's
   * walks between stations and of a ride drawn straight through its stops (TripDashes.tsx).
   */
  tripWalkDashPx: number
  tripWalkGapPx: number
}

/** Machines (elevators, escalators) take this share of `interiorDepthFade`, so the deepest ones stay 3:1. */
export const MACHINE_DEPTH_FADE_SHARE = 0.5

/** Shared by the status color and the interior's out-of-service machines, which mark the same thing. */
const statusError = '#ff6b6b'
const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export const THEMES = {
  blueprint: {
    name: 'blueprint',
    background: '#0b2147',
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
    placePin: '#f5ff00',
    placePinWidth: 2,
    trainSelectedRim: '#ff5cf0',
    trainCarSideShade: 0.55,
    trainCarEndShade: 0.75,
    statusLive: '#7cf5a6',
    statusWarn: '#ffd166',
    statusError,
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
    interiorOutage: statusError,
    interiorLineWidth: 1.5,
    interiorFineWidth: 1,
    interiorDepthFade: 0.5,
    interiorApproxDash: 1.5,
    interiorApproxGap: 0.75,
    streetStroke: '#646468',
    streetWidth: 1,
    basemap: {
      highway: { stroke: '#525f78', width: 1 },
      major: { stroke: '#495163', width: 1 },
      minor: { stroke: '#353d4f', width: 1 },
      path: { stroke: '#2f3748', width: 1 },
      water: { stroke: '#16606e', width: 1 },
      park: { stroke: '#385446', width: 1 },
    },
    exitPath: '#ff5cb8',
    exitPathWidth: 3,
    exitPathDash: 3,
    exitPathGap: 2,
    tripNetworkDim: 0.7,
    tripFaintDim: 0.35,
    tripLineWidth: 2.5,
    tripWalkDashPx: 6,
    tripWalkGapPx: 4,
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
