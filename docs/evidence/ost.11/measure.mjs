// Usage: node ost11.mjs <port> <outDir> <label>
// Lands on 127 then 120 at phone and desktop, probes the entrance marks, screenshots; plus 127 phone reduced motion.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const [port, outDir, label] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const views = [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
]

function metrics(p) {
  const f = p.free
  const margin = (q) => Math.min(q.x - f.left, f.right - q.x, q.y - f.top, f.bottom - q.y)
  const inside = p.marks.filter((q) => margin(q) >= 0).length
  const all = [...p.marks, p.station.px]
  return {
    station: p.stationId,
    distance: +p.distance.toFixed(1),
    offset: +Math.hypot(p.target.x - p.station.ground.x, p.target.z - p.station.ground.z).toFixed(1),
    inside: `${inside}/${p.marks.length}`,
    minMarginPx: +Math.min(...all.map(margin)).toFixed(1),
    stationPx: { x: +p.station.px.x.toFixed(0), y: +p.station.px.y.toFixed(0) },
    stationMarginPx: +margin(p.station.px).toFixed(1),
    free: f,
  }
}

async function land(page, id, shot) {
  await page.evaluate((s) => window.__underground.select(s), id)
  await page.waitForTimeout(5000)
  const m = metrics(await page.evaluate(() => window.__underground.entrancesAt()))
  await page.screenshot({ path: `${outDir}/${shot}.png` })
  // After the 400 ms auto-focus dwell and more: is the landed station still the focused one?
  await page.waitForTimeout(2000)
  m.focusedAfter = await page.evaluate(() => window.__underground.entrancesAt?.().stationId ?? null)
  return m
}

const rows = []
for (const v of views) {
  for (const reduced of v.name === 'phone' ? [false, true] : [false]) {
    const page = await browser.newPage(v)
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
    page.on('pageerror', (e) => console.log('pageerror', e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('console', m.text())
    })
    await page.goto(`http://localhost:${port}/underground/`)
    await page.waitForFunction(() => window.__underground?.select, null, { timeout: 30000 })
    await page.waitForTimeout(3000)
    const tag = `${label}-${v.name}${reduced ? '-reduced' : ''}`
    rows.push({ view: v.name, reduced, ...(await land(page, '127', `${tag}-127`)) })
    if (!reduced) rows.push({ view: v.name, reduced, ...(await land(page, '120', `${tag}-120`)) })
    await page.close()
  }
}
for (const r of rows) console.log(JSON.stringify(r))
writeFileSync(`${outDir}/${label}.json`, JSON.stringify(rows, null, 2) + '\n')
await browser.close()
