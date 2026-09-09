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

export function organicLayout(root, visible, shared) {
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
  const rings = Math.max(deepest, shared ? shared.ring.length - 1 : 0)
  const ring = shared ? shared.ring.slice() : new Array(rings + 1).fill(0)
  const lean = shared ? shared.lean.slice() : new Array(rings + 1).fill(1)
  const respace = () => {
    if (shared) return                                        // the schedule is fixed; only `spread` moves
    for (let d = 1; d <= rings; d++) {
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
    let widen = span > FULL ? span / FULL : 1
    for (let d = 1; d <= deepest; d++) {
      if (!shared) {
        // widening the ring shrinks the swing, so re-measure rather than ratchet
        const want = Math.min(LEAN_CAP, 1 / Math.cos(Math.min(1.2, swing[d])))
        if (Math.abs(want - lean[d]) > 5e-3) ok = false
        lean[d] = lean[d] + (want - lean[d]) * 0.6
      }
      // No edge may leave a ring at a wider angle than that ring's tangent cone,
      // or it bulges across the branch beside it. The cone depends only on the
      // ratio between two rings, so scaling the whole tree leaves it untouched
      // while shrinking every angle — which is exactly the knob to turn.
      const cone = Math.acos(Math.min(0.9995, ring[d - 1] / ring[d]))
      if (swing[d] > cone) { widen = Math.max(widen, swing[d] / cone); ok = false }
    }
    if (ok) break
    spread *= widen
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
  return {
    positions, radii, ring, lean, spread,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
    width: Math.max(80, maxX - minX), height: Math.max(80, maxY - minY),
  }
}

/**
 * The same tree, solved at a handful of points in its history.
 *
 * One layout for the whole repository has to reserve, from the first frame,
 * the room the project will only need years later — so early history plays out
 * in a corner of a picture built for the end of the story, and the tree never
 * visibly reorganises itself the way a real one does. Solving it afresh every
 * frame would fix that and ruin seeking: the drawing would depend on how you
 * got to a moment rather than which moment it is.
 *
 * So: solve at `count` eras, each holding the nodes born by then, and move
 * between them. Position stays a pure function of time, so a seek and an export
 * land on exactly the same picture as playing there.
 *
 * Movement is interpolated in polar form, not in x/y. Every era sorts siblings
 * the same way and puts children further out than their parents, so sliding
 * radius and bearing separately keeps that order intact the whole way across —
 * where interpolating x/y would let one branch sweep through another.
 */
export function layoutSeries(root, visible, count = 6) {
  const born = [...visible].sort((a, b) => a.firstTs - b.firstTs || a.path.localeCompare(b.path))
  // One ring schedule for the whole history, taken from the finished tree, and
  // every era placed on it at its own scale. That is what makes moving between
  // eras safe: an era only ever scales the rings, never re-spaces them, so the
  // ratio between two rings — and with it the tangent cone that decides how far
  // a branch may swing — is the same in every era and at every point between
  // two of them. Blending two angles can then never exceed a bound both ends
  // already respect.
  const schedule = organicLayout(root, born)
  const solve = subset => organicLayout(root, subset, schedule)
  const frames = [], times = []
  const steps = Math.max(1, Math.min(count, born.length))
  for (let k = 1; k <= steps; k++) {
    const subset = born.slice(0, Math.ceil(born.length * k / steps))
    const at = subset.length ? subset[subset.length - 1].firstTs : 0
    // eras that land on the same instant are the same era
    if (times.length && at <= times[times.length - 1]) { frames[frames.length - 1] = solve(subset); continue }
    times.push(at); frames.push(solve(subset))
  }
  if (!frames.length) { times.push(0); frames.push(solve([])) }

  // Folders are tracked in polar form, breadth-first so a parent is always
  // placed before its children. A folder that did not exist yet sits on its
  // nearest ancestor that did, so it grows out of the branch it belongs to.
  const shown = new Set(visible)
  const dirs = [root], seen = new Set([root])
  for (let i = 0; i < dirs.length; i++) {
    for (const c of dirs[i].children?.values() || []) {
      if (c.type === 'dir' && shown.has(c) && !seen.has(c)) { seen.add(c); dirs.push(c) }
    }
  }
  const track = new Map()
  for (const n of dirs) {
    const r = new Float64Array(frames.length), a = new Float64Array(frames.length), fr = new Float64Array(frames.length)
    for (let k = 0; k < frames.length; k++) {
      let node = n
      while (node && !frames[k].positions.has(node)) node = node.parent
      const p = frames[k].positions.get(node || root) || frames[k].center
      r[k] = Math.hypot(p[0], p[1])
      a[k] = Math.atan2(p[1], p[0])
      fr[k] = frames[k].radii.get(node || root) || 0
      // keep the bearing continuous across eras so nothing takes the long way round
      if (k) a[k] = a[k - 1] + Math.atan2(Math.sin(a[k] - a[k - 1]), Math.cos(a[k] - a[k - 1]))
    }
    track.set(n, { r, a, fr })
  }
  // Files ride their folder: an offset, not a place of their own, so a folder
  // that shifts while the tree rearranges takes its files with it.
  const files = []
  for (const n of visible) {
    if (n.type !== 'file') continue
    const dx = new Float64Array(frames.length), dy = new Float64Array(frames.length)
    for (let k = 0; k < frames.length; k++) {
      const home = frames[k].positions.get(n.parent) || frames[k].center
      const p = frames[k].positions.get(n)
      dx[k] = p ? p[0] - home[0] : 0
      dy[k] = p ? p[1] - home[1] : 0
    }
    files.push({ n, dx, dy })
  }

  const lerp = (a, b, e) => a + (b - a) * e
  const fill = (t, into) => {
    let k = 0
    while (k < times.length - 2 && t > times[k + 1]) k++
    const span = times[k + 1] - times[k]
    const raw = frames.length < 2 || span <= 0 ? (t >= times[times.length - 1] ? 1 : 0) : (t - times[k]) / span
    const u = Math.max(0, Math.min(1, raw))
    const e = u * u * (3 - 2 * u)                              // ease so eras blend rather than switch
    const j = Math.min(k + 1, frames.length - 1)
    const pos = into.positions, rad = into.radii
    for (const n of dirs) {
      const tr = track.get(n)
      const r = lerp(tr.r[k], tr.r[j], e)
      const a = lerp(tr.a[k], tr.a[j], e)
      pos.set(n, [Math.cos(a) * r, Math.sin(a) * r])
      rad.set(n, lerp(tr.fr[k], tr.fr[j], e))
    }
    for (const f of files) {
      const home = pos.get(f.n.parent) || [0, 0]
      pos.set(f.n, [home[0] + lerp(f.dx[k], f.dx[j], e), home[1] + lerp(f.dy[k], f.dy[j], e)])
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of pos.values()) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]
    }
    into.center = [(x0 + x1) / 2, (y0 + y1) / 2]
    into.width = Math.max(80, x1 - x0)
    into.height = Math.max(80, y1 - y0)
    return into
  }
  const out = { positions: new Map(), radii: new Map(), frames, times }
  let sampledAt = NaN
  /** The tree at time `t`. One shared object, refilled — read it, do not keep it. */
  out.sample = t => (t === sampledAt ? out : (sampledAt = t, fill(t, out)))
  /** The tree at time `t` in an object of its own, for anything that outlives a frame. */
  out.snapshot = t => fill(t, { positions: new Map(), radii: new Map() })
  return fill(times[0], out)
}
