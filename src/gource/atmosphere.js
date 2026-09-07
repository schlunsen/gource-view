// Purely additive atmosphere: every pass composites with 'lighter' and the
// canvas stays transparent, so the page background and the export composition
// keep painting behind the graph exactly as before.

const tint = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

// Deep-space wash behind the tree. Three slow, offset clouds read as depth
// without ever becoming an opaque blob that swallows the edges.
const CLOUDS = [[36, 92, 148], [78, 46, 138], [22, 104, 106]]
export function drawNebula(ctx, cx, cy, radius, t) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < CLOUDS.length; i++) {
    const a = t * 0.04 + i * 2.1
    const x = cx + Math.cos(a) * radius * 0.32
    const y = cy + Math.sin(a * 0.77 + i) * radius * 0.2
    const r = radius * (1 + i * 0.4)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, tint(CLOUDS[i], 0.075))
    g.addColorStop(0.5, tint(CLOUDS[i], 0.018))
    g.addColorStop(1, tint(CLOUDS[i], 0))
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.restore()
}

// Nebula and vignette together cost four full-canvas gradient fills a frame,
// which software rasterisers pay per pixel (~65 ms at 2880x1800). Both are
// very low frequency, so they are painted into a 1/8-scale layer and blitted
// up once. They land on an empty canvas, so 'lighter' and 'source-over' agree.
const BACKDROP_SCALE = 8
export function createBackdrop() {
  let layer = null
  return function backdrop(ctx, canvas, cx, cy, radius, t) {
    const w = Math.max(1, Math.round(canvas.width / BACKDROP_SCALE))
    const h = Math.max(1, Math.round(canvas.height / BACKDROP_SCALE))
    if (!layer || layer.width !== w || layer.height !== h) {
      layer = document.createElement('canvas'); layer.width = w; layer.height = h
    }
    const l = layer.getContext('2d')
    l.setTransform(1, 0, 0, 1, 0, 0)
    l.globalCompositeOperation = 'source-over'
    l.globalAlpha = 1
    l.clearRect(0, 0, w, h)
    // ctx is in CSS pixels; scale the layer so the same coordinates apply.
    const k = w / (canvas.width / (ctx.getTransform().a || 1))
    l.setTransform(k, 0, 0, k, 0, 0)
    drawNebula(l, cx, cy, radius, t)
    drawVignette(l, canvas.width / (ctx.getTransform().a || 1), canvas.height / (ctx.getTransform().d || 1), cx, cy)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(layer, 0, 0, canvas.width, canvas.height)
    ctx.restore()
  }
}

// Slow drifting dust. Seeded from the index so seeking never resets it and two
// renderers sharing one repo stay identical frame for frame.
export function drawDust(ctx, width, height, t, count = 90) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < count; i++) {
    const seed = i * 2654435761 % 1000 / 1000
    const seed2 = (i * 40503) % 997 / 997
    const depth = 0.35 + seed2 * 0.65
    const x = ((seed * width + t * 6 * depth) % (width + 40)) - 20
    const y = ((seed2 * height + Math.sin(t * 0.25 + i) * 14) % (height + 40)) - 20
    const a = 0.05 + depth * 0.1 + Math.sin(t * 0.9 + i * 1.7) * 0.03
    ctx.fillStyle = tint([170, 210, 240], Math.max(0, a))
    ctx.beginPath(); ctx.arc(x, y, depth * 1.25, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

// Mip-chain bloom. Canvas `filter: blur()` is software-rasterised and costs
// ~80 ms a frame on a big canvas, so the halo is built from successive bilinear
// downscales instead — a box blur the compositor does for free — and the small
// buffers are drawn back additively.
const LEVELS = 4
export function createBloom() {
  let mips = null, key = ''
  return function bloom(ctx, canvas, strength = 1) {
    if (strength <= 0) return
    const w0 = Math.max(1, canvas.width >> 2), h0 = Math.max(1, canvas.height >> 2)
    const id = `${w0}x${h0}`
    if (key !== id) {
      mips = []
      for (let i = 0; i < LEVELS; i++) {
        const c = document.createElement('canvas')
        c.width = Math.max(1, w0 >> i); c.height = Math.max(1, h0 >> i)
        mips.push(c)
      }
      key = id
    }
    let source = canvas
    for (const mip of mips) {
      const m = mip.getContext('2d')
      m.setTransform(1, 0, 0, 1, 0, 0)
      m.globalCompositeOperation = 'source-over'
      m.globalAlpha = 1
      m.imageSmoothingEnabled = true
      m.clearRect(0, 0, mip.width, mip.height)
      m.drawImage(source, 0, 0, mip.width, mip.height)
      source = mip
    }
    // Sum the wider, fainter halos into the quarter-size buffer so the big
    // canvas is touched by one additive blit rather than four.
    const weights = [0.2, 0.17, 0.14, 0.1]
    const m0 = mips[0].getContext('2d')
    m0.save()
    m0.setTransform(1, 0, 0, 1, 0, 0)
    m0.globalCompositeOperation = 'lighter'
    m0.imageSmoothingEnabled = true
    for (let i = 1; i < mips.length; i++) {
      m0.globalAlpha = weights[i] / weights[0]
      m0.drawImage(mips[i], 0, 0, mips[0].width, mips[0].height)
    }
    m0.restore()
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'lighter'
    ctx.imageSmoothingEnabled = true
    ctx.globalAlpha = weights[0] * strength
    ctx.drawImage(mips[0], 0, 0, canvas.width, canvas.height)
    ctx.restore()
  }
}

// Darkens the frame edges so the wash above never flattens the corners. Drawn
// over the nebula and under the tree, and only ever over the page background.
export function drawVignette(ctx, width, height, cx, cy) {
  const r = Math.hypot(width, height) * 0.62
  const g = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r)
  g.addColorStop(0, 'rgba(3,6,14,0)')
  g.addColorStop(0.62, 'rgba(3,6,14,0.28)')
  g.addColorStop(1, 'rgba(3,6,14,0.6)')
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height); ctx.restore()
}
