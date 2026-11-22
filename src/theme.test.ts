import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { RoutesFile } from './data/schema'
import { colorDistance, CVD, MIN_CVD_DISTANCE, oklabDistance, simulateCvd } from './lib/colorMetrics'
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

/** Smallest sRGB distance between the street stroke and a color it must not pass for. */
const MIN_STREET_DISTANCE = 60
/** The street stroke stays fainter than the route lines, yet reads on the background. */
const STREET_CONTRAST_MIN = 2.5
const STREET_CONTRAST_MAX = 4
/** Under look A's veil at full 3D the streets nearly vanish (the interior is the subject), but not entirely. */
const STREET_VEILED_FLOOR = 1.25

describe('street tokens', () => {
  it('read faintly on the background, fainter than the route lines', async () => {
    for (const t of Object.values(await themes())) {
      const c = contrastRatio(t.streetStroke, t.background)
      expect(c, `${t.name} ${t.streetStroke}`).toBeGreaterThanOrEqual(STREET_CONTRAST_MIN)
      expect(c, `${t.name} ${t.streetStroke}`).toBeLessThanOrEqual(STREET_CONTRAST_MAX)
    }
  })

  it('keep the veiled floor under look A at full 3D (?streets=under)', async () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const { resolveInteriorLook } = await import('./scene/interiorLook')
    vi.unstubAllGlobals()
    const look = resolveInteriorLook('?interior=a')
    for (const t of Object.values(await themes())) {
      // The veil is the background at veilOpacity × veilWeight, and veilWeight is 1 at full 3D.
      const veiled = mixHex(t.background, t.streetStroke, 1 - look.veilOpacity)
      expect(contrastRatio(veiled, t.background), `${t.name} veiled ${veiled}`).toBeGreaterThanOrEqual(STREET_VEILED_FLOOR)
    }
  })

  it('rest at about 1.8 to 2:1 above the veil at full 3D (the auto draw order with an interior, look A)', async () => {
    const { veiledStreetHex } = await import('./lib/streetVeil')
    for (const t of Object.values(await themes())) {
      const veiled = veiledStreetHex(t.streetStroke, t.background)
      const c = contrastRatio(veiled, t.background)
      expect(c, `${t.name} over-veil ${veiled}`).toBeGreaterThanOrEqual(1.8)
      expect(c, `${t.name} over-veil ${veiled}`).toBeLessThanOrEqual(2)
    }
  })

  it('stay apart from every drawn route color, the grid and the selected-train rim', async () => {
    const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes
    for (const t of Object.values(await themes())) {
      const drawn = routes.map((r) => [`route ${r.id}`, routeLineColor(`#${r.color}`, t.routeLineMix, t.background)] as const)
      const others = [...drawn, ['gridSection', t.gridSection], ['gridCell', t.gridCell], ['rim', t.trainSelectedRim]] as const
      for (const [name, color] of others) {
        expect(colorDistance(t.streetStroke, color), `${t.name} street ${t.streetStroke} vs ${name} ${color}`).toBeGreaterThanOrEqual(MIN_STREET_DISTANCE)
      }
    }
  })
})

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

  it('stand apart from the other interior tokens and each other', async () => {
    for (const t of Object.values(await themes())) {
      const others = [
        ['stroke', t.interiorStroke],
        ['track', t.interiorTrack],
        ['entrance', t.interiorEntrance],
        ['fine', t.interiorFine],
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

describe('interiorOutage', () => {
  it('reads at 3:1 on the background on the deepest level, after the machine depth fade', async () => {
    const { MACHINE_DEPTH_FADE_SHARE } = await import('./theme')
    for (const t of Object.values(await themes())) {
      const deepest = mixHex(t.interiorOutage, t.background, t.interiorDepthFade * MACHINE_DEPTH_FADE_SHARE)
      expect(contrastRatio(deepest, t.background), `${t.name} ${deepest}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('stands apart from every other interior token, also under simulated deuteranopia and protanopia', async () => {
    for (const t of Object.values(await themes())) {
      const others = [
        ['stroke', t.interiorStroke],
        ['track', t.interiorTrack],
        ['entrance', t.interiorEntrance],
        ['fine', t.interiorFine],
        ['elevator', t.interiorElevator],
        ['escalator', t.interiorEscalator],
        ['rim', t.trainSelectedRim],
      ] as const
      for (const [other, color] of others) {
        expect(oklabDistance(t.interiorOutage, color), `${t.name} vs ${other} ${color}`).toBeGreaterThanOrEqual(0.1)
        for (const [mode, m] of Object.entries(CVD)) {
          const d = oklabDistance(simulateCvd(t.interiorOutage, m), simulateCvd(color, m))
          expect(d, `${t.name} ${mode} vs ${other} ${color}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
        }
      }
    }
  })
})

describe('exitPath', () => {
  const routes = (JSON.parse(readFileSync('public/data/routes.json', 'utf8')) as RoutesFile).routes

  it('reads at 3:1 on the background', async () => {
    for (const t of Object.values(await themes())) expect(contrastRatio(t.exitPath, t.background), t.name).toBeGreaterThanOrEqual(3)
  })

  it('stands apart from every interior token, the focus and location colors and every drawn route color', async () => {
    for (const t of Object.values(await themes())) {
      const lines = routes.map((r) => [`route ${r.id}`, routeLineColor(`#${r.color}`, t.routeLineMix, t.background)] as const)
      const others = [
        ['stroke', t.interiorStroke],
        ['track', t.interiorTrack],
        ['entrance', t.interiorEntrance],
        ['fine', t.interiorFine],
        ['elevator', t.interiorElevator],
        ['escalator', t.interiorEscalator],
        ['outage', t.interiorOutage],
        ['here', t.here],
        ['focus', t.stationFocus],
        ...lines,
      ] as const
      for (const [name, color] of others) {
        expect(oklabDistance(t.exitPath, color), `${t.name} exitPath ${t.exitPath} vs ${name} ${color}`).toBeGreaterThanOrEqual(0.1)
      }
    }
  })

  it('stays apart from the interior structure and machines under simulated deuteranopia and protanopia', async () => {
    for (const t of Object.values(await themes())) {
      const others = [
        ['stroke', t.interiorStroke],
        ['track', t.interiorTrack],
        ['entrance', t.interiorEntrance],
        ['elevator', t.interiorElevator],
        ['escalator', t.interiorEscalator],
        ['outage', t.interiorOutage],
      ] as const
      for (const [mode, m] of Object.entries(CVD)) {
        for (const [name, color] of others) {
          const d = oklabDistance(simulateCvd(t.exitPath, m), simulateCvd(color, m))
          expect(d, `${t.name} ${mode} exitPath vs ${name} ${color}`).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE)
        }
      }
    }
  })
})
