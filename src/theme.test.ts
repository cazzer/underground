import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { RoutesFile } from './data/schema'
import { contrastRatio, mixHex, routeLineColor } from './lib/routeColor'

async function themes() {
  // theme.ts resolves the active theme from window.location on import; tests run in node.
  vi.stubGlobal('window', { location: { search: '' } })
  const { THEMES } = await import('./theme')
  vi.unstubAllGlobals()
  return THEMES
}

describe('status tokens', () => {
  it('read at 4.5:1 on every theme background', async () => {
    const THEMES = await themes()
    for (const t of Object.values(THEMES)) {
      for (const color of [t.statusLive, t.statusWarn, t.statusError]) {
        expect(contrastRatio(color, t.background), `${t.name} ${color}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

/** The panel's 'rgba(r, g, b, a)' composited over the background, as '#rrggbb'. */
function opaquePanel(panel: string, background: string): string {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(panel)
  if (!m) throw new Error(`panel is not rgba(): ${panel}`)
  const alpha = Number(m[4])
  const rgb = [m[1], m[2], m[3]].map(Number)
  const hex = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  return mixHex(background, hex, alpha)
}

describe('access tokens', () => {
  it('draw the access glyph (ink, dimmed for partial) at 3:1 on the panel', async () => {
    for (const t of Object.values(await themes())) {
      const panel = opaquePanel(t.panel, t.background)
      for (const [name, color] of [['ink', t.ink], ['inkDim', t.inkDim]] as const) {
        expect(contrastRatio(color, panel), `${t.name} ${name} ${color} on ${panel}`).toBeGreaterThanOrEqual(3)
      }
      // inkDim also sets the small text beside the glyph (the partial note, "partly", the borough line).
      expect(contrastRatio(t.inkDim, panel), `${t.name} inkDim text on ${panel}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/** Straight-line distance between two '#rrggbb' colors in sRGB (0 to about 441). */
function colorDistance(a: string, b: string): number {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [ra, rb] = [rgb(a), rgb(b)]
  return Math.hypot(...ra.map((v, i) => v - rb[i]!))
}

/** Smallest distance that keeps the marker apart from a line color it crosses. */
const MIN_HERE_DISTANCE = 60

describe('here token', () => {
  it('reads at 3:1 on every theme background', async () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const { THEMES } = await import('./theme')
    vi.unstubAllGlobals()
    for (const t of Object.values(THEMES)) {
      expect(contrastRatio(t.here, t.background), t.name).toBeGreaterThanOrEqual(3)
    }
  })

  it('stays apart from the focus color, the train color and every route line as drawn', async () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const { THEMES } = await import('./theme')
    vi.unstubAllGlobals()
    const routes: { id: string; color: string }[] = JSON.parse(
      readFileSync(new URL('../public/data/routes.json', import.meta.url), 'utf8'),
    ).routes
    for (const t of Object.values(THEMES)) {
      const drawn = routes.map((r) => [`route ${r.id}`, routeLineColor(`#${r.color}`, t.routeLineMix, t.background)] as const)
      for (const [name, color] of [...drawn, ['focus', t.stationFocus], ['train', t.train]] as const) {
        expect(colorDistance(t.here, color), `${t.name} here ${t.here} vs ${name} ${color}`).toBeGreaterThanOrEqual(MIN_HERE_DISTANCE)
      }
    }
  })
})

describe('street tokens', () => {
  it('read at 2.5:1 on the background and stay apart from the selected-train rim', async () => {
    for (const t of Object.values(await themes())) {
      expect(contrastRatio(t.streetStroke, t.background), `${t.name} ${t.streetStroke}`).toBeGreaterThanOrEqual(2.5)
      expect(colorDistance(t.streetStroke, t.trainSelectedRim), `${t.name} street vs rim`).toBeGreaterThanOrEqual(MIN_HERE_DISTANCE)
    }
  })
})

/** OKLab distance (about 0.1 is a clearly different color): rims are told apart from lines by hue, not only lightness. */
function oklabDistance(a: string, b: string): number {
  const lab = (hex: string): number[] => {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
    const k = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * k, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * k, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * k]
  }
  const p = lab(a)
  const q = lab(b)
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!)
}

describe('trainSelectedRim', () => {
  const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes

  it('reads at 3:1 on the background and stands apart from every drawn line color', async () => {
    for (const t of Object.values(await themes())) {
      expect(contrastRatio(t.trainSelectedRim, t.background), t.name).toBeGreaterThanOrEqual(3)
      // Nor may it pass for another marker or the focus outline: the location marker, keyboard focus, station rings.
      for (const [name, color] of [['here', t.here], ['focus outline', t.stationFocus], ['station', t.stationStroke], ['train', t.train]] as const) {
        expect(oklabDistance(t.trainSelectedRim, color), `${t.name} rim vs ${name} ${color}`).toBeGreaterThanOrEqual(0.1)
      }
      const lines = new Set(routes.map((r) => routeLineColor(`#${r.color}`, t.routeLineMix, t.background)))
      for (const line of lines) {
        expect(oklabDistance(t.trainSelectedRim, line), `${t.name} vs ${line}`).toBeGreaterThanOrEqual(0.1)
        // Blueprint lines span too wide a lightness range (each line is 3:1 on the background)
        // for any color to reach 2:1 against all of them, so there the gap and the hue carry the rim.
        if (t.routeLineMix.amount >= 1) expect(contrastRatio(t.trainSelectedRim, line), `${t.name} vs ${line}`).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

/**
 * Machado, Oliveira and Fernandes (2009) dichromacy matrices at severity 1, applied in linear sRGB:
 * deuteranopia and protanopia, the common red-green color blindness.
 */
const CVD = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
} as const

/** '#rrggbb' as a dichromat sees it, per `CVD`. */
function simulateCvd(hex: string, m: (typeof CVD)[keyof typeof CVD]): string {
  const n = parseInt(hex.slice(1), 16)
  const lin = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const out = m.map((row) => Math.min(1, Math.max(0, row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!)))
  const srgb = out.map((c) => Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255))
  return `#${srgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * OKLab distance a machine color keeps from the stroke, track and entrance colors under simulated
 * red-green color blindness. Lower than the 0.1 used for normal vision: dichromacy collapses a whole
 * axis of color, and the line shapes (no step hatch, shafts) carry the rest.
 */
const MIN_CVD_DISTANCE = 0.06

describe('interior machine tokens', () => {
  it('read at 3:1 on the background on the deepest level, after their share of the depth fade', async () => {
    const { MACHINE_DEPTH_FADE_SHARE } = await import('./theme')
    for (const t of Object.values(await themes())) {
      const fade = t.interiorDepthFade * MACHINE_DEPTH_FADE_SHARE
      for (const [name, token] of [['elevator', t.interiorElevator], ['escalator', t.interiorEscalator]] as const) {
        const deepest = mixHex(token, t.background, fade)
        expect(contrastRatio(deepest, t.background), `${t.name} ${name} ${deepest}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('stand apart from the other interior tokens, statusError and each other', async () => {
    for (const t of Object.values(await themes())) {
      const others = [
        ['stroke', t.interiorStroke],
        ['track', t.interiorTrack],
        ['entrance', t.interiorEntrance],
        ['fine', t.interiorFine],
        ['statusError', t.statusError],
      ] as const
      for (const [name, token] of [['elevator', t.interiorElevator], ['escalator', t.interiorEscalator]] as const) {
        for (const [other, color] of others) {
          expect(oklabDistance(token, color), `${t.name} ${name} ${token} vs ${other} ${color}`).toBeGreaterThanOrEqual(0.1)
        }
      }
      expect(oklabDistance(t.interiorElevator, t.interiorEscalator), t.name).toBeGreaterThanOrEqual(0.1)
    }
  })

  it('stay apart from the stroke, track, entrance and each other under simulated deuteranopia and protanopia', async () => {
    for (const t of Object.values(await themes())) {
      for (const [mode, m] of Object.entries(CVD)) {
        const machines = oklabDistance(simulateCvd(t.interiorElevator, m), simulateCvd(t.interiorEscalator, m))
        expect(machines, `${t.name} ${mode} elevator ${t.interiorElevator} vs escalator ${t.interiorEscalator}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
        for (const [name, token] of [['elevator', t.interiorElevator], ['escalator', t.interiorEscalator]] as const) {
          for (const [other, color] of [['stroke', t.interiorStroke], ['track', t.interiorTrack], ['entrance', t.interiorEntrance]] as const) {
            const d = oklabDistance(simulateCvd(token, m), simulateCvd(color, m))
            expect(d, `${t.name} ${mode} ${name} ${token} vs ${other} ${color}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
          }
        }
      }
    }
  })
})
