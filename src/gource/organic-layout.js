// Gource-style layout (after acaudwell/gource RDirNode):
//  - folders spawn on the far side of their parent from the grandparent, so
//    branches radiate outward instead of criss-crossing the tree
//  - each folder's radius grows with the area of its whole subtree
//  - folders only repel when their circles overlap, and sit on a spring at
//    rest distance (child radius + parent's file-ring radius) from the parent
//  - files use even spiral packing around their folder
// Solved once per repository, fully deterministic, so seeking never reflows.
function hash(s) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
const unit = s => s / 4294967296
const FILE_D = 9          // ring spacing (graph units)
const FILE_AREA = FILE_D * FILE_D * 2.2
const PAD = 1.4

/** Ring radius needed to hold `count` files: ring k holds ~k·π files. */
function ringRadius(count) {
  let left = count, k = 0
  while (left > 0) { k++; left -= Math.max(1, Math.floor(k * Math.PI)) }
  return k * FILE_D
}

export function organicLayout(root, visible) {
  const keep = new Set(visible)
  const dirs = [root, ...visible.filter(n => n.type === 'dir')]
  const bodies = dirs.map(n => ({
    n, files: [...(n.children?.values() || [])].filter(c => c.type === 'file' && keep.has(c)),
    x: 0, y: 0, children: [], parent: null,
  }))
  const byNode = new Map(bodies.map(b => [b.n, b]))
  for (const b of bodies.slice(1)) { b.parent = byNode.get(b.n.parent) || bodies[0]; b.parent.children.push(b) }
  for (const b of bodies) b.children.sort((a, c) => a.n.path.localeCompare(c.n.path))

  // breadth-first order (parents before children); areas are summed bottom-up
  const order = [bodies[0]]
  for (let i = 0; i < order.length; i++) order.push(...order[i].children)
  for (let i = order.length - 1; i >= 0; i--) {
    const b = order[i]
    b.fileRadius = b.files.length ? ringRadius(b.files.length) + FILE_D * 0.5 : FILE_D * 0.8
    b.area = b.files.length * FILE_AREA + b.children.reduce((s, c) => s + c.area, 0) + FILE_AREA
    b.radius = Math.sqrt(b.area / Math.PI) * PAD
    b.parentRadius = Math.max(b.fileRadius, Math.sqrt((b.files.length * FILE_AREA + FILE_AREA) / Math.PI) * PAD)
  }
  const rest = b => b.radius + b.parent.parentRadius + 14

  // initial placement: fan siblings around the direction away from the grandparent
  for (const p of order) {
    const k = p.children.length
    if (!k) continue
    let base, spread
    if (!p.parent) { base = unit(hash('root')) * Math.PI * 2; spread = Math.PI * 2 }
    else { base = Math.atan2(p.y - p.parent.y, p.x - p.parent.x); spread = Math.min(Math.PI * 1.25, 0.5 + k * 0.55) }
    p.children.forEach((c, i) => {
      const slot = p.parent ? (i + 0.5) / k - 0.5 : i / k
      const angle = base + slot * spread + (unit(hash(c.n.path)) - 0.5) * (spread / Math.max(2, k)) * 0.6
      const d = rest(c)
      c.x = p.x + Math.cos(angle) * d; c.y = p.y + Math.sin(angle) * d
    })
  }

  const moving = order.slice(1)
  const iterations = moving.length > 400 ? 120 : 300
  for (let it = 0; it < iterations; it++) {
    for (const b of moving) { b.fx = 0; b.fy = 0 }
    // overlap-only repulsion between folder circles
    for (let i = 0; i < order.length; i++) {
      const a = order[i]
      for (let j = i + 1; j < order.length; j++) {
        const b = order[j]
        const dx = b.x - a.x, dy = b.y - a.y
        const clearance = a.radius + b.radius + 16
        const d2 = dx * dx + dy * dy
        if (d2 >= clearance * clearance) continue
        const d = Math.max(0.01, Math.sqrt(d2))
        const push = (clearance - d) * 0.5
        const ux = d < 0.02 ? Math.cos(hash(a.n.path + b.n.path)) : dx / d
        const uy = d < 0.02 ? Math.sin(hash(a.n.path + b.n.path)) : dy / d
        if (a.parent) { a.fx -= ux * push; a.fy -= uy * push }
        if (b.parent) { b.fx += ux * push; b.fy += uy * push }
      }
    }
    // spring to the parent's rest distance (parent gets a gentle tug back)
    for (const b of moving) {
      const p = b.parent
      const dx = p.x - b.x, dy = p.y - b.y
      const d = Math.max(0.01, Math.hypot(dx, dy))
      const f = (d - rest(b)) * 0.12
      b.fx += dx / d * f; b.fy += dy / d * f
      if (p.parent) { p.fx -= dx / d * f * 0.3; p.fy -= dy / d * f * 0.3 }
    }
    const cooling = 1 - (it / iterations) * 0.7
    for (const b of moving) {
      b.x += Math.max(-14, Math.min(14, b.fx)) * cooling
      b.y += Math.max(-14, Math.min(14, b.fy)) * cooling
    }
  }

  // files packed naturally around their folder
  const positions = new Map(), radii = new Map()
  for (const b of bodies) {
    positions.set(b.n, [b.x, b.y]); radii.set(b.n, b.fileRadius)
    const orientation = unit(hash(b.n.path || 'root')) * Math.PI * 2
    // Sunflower packing avoids rigid concentric rows while keeping a stable,
    // even spacing and an empty center for the folder hub.
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const outer = Math.max(FILE_D, b.fileRadius - FILE_D * 0.5)
    b.files.forEach((f, i) => {
      const seed = hash(f.path)
      const angle = orientation + i * goldenAngle + (unit(seed) - 0.5) * 0.12
      const inner = Math.min(FILE_D, outer * 0.45)
      const r = Math.sqrt(inner * inner + (outer * outer - inner * inner) * (i + 0.5) / b.files.length)
      positions.set(f, [b.x + Math.cos(angle) * r, b.y + Math.sin(angle) * r])
    })
  }
  const points = [...positions.values()]
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]))
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]))
  return { positions, radii, center: [(minX + maxX) / 2, (minY + maxY) / 2], width: Math.max(80, maxX - minX), height: Math.max(80, maxY - minY) }
}
