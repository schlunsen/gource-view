// Radial tidy-tree layout (Reingold–Tilford in polar form, Gource-flavoured):
//  - folders sit on one ring per depth, so an edge always runs outward from a
//    tighter ring to a wider one and can never double back over the tree
//  - sibling subtrees are packed by their angular contours: each new sibling is
//    rotated just far enough that its left edge clears the right edge of
//    everything placed before it, checked ring by ring. Sibling subtrees
//    therefore never share an arc on any ring, which is what keeps the drawing
//    planar — no crossing edges, no edge cutting through a foreign folder — and
//    it is also why the tree stays compact: a branch only claims the angle it
//    actually uses at each depth, instead of reserving a wedge all the way out
//  - a parent is centred over its children, so the trunk stays balanced
//  - the ring spacing is solved for once: if the whole tree asks for more than
//    a full turn the rings widen (angles scale as 1/radius) until it fits, and
//    if it asks for less the root's children are fanned out to fill the circle
//  - files use even spiral packing around their folder
// Solved once per repository, fully deterministic, so seeking never reflows.
function hash(s) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
const unit = s => s / 4294967296
const FILE_D = 9          // ring spacing (graph units)
const GAP = 13            // clearance between neighbouring folders on a ring
const CLEAR = 16          // clearance between one ring's folders and the next
const FULL = Math.PI * 2 * 0.97
const LEAN_CAP = 3.4      // most a ring may be pushed out to straighten its edges
const PASSES = 14         // ring-spacing solve rounds

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
    x: 0, y: 0, depth: 0, angle: 0, children: [], parent: null,
  }))
  const byNode = new Map(bodies.map(b => [b.n, b]))
  for (const b of bodies.slice(1)) { b.parent = byNode.get(b.n.parent) || bodies[0]; b.parent.children.push(b) }
  for (const b of bodies) b.children.sort((a, c) => a.n.path.localeCompare(c.n.path))

  // breadth-first order (parents before children)
  const order = [bodies[0]]
  for (let i = 0; i < order.length; i++) {
    for (const c of order[i].children) { c.depth = order[i].depth + 1; order.push(c) }
  }
  const deepest = order.reduce((m, b) => Math.max(m, b.depth), 0)
  for (const b of order) {
    b.fileRadius = b.files.length ? ringRadius(b.files.length) + FILE_D * 0.5 : FILE_D * 0.8
    b.hub = b.fileRadius + FILE_D * 0.7                       // room its own files take
  }
  // How far apart two rings have to be: only a folder and its *own* children
  // need the radial room, because every other pair is held apart by the
  // angular packing below. Taking the widest folder of each depth instead
  // would let one 46-file folder push every folder sharing its depth outwards,
  // even a childless one that nothing is ever placed beyond.
  const step = new Array(deepest + 1).fill(0)
  for (const b of order) {
    if (!b.children.length) continue
    const kid = b.children.reduce((m, c) => Math.max(m, c.hub), 0)
    step[b.depth + 1] = Math.max(step[b.depth + 1], b.hub + kid)
  }
  // one ring per depth, spaced so neighbouring rings' file circles clear.
  // `lean` is how much further out a ring has to sit than that minimum so that
  // no edge leaving it is angled more than its tangent cone allows — the rule
  // that keeps an edge from bulging across a neighbouring branch. It is
  // measured from the previous round's packing and fed back in below.
  const ring = new Array(deepest + 1).fill(0)
  const lean = new Array(deepest + 1).fill(1)
  const respace = () => {
    for (let d = 1; d <= deepest; d++) {
      ring[d] = Math.max(ring[d - 1] + step[d] + CLEAR, ring[d - 1] * lean[d])
    }
  }
  respace()

  // Angles shrink as 1/radius, so if the packed tree overflows a full turn the
  // rings simply widen until it fits; a few rounds converge.
  let spread = 1, span = 0
  for (let pass = 0; pass < PASSES; pass++) {
    const R = d => ring[d] * spread
    // A folder's file circle has radial thickness, so it can reach the rings on
    // either side of its own. Reserve angular space on every ring it actually
    // touches (as the half-angle of the chord it cuts there) — otherwise a fat
    // folder and a cousin one ring out could be left sitting on top of each
    // other, and the rings would have to be held apart globally to prevent it.
    const half = b => {
      const rb = R(b.depth), reach = b.hub + GAP * 0.5
      const out = []
      for (let k = 0; b.depth + k <= deepest; k++) {
        const rk = R(b.depth + k), dr = rk - rb
        if (k && dr >= reach) break
        out.push(Math.asin(Math.min(0.92, Math.sqrt(Math.max(0, reach * reach - dr * dr)) / Math.max(1e-6, rk))))
      }
      return out
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const b = order[i]
      const h = half(b)
      if (!b.children.length) { b.lo = h.map(v => -v); b.hi = h; b.offsets = []; continue }
      // rotate each sibling just past the contour of everything placed so far
      let accLo = null, accHi = null
      const offsets = []
      for (const c of b.children) {
        let shift = 0
        if (accHi) {
          for (let d = 0; d < Math.min(accHi.length, c.lo.length); d++) {
            shift = Math.max(shift, accHi[d] - c.lo[d] + GAP / R(b.depth + 1 + d))
          }
        }
        offsets.push(shift)
        if (!accHi) { accLo = c.lo.map(v => v + shift); accHi = c.hi.map(v => v + shift) }
        else for (let d = 0; d < c.hi.length; d++) {
          if (d < accHi.length) { accLo[d] = Math.min(accLo[d], c.lo[d] + shift); accHi[d] = Math.max(accHi[d], c.hi[d] + shift) }
          else { accLo.push(c.lo[d] + shift); accHi.push(c.hi[d] + shift) }
        }
      }
      // centre the parent over its children
      const mid = (offsets[0] + offsets[offsets.length - 1]) / 2
      for (let k = 0; k < offsets.length; k++) offsets[k] -= mid
      b.offsets = offsets
      const lo = [-h[0]], hi = [h[0]]
      for (let d = 1; d < Math.max(h.length, accLo.length + 1); d++) {
        const mine = d < h.length ? h[d] : 0
        const kid = d - 1 < accLo.length ? [accLo[d - 1] - mid, accHi[d - 1] - mid] : null
        lo.push(kid ? Math.min(-mine, kid[0]) : -mine)
        hi.push(kid ? Math.max(mine, kid[1]) : mine)
      }
      b.lo = lo
      b.hi = hi
    }
    span = Math.max(...bodies[0].hi.map((v, d) => v - bodies[0].lo[d]))
    // how far off its parent's bearing the most-swung child of each ring sits
    const swing = new Array(deepest + 1).fill(0)
    for (const b of order) {
      if (!b.depth || !b.offsets.length) continue          // the root sits at the centre: any bearing is fine
      for (const o of b.offsets) swing[b.depth + 1] = Math.max(swing[b.depth + 1], Math.abs(o))
    }
    let ok = span <= FULL
    for (let d = 1; d <= deepest; d++) {
      // widening the ring shrinks the swing, so re-measure rather than ratchet
      const want = Math.min(LEAN_CAP, 1 / Math.cos(Math.min(1.2, swing[d])))
      if (Math.abs(want - lean[d]) > 5e-3) ok = false
      lean[d] = lean[d] + (want - lean[d]) * 0.6
    }
    if (ok) break
    if (span > FULL) spread *= span / FULL
    respace()
  }

  const R = d => ring[d] * spread
  // a tree that does not fill the circle fans out to use it
  const rootBody = bodies[0]
  if (rootBody.children.length > 1 && span < FULL) {
    const extra = (FULL - span) / (rootBody.children.length - 1)
    const offs = rootBody.offsets
    for (let k = 0; k < offs.length; k++) offs[k] += extra * (k - (offs.length - 1) / 2)
  }
  rootBody.angle = unit(hash('root')) * Math.PI * 2
  for (const b of order) {
    b.children.forEach((c, k) => {
      c.angle = b.angle + b.offsets[k]
      c.x = Math.cos(c.angle) * R(c.depth)
      c.y = Math.sin(c.angle) * R(c.depth)
    })
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
