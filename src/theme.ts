/** Every color, line width, and font token lives here. Never hardcode these elsewhere. */
export interface Theme {
  name: string
  /** Canvas and page background. */
  background: string
  /** Faint ground grid (cell lines, then every-10th section lines). */
  gridCell: string
  gridSection: string
  /** Subway line colors, indexed by line order (wraps). */
  lines: readonly string[]
  /** Line width in screen pixels. */
  lineWidth: number
  stationFill: string
  stationStroke: string
  stationFocus: string
  train: string
  /** HUD */
  ink: string
  inkDim: string
  panel: string
  panelBorder: string
  fontSans: string
  fontMono: string
}

const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export const THEMES = {
  blueprint: {
    name: 'blueprint',
    background: '#0b2147',
    gridCell: '#16376e',
    gridSection: '#2a5aa8',
    lines: ['#5ce1ff', '#ffffff', '#ffd166'],
    lineWidth: 1.5,
    stationFill: '#0b2147',
    stationStroke: '#ffffff',
    stationFocus: '#ffd166',
    train: '#ffffff',
    ink: '#e6f6ff',
    inkDim: '#8fb4de',
    panel: 'rgba(11, 33, 71, 0.82)',
    panelBorder: '#5ce1ff',
    fontSans: mono,
    fontMono: mono,
  },
  drafting: {
    name: 'drafting',
    background: '#f3efe4',
    gridCell: '#e2dccb',
    gridSection: '#cfc7b0',
    lines: ['#2b2b2b', '#a63d2f', '#2f5d8a'],
    lineWidth: 1.25,
    stationFill: '#f3efe4',
    stationStroke: '#2b2b2b',
    stationFocus: '#a63d2f',
    train: '#2b2b2b',
    ink: '#2b2b2b',
    inkDim: '#6b6655',
    panel: 'rgba(243, 239, 228, 0.9)',
    panelBorder: '#2b2b2b',
    fontSans: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
    fontMono: mono,
  },
  terminal: {
    name: 'terminal',
    background: '#000000',
    gridCell: '#06210f',
    gridSection: '#0d4a22',
    lines: ['#33ff66', '#b6ff33', '#33ffd0'],
    lineWidth: 1.5,
    stationFill: '#000000',
    stationStroke: '#33ff66',
    stationFocus: '#ffffff',
    train: '#eaffef',
    ink: '#33ff66',
    inkDim: '#1f9940',
    panel: 'rgba(0, 0, 0, 0.85)',
    panelBorder: '#33ff66',
    fontSans: mono,
    fontMono: mono,
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

/** Expose HUD tokens as CSS variables; Tailwind reads them via `@theme inline` in index.css. */
export function applyThemeCss(t: Theme, root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--ug-bg': t.background,
    '--ug-ink': t.ink,
    '--ug-ink-dim': t.inkDim,
    '--ug-panel': t.panel,
    '--ug-panel-border': t.panelBorder,
    '--ug-focus': t.stationFocus,
    '--ug-font-sans': t.fontSans,
    '--ug-font-mono': t.fontMono,
  }
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
}
