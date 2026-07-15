// Bridge server: exposes the same /sendimages + /generateimages HTTP contract
// as modeling-automation/demo3d_service.py, but backed by a real headless
// browser driving this app's own React/Three.js UI — so the returned image
// is an actual WebGL render (lighting, shadows, marble shaders) instead of a
// flat Pillow composite. modeling-automation just needs MODELING_APP_BASE_URL
// pointed at this server's port.
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { chromium } from 'playwright'

const PORT = process.env.BRIDGE_PORT || 7070
const upload = multer()

// modeling-automation category id -> this app's RoomCategory
const CATEGORY_MAP = {
  kitchen: 'kitchen',
  bathroom: 'bathroom',
  bedroom: 'bedroom',
  commercial: 'commercial',
  shop: 'commercial',
  restaurant: 'commercial',
  other: 'living',
}

// modeling-automation surface_id -> this app's SurfaceId
const SURFACE_MAP = {
  back_wall: 'wall1',
  left_wall: 'wall2',
  right_wall: 'wall3',
  ground: 'floor',
}

async function detectViteUrl() {
  if (process.env.VITE_APP_URL) return process.env.VITE_APP_URL
  for (let port = 5173; port < 5183; port++) {
    const url = `http://localhost:${port}`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(800) })
      if (res.ok) return url
    } catch {
      /* try next port */
    }
  }
  throw new Error(
    'Could not auto-detect the Vite dev server (tried :5173-:5182). ' +
    'Make sure `npm run dev` is running, or set VITE_APP_URL explicitly.'
  )
}

const viteUrl = await detectViteUrl()
console.log(`3D app dev server detected at ${viteUrl}`)

let browser
let page

async function launchViewer() {
  browser = await chromium.launch({
    // Headless Chromium's GPU/compositor path kept crashing mid-request in
    // this session no matter how it was tuned (software, forced hardware,
    // Chromium's own default). This machine's regular Chrome renders fine,
    // so run headed (a visible window) to reuse that same stable pipeline
    // instead of the crash-prone headless-specific one.
    headless: false,
  })
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  page.on('console', (msg) => console.log(`[viewer:${msg.type()}]`, msg.text()))
  page.on('pageerror', (err) => console.error('[viewer:pageerror]', err))
  await page.goto(viteUrl, { waitUntil: 'load' })
  // A background/unfocused tab gets its requestAnimationFrame loop throttled
  // hard by Chromium — Three.js's render loop runs on rAF, so an unfocused
  // window can end up capturing before a single real frame has painted.
  await page.bringToFront()
  await page.waitForFunction(() => !!window.__modelingBridge, { timeout: 15000 })
}

// The headless page/browser can die mid-session (crash, manual close, OOM).
// Any handler that needs it should go through this instead of touching the
// module-level `page` directly, so a dead session is transparently replaced.
async function getPage() {
  if (!page || page.isClosed() || !browser?.isConnected()) {
    console.warn('Headless 3D viewer was closed — relaunching...')
    try { await browser?.close() } catch { /* already gone */ }
    await launchViewer()
  }
  return page
}

await launchViewer()
console.log('Headless 3D viewer ready')

// job_id -> { category, assignments, revision }
const jobs = new Map()

const app = express()
app.use(cors())

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.post(
  '/sendimages',
  upload.fields(Object.keys(SURFACE_MAP).map((id) => ({ name: id }))),
  (req, res) => {
    const { job_id: jobId, category, tile_settings: tileSettingsRaw } = req.body
    if (!jobId || !category) {
      return res.status(400).json({ detail: 'job_id and category are required' })
    }

    const assignments = {}
    const surfacesReceived = []
    for (const [surfaceId, mappedId] of Object.entries(SURFACE_MAP)) {
      const files = req.files?.[surfaceId]
      if (!files || !files.length) continue
      assignments[mappedId] = files.map(
        (f) => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`
      )
      surfacesReceived.push(surfaceId)
    }

    if (!surfacesReceived.length) {
      return res.status(400).json({ detail: 'no surface image fields were provided' })
    }

    // tile_settings (optional): JSON string, modeling-automation surface_id -> partial TileSettings
    let tileSettings = {}
    if (tileSettingsRaw) {
      try {
        const parsed = JSON.parse(tileSettingsRaw)
        for (const [surfaceId, mappedId] of Object.entries(SURFACE_MAP)) {
          if (parsed[surfaceId]) tileSettings[mappedId] = parsed[surfaceId]
        }
      } catch (err) {
        return res.status(400).json({ detail: `invalid tile_settings JSON: ${err}` })
      }
    }

    jobs.set(jobId, {
      category: CATEGORY_MAP[category] ?? 'living',
      assignments,
      tileSettings,
      revision: 0,
    })

    res.json({ session_id: jobId, category, surfaces_received: surfacesReceived })
  }
)

async function renderJob(job) {
  const p = await getPage()
  await p.bringToFront()
  await p.evaluate((category) => window.__modelingBridge.setRoomByCategory(category), job.category)
  await p.evaluate(
    (assignments) => window.__modelingBridge.applySurfaceImages(assignments),
    job.assignments
  )
  if (job.tileSettings && Object.keys(job.tileSettings).length) {
    await p.evaluate(
      (tileSettings) => window.__modelingBridge.setTileSettings(tileSettings),
      job.tileSettings
    )
  }
  await p.waitForSelector('canvas', { timeout: 30000 })
  await p.waitForFunction(() => window.__modelingBridge.isReady(), { timeout: 30000 })
  // Let the GPU actually paint the applied textures before capturing.
  await p.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )

  // Neither canvas.toDataURL() (races Chromium's WebGL buffer swap) nor
  // locator('canvas').screenshot() (element-targeted CDP screenshots can
  // miss GPU-composited WebGL layers entirely — confirmed by comparing
  // against a full-page screenshot, which shows the canvas content fine)
  // reliably captures the rendered frame. A full-page screenshot clipped to
  // the canvas's own bounding box gets the same correct compositor output.
  const box = await p.locator('canvas').boundingBox()
  const pngBuffer = await p.screenshot({ clip: box })
  return pngBuffer.toString('base64')
}

app.post('/generateimages', express.json(), async (req, res) => {
  const jobId = req.body?.session_id
  const job = jobs.get(jobId)
  if (!job) {
    return res.status(404).json({ detail: 'unknown session_id — call /sendimages first' })
  }

  try {
    let imageBase64
    try {
      imageBase64 = await renderJob(job)
    } catch (err) {
      // A closed/crashed target is the one failure worth retrying automatically —
      // everything else (bad assignments, timeout on real work) should surface as-is.
      if (!/closed/i.test(String(err))) throw err
      console.warn('[generateimages] viewer session was gone, relaunching once and retrying:', String(err))
      page = null
      imageBase64 = await renderJob(job)
    }

    job.revision += 1
    res.json({ revision: job.revision, image_base64: imageBase64, mime_type: 'image/png' })
  } catch (err) {
    console.error('[generateimages] failed:', err)
    res.status(500).json({ detail: String(err) })
  }
})

app.listen(PORT, () => {
  console.log(`Modeling bridge (real 3D renderer) running at http://localhost:${PORT}`)
})

process.on('SIGINT', async () => {
  await browser.close()
  process.exit(0)
})
