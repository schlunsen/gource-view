import { motion, glide, nearestAngle } from './camera-motion.js'
import { drawEnergyBeam, drawCommitWave } from './energy.js'
import { createBackdrop, drawDust, createBloom } from './atmosphere.js'
import { layoutSeries } from './organic-layout.js'
import { buildContributorCards, initials, dateParts, commitsBefore } from './contributor-cards.js'
import { buildActors, actorState } from './actors.js'
import { loadAvatar, avatarsSettled } from './avatars.js'
import { buildEvents, deletedAt } from './lifecycle.js'
import { buildPacing } from './pacing.js'
import { buildPseudonyms, normalizePrivacy, describeHidden } from './privacy.js'
// Gource-style renderer: transient per-commit bursts, smooth easing, motion.
// Canvas sizing: ResizeObserver on the parent (fixes the 300×150 bug).

// Hallmark palette (RGB for canvas, mirrors the OKLCH tokens)
const C = {
  code:    [255, 160,  58], // orange — source code
  data:    [ 58, 190, 255], // blue   — data / text / markup
  image:   [140, 120, 255], // purple — images / binaries
  dir:     [140, 160, 190], // muted  — directories
  edge:    [100, 120, 150], // line   — edges
  bubbleBg:[ 12,  16,  26],
  accent:  [100, 222, 219], // teal — hover / focus
}

function colorForPath(p) {
  const ext = (p.split('.').pop() || '').toLowerCase()
  if (['png','jpg','jpeg','gif','svg','webp','ico','bmp','pdf'].includes(ext)) return C.image
  if (['html','htm','xml','md','markdown','rst','txt','json','yml','yaml','toml','csv','sql'].includes(ext)) return C.data
  if (['css','scss','less','sass'].includes(ext)) return C.code
  return C.code // default: source
}

function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})` }
function lerp(a, b, t) { return a + (b - a) * t }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function easeOutBack(t) { const c = 1.35; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) }
function easeInOut(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2 }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

export function createGource(canvasEl, repo, options = {}) {
  // Resolve the canvas robustly — the React ref can be stale across HMR,
  // so fall back to a stable DOM id.
  const canvas = canvasEl || document.getElementById('gource-canvas')
  if (!canvas) throw new Error('gource canvas not found')
  const ctx = canvas.getContext('2d')
  const reduceMotion = options.manual ? false : window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---- build tree + layout ----
  const root = { name: '', path: '', children: new Map(), firstTs: Infinity, type: 'dir' }
  // a file whose only events in the window are deletions never existed here
  const everAlive = new Set()
  for (const c of repo.commits) for (const f of c.files) if (f.s !== 'D') everAlive.add(f.p)
  for (const c of repo.commits) for (const f of c.files) {
    if (!everAlive.has(f.p)) continue
    const parts = f.p.split('/').filter(Boolean)
    let node = root
    node.firstTs = Math.min(node.firstTs, c.ts)
    for (let i = 0; i < parts.length - 1; i++) {
      // if node is a leaf but we need to traverse deeper, promote it to a dir
      if (!node.children) {
        node.children = new Map()
        node.type = 'dir'
      }
      let ch = node.children.get(parts[i])
      if (!ch) { ch = { name: parts[i], path: node.path ? node.path + '/' + parts[i] : parts[i], children: new Map(), firstTs: Infinity, type: 'dir', burst: c.files.length }; node.children.set(parts[i], ch) }
      ch.firstTs = Math.min(ch.firstTs, c.ts)
      node = ch
    }
    const leafName = parts[parts.length - 1]
    let leaf = node.children.get(leafName)
    if (!leaf) { leaf = { name: leafName, path: f.p, children: null, firstTs: Infinity, type: 'file', burst: c.files.length }; node.children.set(leafName, leaf) }
    leaf.firstTs = Math.min(leaf.firstTs, c.ts)
  }
  const nodes = [root]
  const walk = n => { for (const ch of n.children.values()) { nodes.push(ch); if (ch.children) walk(ch) } }
  walk(root)
  const byPath = new Map(); nodes.forEach(v => byPath.set(v.path, v))

  // prune to a manageable node count, keeping ancestors
  const MAX_NODES = 1400
  let visible
  if (nodes.length - 1 > MAX_NODES) {
    const score = new Map()
    for (const n of nodes) if (n !== root) score.set(n, 1)
    for (const c of repo.commits) for (const f of c.files) {
      const parts = f.p.split('/').filter(Boolean)
      for (let i = 0; i <= parts.length; i++) {
        const acc = parts.slice(0, i).join('/')
        if (!acc) continue
        const v = byPath.get(acc); if (v) score.set(v, (score.get(v) || 0) + 1)
      }
    }
    const ranked = [...nodes].filter(n => n !== root).sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0)).slice(0, MAX_NODES)
    const keep = new Set(ranked)
    for (const n of ranked) {
      const parts = n.path.split('/')
      for (let i = 1; i < parts.length; i++) {
        const v = byPath.get(parts.slice(0, i).join('/')); if (v) keep.add(v)
      }
    }
    visible = [...keep]
  } else {
    visible = nodes.filter(n => n !== root)
  }

  // assign x (leaf units) + depth + parent refs
  let leafCursor = 0
  const assign = (node, depth) => {
    node.depth = depth
    if (!node.children || node.children.size === 0) {
      node.leafIndex = leafCursor; node.x = leafCursor + 0.5; leafCursor += 1
    } else {
      let min = Infinity, max = -Infinity
      for (const ch of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) { assign(ch, depth + 1); min = Math.min(min, ch.x); max = Math.max(max, ch.x) }
      node.x = (min + max) / 2
    }
    const parts = node.path.split('/')
    node.parent = parts.length > 1 ? (byPath.get(parts.slice(0, -1).join('/')) || root) : root
  }
  assign(root, 0)
  const leafCount = leafCursor || 1

  const from = repo.stats.from, to = repo.stats.to
  const span = Math.max(1, to - from)
  // Scale animation duration with commit density:
  // ~3s per commit, clamped to [30s, 300s] for the full history at 1×
  const commitCount = repo.commits.length
  const BASE_SEC = Math.max(30, Math.min(300, commitCount * 3))
  const histPerSec = span / (options.duration || BASE_SEC)

  const visibleSet = new Set(visible)
  // per-node colour
  for (const n of visible) n.color = n.type === 'file' ? colorForPath(n.path) : C.dir
  // subtree file counts drive label priority and big-folder collapsing
  const weightMemo = new Map()
  function weightOf(n) {
    if (weightMemo.has(n)) return weightMemo.get(n)
    let w = 0
    for (const c of n.children?.values() || []) { if (!visibleSet.has(c)) continue; w += c.type === 'file' ? 1 : weightOf(c) }
    weightMemo.set(n, w)
    return w
  }
  for (const n of visible) if (n.type === 'dir') { n.weight = weightOf(n); n.fileCount = [...n.children.values()].filter(c => visibleSet.has(c) && c.type === 'file').length }
  const COLLAPSE_FILES = 60 // folders with this many files fold into one disc when small on screen
  // Gource-style folder tint: the average colour of the files inside, falling
  // back to the child folders' tint, blended with the neutral folder grey.
  const tintMemo = new Map()
  function tintOf(n) {
    if (tintMemo.has(n)) return tintMemo.get(n)
    const kids = [...(n.children?.values() || [])].filter(c => visibleSet.has(c))
    const files = kids.filter(c => c.type === 'file'), dirs = kids.filter(c => c.type === 'dir')
    const src = files.length ? files.map(f => f.color) : dirs.map(tintOf)
    let t = C.dir
    if (src.length) t = src.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map(v => v / src.length)
    const out = t.map((v, i) => Math.round(lerp(C.dir[i], v, 0.55)))
    tintMemo.set(n, out)
    return out
  }

  // ---- spike cascade ----
  // Nodes born in the same commit don't all pop at once: they unfold in tree
  // order (parents first, alphabetical sweep) over a window that grows with the
  // size of the burst. Offsets live in history-time so seeking and video export
  // reproduce the exact same unfolding.
  const CASCADE_MAX = 2.6 // wall seconds at 1× for the largest bursts
  function cascadeSeconds(count) { return count <= 3 ? 0 : Math.min(CASCADE_MAX, 0.32 * Math.log2(count)) }
  const bornAt = new Map() // firstTs -> nodes in DFS order
  const collect = node => {
    if (node !== root && visibleSet.has(node)) { let list = bornAt.get(node.firstTs); if (!list) { list = []; bornAt.set(node.firstTs, list) } list.push(node) }
    if (!node.children) return
    for (const ch of [...node.children.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))) collect(ch)
  }
  collect(root)
  for (const list of bornAt.values()) {
    const window = cascadeSeconds(list.length) * histPerSec
    list.forEach((n, i) => { n.appearTs = n.firstTs + (list.length > 1 ? (i / (list.length - 1)) * window : 0) })
  }
  for (const n of visible) if (n.type === 'dir') n.color = tintOf(n)
  const spikeThreshold = 20
  // Per-commit geometry in graph units, computed once on first display.
  // origin = mean position of the nearest ancestors that already existed when
  // the commit landed (the file itself when it was only modified).
  // Per-renderer: the repo object is shared with other renderers (video mode,
  // export), and node references must never leak between trees.
  const geometryCache = new Map()
  function commitGeometry(i) {
    const c = repo.commits[i]
    if (geometryCache.has(i)) return geometryCache.get(i)
    const cap = c.files.length >= spikeThreshold ? 48 : 16
    const stride = Math.max(1, Math.ceil(c.files.length / cap))
    // Measured against the tree as it stood when the commit landed, so the
    // cached answer is the same whether it is reached by playing or by seeking.
    const then = series.snapshot(c.ts)
    const targets = c.files.filter((_, j) => j % stride === 0).map(f => byPath.get(f.p)).filter(n => n && then.positions.has(n)).slice(0, cap)
    let ox = 0, oy = 0
    for (const n of targets) {
      let a = n
      while (a !== root && a.firstTs >= c.ts) a = a.parent
      const [x, y] = then.positions.get(a) || then.center
      ox += x; oy += y
    }
    if (targets.length) { ox /= targets.length; oy /= targets.length } else { [ox, oy] = then.center }
    let reach = 0
    for (const n of targets) { const [x, y] = then.positions.get(n); reach = Math.max(reach, Math.hypot(x - ox, y - oy)) }
    const geom = { targets, origin: [ox, oy], reach }
    geometryCache.set(i, geom)
    return geom
  }

  // ---- state ----
  let curTs = from
  let animationTs = null
  let lastCameraSeconds = null, lastManualFrame = null
  let lastHovered = null
  let lastCollapsed = new Set()
  let playing = true
  let speed = 1
  let lastFrame = performance.now()
  let raf = 0

  // node visual state (smooth fade/position)
  const vis = new Map()
  function vstate(n) {
    let v = vis.get(n)
    if (!v) { v = { a: 0, lx: 0, ly: 0 }; vis.set(n, v) }
    return v
  }

  // ---- author actors (Gource-style avatars that fly to what they touch) ----
  const authorColor = {}
  const acPal = [C.code, C.data, C.image, [120, 220, 120], [220, 120, 200], [220, 200, 100]]
  let ai = 0
  for (const c of repo.commits) if (!authorColor[c.name]) authorColor[c.name] = acPal[ai++ % acPal.length]
  const actors = buildActors(repo.commits, { histPerSec, colorOf: name => authorColor[name] })
  const visitOrigin = v => commitGeometry(v.index).origin
  const avatarImgs = new Map()
  if (options.avatars !== false && typeof Image !== 'undefined') {
    for (const a of actors.slice(0, 60)) loadAvatar(a.email).then(img => { if (img) avatarImgs.set(a.name, img) })
  }
  // ---- contributor cards + date scoreboard (pure functions of history) ----
  // Narrow screens get two lanes so the cards never bury the graph.
  const cardLanes = (canvas.width / Math.min(2, window.devicePixelRatio || 1)) < 640 ? 2 : 3
  const cards = buildContributorCards(repo.commits, { histPerSec, lanes: cardLanes, colorOf: name => authorColor[name] || C.dir })
  const commitTimes = repo.commits.map(c => c.ts)
  // auto-pacing: 1× around commits, 4× through dead stretches (live + export)
  const pacing = buildPacing(commitTimes, { from, to, histPerSec })
  let autoPace = options.autoPace !== false
  const totalCommits = repo.commits.length

  // ---- sizing: React handles canvas dimensions, we just read them ----
  // exports render a logical 1920×1080 (or 1080×1920) at pixelRatio× so 720p,
  // 1080p and 4K share one composition
  let dpr = options.pixelRatio || Math.min(2, window.devicePixelRatio || 1)
  let width = 0, height = 0
  let onTick = null

  function doResize() {
    // read the canvas dimensions (set by React) and update our tracking
    dpr = options.pixelRatio || Math.min(2, window.devicePixelRatio || 1)
    width = canvas.width / dpr
    height = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  doResize()
  const ro = new ResizeObserver(doResize)
  if (canvas.parentElement) ro.observe(canvas.parentElement)
  window.addEventListener('resize', doResize)

  // ---- layout positions (px) ----
  let zoom = 1, panX = 0, panY = 0, dragging = false
  const zoomMotion = motion(0), panMotionX = motion(0), panMotionY = motion(0)
  let pointer = null
  const activityWindow = histPerSec * 2
  const events = buildEvents(repo.commits)
  function latestChange(n) {
    const e = events.get(n.path)
    if (!e) return n.firstTs <= curTs ? n.firstTs : Infinity
    let lo = 0, hi = e.times.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (e.times[mid] <= curTs) lo = mid + 1; else hi = mid }
    return lo ? e.times[lo - 1] : Infinity
  }
  // Presence 1..0: a file fades out over 0.8 s of playback after a deletion
  // (and comes back if re-created); a folder is as present as its most
  // present child. Deterministic, cached per frame.
  const DEATH_FADE = 0.8
  let presenceCache = new Map()
  function presence(n) {
    if (n === root) return 1
    let p = presenceCache.get(n)
    if (p !== undefined) return p
    if (n.type === 'file') {
      if (curTs < n.appearTs) p = 0
      else { const d = deletedAt(events.get(n.path), curTs); p = d == null ? 1 : Math.max(0, 1 - (curTs - d) / (histPerSec * DEATH_FADE)) }
    } else {
      const kids = [...n.children.values()].filter(c => visibleSet.has(c))
      if (!kids.length) p = curTs < n.appearTs ? 0 : 1
      else { p = 0; for (const c of kids) { p = Math.max(p, presence(c)); if (p >= 1) break } }
    }
    presenceCache.set(n, p)
    return p
  }
  // The tree reorganises as history plays: the layout is solved at a handful of
  // eras and moved between them, so early history uses the whole canvas instead
  // of a corner of a picture sized for the end of the story. `graph` is
  // re-sampled once per frame; every read below sees the tree as it stood at
  // that moment. The end state is crossing-free by construction; the rearranging
  // in between is not, and is measured instead: at six eras no folder that has
  // settled crosses another anywhere in a real repository's history, where four
  // leaves a couple of cousin branches overlapping for a moment. Pass 1 for a
  // single fixed layout if that trade is not wanted.
  const series = layoutSeries(root, visible, options.eras ?? 6)
  const now = () => animationTs ?? curTs
  let graph = series.sample(curTs)

  // Growing positions resolve through the parent chain: a file born inside a
  // folder that is itself still unfolding sprouts from wherever that folder is
  // right now, and anything not yet born sits on its nearest living ancestor.
  // That is what makes a big import bloom outward instead of dotting the final
  // layout. Cached per frame; cleared at the top of draw().
  const bloom = createBloom(), backdrop = createBackdrop()
  let wallClock = 0 // seconds of playback, for atmosphere drift (deterministic in exports)
  let posCache = new Map()
  function graphPos(n) {
    if (n === root) return graph.positions.get(root) || graph.center
    let p = posCache.get(n)
    if (p) return p
    const final = graph.positions.get(n) || graph.center
    const t = (now() - n.appearTs) / (histPerSec * 0.7)
    if (reduceMotion || t >= 1) p = final
    else {
      const growth = easeOutBack(Math.max(0, t))
      const parent = graphPos(n.parent)
      p = [lerp(parent[0], final[0], growth), lerp(parent[1], final[1], growth)]
    }
    posCache.set(n, p)
    return p
  }

  // ---- camera ----
  // Gource-style auto-fit: the view frames what exists right now and pulls back
  // smoothly as a burst unfolds. Manual zoom/pan/wheel takes over until Reset.
  const CAM_MAX_ZOOM = 3 // never zoom in past 3× the full-graph fit
  const cam = { scale: 0, cx: graph.center[0], cy: graph.center[1], snap: true }
  const cameraX = motion(cam.cx), cameraY = motion(cam.cy), cameraScale = motion(0)
  const screenX = motion(0), screenY = motion(0)
  let userCamera = false
  let view = null
  function viewport() {
    const side = options.manual ? 70 : width >= 900 ? 260 : 24
    const aw = Math.max(100, width - side - 70)
    const ah = Math.max(100, height - (options.manual ? 220 : width < 640 ? 175 : 110))
    const cx = side + aw / 2
    const cy = options.manual ? height / 2 + 25 : width < 640 ? 110 + ah / 2 : height / 2
    return { aw, ah, cx, cy, full: Math.min(aw / graph.width, ah / graph.height) }
  }
  function updateCamera(dtWall, focus = []) {
    const nextView = viewport()
    if (!view) { screenX.value = nextView.cx; screenY.value = nextView.cy }
    view = { ...nextView, cx: glide(screenX, nextView.cx, dtWall, 0.35), cy: glide(screenY, nextView.cy, dtWall, 0.35) }
    glide(zoomMotion, Math.log(zoom), dtWall, 0.18, 3)
    glide(panMotionX, panX, dtWall, 0.12)
    glide(panMotionY, panY, dtWall, 0.12)
    if (!cam.scale) cam.scale = view.full
    if (userCamera) return
    // Frame everything alive, plus anything about to be born (their final
    // spots): the camera starts pulling back just before a burst lands rather
    // than chasing it, so new clusters never sprout off-screen.
    const t = now(), lookahead = histPerSec * 0.6
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, count = 0
    for (const n of visible) {
      if (t + lookahead < n.appearTs) continue
      if (t >= n.appearTs && presence(n) <= 0.05) continue
      const [gx, gy] = t < n.appearTs ? graph.positions.get(n) || graph.center : graphPos(n)
      // measure in the orbit's rotated frame so the fit follows the flyover
      const x = gx * fl.cs - gy * fl.sn, y = gx * fl.sn + gy * fl.cs
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; count++
    }
    let scale = view.full, cx = graph.center[0], cy = graph.center[1]
    if (count) {
      const pad = 70 // px of breathing room for labels and spawn rings
      // the near edge of a tilted plane comes closer (k > 1), keep room for it
      const near = flyover ? 1.18 : 1
      scale = Math.min((view.aw - pad * 2) / Math.max(1e-6, (x1 - x0) * near), (view.ah - pad * 2) / Math.max(1e-6, (y1 - y0) * fl.cphi * near))
      // floor/cap relative to the whole graph's fit *in the rotated frame*: the
      // orbit can turn a wide tree on its side, and the axis-aligned fit would
      // then stop the camera from pulling back far enough
      const gw = Math.abs(graph.width * fl.cs) + Math.abs(graph.height * fl.sn), gh = Math.abs(graph.width * fl.sn) + Math.abs(graph.height * fl.cs)
      const fullRot = Math.min(view.aw / Math.max(1e-6, gw * near), view.ah / Math.max(1e-6, gh * fl.cphi * near))
      scale = Math.max(fullRot * 0.8, Math.min(fullRot * CAM_MAX_ZOOM, scale))
      let rcx = (x0 + x1) / 2, rcy = (y0 + y1) / 2
      // Director: lean toward where the commits are landing and dolly in a
      // little when the action is concentrated, without ever framing empty
      // space beyond the tree. Only with the flyover on, so the plain view
      // stays a calm full-tree fit.
      if (flyover && focus.length) {
        let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, fcx = 0, fcy = 0, wsum = 0
        for (const [gx, gy, w] of focus) {
          const x = gx * fl.cs - gy * fl.sn, y = gx * fl.sn + gy * fl.cs
          if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y
          fcx += x * w; fcy += y * w; wsum += w
        }
        fcx /= wsum; fcy /= wsum
        const fpad = 170
        let zoomScale = Math.min((view.aw - fpad * 2) / Math.max(60, (fx1 - fx0) * near), (view.ah - fpad * 2) / Math.max(60, (fy1 - fy0) * fl.cphi * near))
        zoomScale = Math.max(scale, Math.min(scale * 1.5, zoomScale))
        // Dollying in only helps when the tree is big and its dots are tiny;
        // small trees just get a gentle lean toward the action.
        const dolly = Math.max(0, Math.min(1, (count - 150) / 600))
        let dirScale = scale * Math.pow(zoomScale / scale, 0.5 * dolly) // at most ~1.4× the full fit
        // …and never so close that less than 70% of the tree stays in frame
        dirScale = Math.min(dirScale, (view.aw - pad * 2) / Math.max(1e-6, (x1 - x0) * 0.7 * near), (view.ah - pad * 2) / Math.max(1e-6, (y1 - y0) * 0.7 * fl.cphi * near))
        dirScale = Math.max(scale, dirScale)
        const halfW = (view.aw - pad * 2) / dirScale / 2 / near, halfH = (view.ah - pad * 2) / dirScale / 2 / fl.cphi / near
        const lean = 0.12 + 0.18 * dolly
        let lx = lerp(rcx, fcx, lean), ly = lerp(rcy, fcy, lean)
        lx = (x1 - x0) > 2 * halfW ? Math.max(x0 + halfW, Math.min(x1 - halfW, lx)) : rcx
        ly = (y1 - y0) > 2 * halfH ? Math.max(y0 + halfH, Math.min(y1 - halfH, ly)) : rcy
        scale = dirScale; rcx = lx; rcy = ly
      }
      cx = rcx * fl.cs + rcy * fl.sn; cy = -rcx * fl.sn + rcy * fl.cs
    }
    if (cam.snap) {
      cameraScale.value = Math.log(scale); cameraX.value = cx; cameraY.value = cy
      cam.snap = false
    }
    // Screen-relative pan limits keep a far-away burst from throwing the scene.
    // Logarithmic zoom gives the same gentle response at every graph size.
    cam.scale = Math.exp(glide(cameraScale, Math.log(scale), dtWall, 1.25, 0.28))
    cam.cx = glide(cameraX, cx, dtWall, 1.3, view.aw * 0.16 / cam.scale)
    cam.cy = glide(cameraY, cy, dtWall, 1.3, view.ah * 0.16 / cam.scale)
  }
  // ---- flyover: a slow orbit + tilt + perspective over the ground plane ----
  // Orbit advances on the presentation clock, independent of history skips.
  // Switching pacing, seeking or replaying never resets its phase.
  // ---- privacy: hide paths, and optionally people, for closed-source videos ----
  let privacy = normalizePrivacy(options.privacy)
  let showClock = options.clock !== false
  const pseudonyms = buildPseudonyms(repo.commits)
  const displayName = name => privacy === 'all' ? (pseudonyms.get(name) || 'Contributor') : name
  const hidePaths = () => privacy !== 'off'
  let lastLabelCount = 0
  let flyover = !reduceMotion && options.flyover !== false
  const TURN_SECONDS = 210 // one orbit per 210 seconds on screen
  const TILT_BASE = 0.34, TILT_SWAY = 0.06
  let orbitTime = 0
  const orbit = motion(0), tilt = motion(flyover ? TILT_BASE : 0), breathing = motion(1)
  function flight(dt = 0, advance = false) {
    if (advance && flyover) orbitTime += dt
    const th = flyover ? (orbitTime / TURN_SECONDS) * Math.PI * 2 + 0.025 * Math.sin(orbitTime * 0.12) : 0
    const phi = flyover ? TILT_BASE + TILT_SWAY * Math.sin(orbitTime * 0.11) : 0
    const angle = glide(orbit, nearestAngle(th, orbit.value), dt, 1.1, 0.1)
    const pitch = glide(tilt, phi, dt, 0.9, 0.18)
    const breathe = glide(breathing, flyover ? 1 + 0.018 * Math.sin(orbitTime * 0.13) : 1, dt, 0.9)
    return { cs: Math.cos(angle), sn: Math.sin(angle), cphi: Math.cos(pitch), sphi: Math.sin(pitch), breathe }
  }
  let fl = flight()
  // Returns [x, y, k]: k is the perspective factor (near > 1 > far), used for depth cues.
  function project([x, y]) {
    const s = cam.scale * Math.exp(zoomMotion.value) * fl.breathe
    const gx = (x - cam.cx) * s, gy = (y - cam.cy) * s
    const rx = gx * fl.cs - gy * fl.sn, ry = gx * fl.sn + gy * fl.cs
    const D = Math.max(width, height) * 1.7
    const k = D / Math.max(D * 0.35, D - ry * fl.sphi)
    return [view.cx + panMotionX.value + rx * k, view.cy + panMotionY.value + ry * fl.cphi * k, k]
  }
  function nodePos(n) { return project(graphPos(n)) }
  function effectiveZoom() { return (cam.scale / view.full) * Math.exp(zoomMotion.value) }
  function wheel(e) {
    e.preventDefault()
    zoom = Math.max(0.4, Math.min(8, zoom * Math.exp(-e.deltaY * 0.001)))
    userCamera = true
  }
  function move(e) {
    const rect = canvas.getBoundingClientRect()
    const next = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    if (dragging && pointer) { panX += next.x - pointer.x; panY += next.y - pointer.y; userCamera = true }
    pointer = next
  }
  function down(e) { move(e); dragging = true; canvas.setPointerCapture(e.pointerId) }
  function up() { dragging = false }
  function leave() { if (!dragging) pointer = null }
  function resetView() { zoom = 1; panX = 0; panY = 0; userCamera = false }
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'grab'
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('pointerleave', leave)
  canvas.addEventListener('dblclick', resetView)

  function roundRect(x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  // UI scale: the live view is 1:1 CSS px; exports scale with their frame width.
  function uiScale() { return options.manual ? Math.max(0.6, Math.max(width, height) / 1600) : width < 640 ? 0.86 : 1 }
  function setLetterSpacing(px) { try { ctx.letterSpacing = `${px}px` } catch { /* older canvas */ } }

  // Broadcast lower-thirds: slide in from the right with an overshoot, hold,
  // then slide back out. Progress is history-time so exports are frame exact.
  function drawCards() {
    const t = now()
    const ui = uiScale()
    const isMobile = width < 640
    const cw = Math.min(width - 28, 318 * ui), ch = 74 * ui, r = 10 * ui
    const gapRight = options.manual ? width * 0.031 : isMobile ? 14 : 24
    const baseBottom = options.manual ? height * 0.1 : isMobile ? 66 : 150
    const travel = cw + gapRight + 24
    for (const cd of cards) {
      const dt = t - cd.showTs
      if (dt < 0 || dt > cd.life) continue
      const p = dt / cd.life
      const IN = 0.11, OUT = 0.87
      let offset = 0, alpha = 1
      if (p < IN) { const k = p / IN; offset = reduceMotion ? 0 : travel * (1 - easeOutBack(k)); alpha = Math.min(1, k * 2.5) }
      else if (p > OUT) { const k = (p - OUT) / (1 - OUT); offset = reduceMotion ? 0 : travel * k * k; alpha = 1 - k * k }
      if (alpha <= 0.02) continue
      const x = width - gapRight - cw + offset
      const y = height - baseBottom - ch - cd.lane * (ch + 10 * ui)
      const col = cd.col
      ctx.save()
      ctx.globalAlpha = alpha
      // drop shadow + body
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18 * ui; ctx.shadowOffsetY = 6 * ui
      ctx.fillStyle = rgba(C.bubbleBg, 0.94)
      roundRect(x, y, cw, ch, r); ctx.fill()
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
      ctx.strokeStyle = rgba(col, 0.45); ctx.lineWidth = 1
      roundRect(x, y, cw, ch, r); ctx.stroke()
      // everything below stays inside the rounded body
      roundRect(x, y, cw, ch, r); ctx.clip()
      // angled accent stripes (the "broadcast" cut)
      ctx.fillStyle = rgba(col, 1)
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 24 * ui, y); ctx.lineTo(x + 14 * ui, y + ch); ctx.lineTo(x, y + ch); ctx.closePath(); ctx.fill()
      ctx.fillStyle = rgba(col, 0.35)
      ctx.beginPath(); ctx.moveTo(x + 27 * ui, y); ctx.lineTo(x + 32 * ui, y); ctx.lineTo(x + 22 * ui, y + ch); ctx.lineTo(x + 17 * ui, y + ch); ctx.closePath(); ctx.fill()
      // entrance flash
      if (p < IN * 1.6) { ctx.fillStyle = rgba(col, (1 - p / (IN * 1.6)) * 0.22); ctx.fillRect(x, y, cw, ch) }
      // avatar: initials on the author colour
      const ax = x + 60 * ui, ay = y + ch / 2
      ctx.fillStyle = rgba(col, 1)
      ctx.beginPath(); ctx.arc(ax, ay, 20 * ui, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = rgba(C.bubbleBg, 0.95)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = `700 ${14 * ui}px "Space Grotesk", sans-serif`
      ctx.fillText(initials(displayName(cd.name)), ax, ay + 1 * ui)
      // jersey number / milestone count, outlined on the right
      const big = cd.kind === 'debut' ? `#${cd.join}` : String(cd.commits)
      ctx.font = `800 ${34 * ui}px "Space Grotesk", sans-serif`
      ctx.textAlign = 'right'
      const bigW = ctx.measureText(big).width
      ctx.lineWidth = 1
      ctx.strokeStyle = rgba(col, 0.75); ctx.fillStyle = rgba(col, 0.16)
      ctx.fillText(big, x + cw - 14 * ui, ay + 1 * ui); ctx.strokeText(big, x + cw - 14 * ui, ay + 1 * ui)
      // text column
      const tx = x + 90 * ui, maxW = cw - 90 * ui - bigW - 26 * ui
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      setLetterSpacing(1.6 * ui)
      ctx.font = `600 ${9 * ui}px "JetBrains Mono", monospace`
      ctx.fillStyle = rgba(col, 1)
      ctx.fillText(cd.kind === 'debut' ? 'NEW CONTRIBUTOR' : `MILESTONE · ${cd.commits} COMMITS`, tx, y + 22 * ui, maxW)
      setLetterSpacing(0)
      ctx.font = `700 ${15 * ui}px "Space Grotesk", sans-serif`
      ctx.fillStyle = 'rgba(235,240,248,0.98)'
      ctx.fillText(displayName(cd.name), tx, y + 42 * ui, maxW)
      ctx.font = `500 ${10 * ui}px "JetBrains Mono", monospace`
      ctx.fillStyle = 'rgba(164,182,203,0.9)'
      const d = dateParts(cd.ts)
      const stat = cd.kind === 'debut'
        ? `first commit · ${cd.files} file${cd.files === 1 ? '' : 's'} · ${d.day} ${d.month} ${d.year}`
        : `${cd.commits} commits · ${cd.files} files touched`
      ctx.fillText(stat, tx, y + 58 * ui, maxW)
      // draining timer bar
      const bx = x + 34 * ui, bw = cw - 48 * ui
      ctx.fillStyle = rgba(col, 0.14); ctx.fillRect(bx, y + ch - 3 * ui, bw, 2 * ui)
      ctx.fillStyle = rgba(col, 0.85); ctx.fillRect(bx, y + ch - 3 * ui, bw * (1 - p), 2 * ui)
      ctx.restore()
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  }

  // Scoreboard date: the one thing you should always be able to read at a glance.
  function drawDate() {
    const t = now()
    const ui = uiScale()
    const isMobile = width < 640
    const d = dateParts(Math.min(to, Math.max(from, t)))
    const done = commitsBefore(commitTimes, t)
    const w = 196 * ui, h = 66 * ui, r = 10 * ui
    const x = options.manual ? width - width * 0.031 - w : isMobile ? 14 : width - 24 - w
    const y = options.manual ? height * 0.038 : isMobile ? 110 : 20
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14 * ui; ctx.shadowOffsetY = 4 * ui
    ctx.fillStyle = rgba(C.bubbleBg, 0.86)
    roundRect(x, y, w, h, r); ctx.fill()
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    ctx.strokeStyle = 'rgba(115,137,162,0.22)'; ctx.lineWidth = 1
    roundRect(x, y, w, h, r); ctx.stroke()
    // accent tick
    ctx.fillStyle = 'rgba(100,222,219,0.9)'
    ctx.fillRect(x + 14 * ui, y + 15 * ui, 3 * ui, 10 * ui)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    setLetterSpacing(2 * ui)
    ctx.font = `600 ${9 * ui}px "JetBrains Mono", monospace`
    ctx.fillStyle = 'rgba(129,147,170,1)'
    ctx.fillText('TIMELINE', x + 23 * ui, y + 24 * ui)
    setLetterSpacing(0)
    // big date: DD MON YYYY with tabular digits
    ctx.font = `700 ${24 * ui}px "Space Grotesk", sans-serif`
    ctx.fillStyle = 'rgba(235,240,248,1)'
    ctx.fillText(d.day, x + 14 * ui, y + 48 * ui)
    const dayW = ctx.measureText('00').width
    ctx.fillStyle = 'rgba(100,222,219,1)'
    ctx.fillText(d.month, x + 14 * ui + dayW + 8 * ui, y + 48 * ui)
    const monW = ctx.measureText('MMM').width
    ctx.fillStyle = 'rgba(235,240,248,1)'
    ctx.fillText(d.year, x + 14 * ui + dayW + monW + 16 * ui, y + 48 * ui)
    ctx.font = `500 ${9 * ui}px "JetBrains Mono", monospace`
    ctx.fillStyle = 'rgba(129,147,170,1)'
    ctx.fillText(`${d.weekday} · ${done}/${totalCommits} commits`, x + 14 * ui, y + 60 * ui, w - 28 * ui)
    ctx.restore()
    if (showClock) drawClock(Math.min(to, Math.max(from, t)), isMobile ? x + w + 10 * ui : x - 10 * ui - h, y, h, ui)
    ctx.textAlign = 'center'
  }

  // Analog clock beside the scoreboard: the time of day of the history clock.
  // Hands sweep through quiet stretches at auto-pace speed, which reads as
  // "time flying" — the point of the whole thing.
  function drawClock(ts, x, y, size, ui) {
    const r = size / 2, cx = x + r, cy = y + r
    const dt = new Date(ts * 1000)
    const hours = dt.getUTCHours() + dt.getUTCMinutes() / 60
    const night = hours < 6 || hours >= 20
    ctx.save()
    // face
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14 * ui; ctx.shadowOffsetY = 4 * ui
    const face = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r)
    face.addColorStop(0, night ? 'rgba(22,30,46,0.96)' : 'rgba(26,38,54,0.96)'); face.addColorStop(1, rgba(C.bubbleBg, 0.92))
    ctx.fillStyle = face
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    ctx.strokeStyle = 'rgba(115,137,162,0.28)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
    // day/night: a faint arc of sky along the rim, brighter by day
    const rim = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r)
    rim.addColorStop(0, 'rgba(100,222,219,0)'); rim.addColorStop(1, night ? 'rgba(140,120,255,0.18)' : 'rgba(100,222,219,0.16)')
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    // ticks: 60 hairlines, quarters in accent
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, quarter = i % 15 === 0, hour = i % 5 === 0
      const inner = r * (quarter ? 0.78 : hour ? 0.84 : 0.9), outer = r * 0.95
      ctx.strokeStyle = quarter ? rgba(C.accent, 0.95) : hour ? 'rgba(200,215,235,0.7)' : 'rgba(129,147,170,0.35)'
      ctx.lineWidth = (quarter ? 1.6 : 1) * ui
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner); ctx.lineTo(cx + Math.sin(a) * outer, cy - Math.cos(a) * outer); ctx.stroke()
    }
    // hands
    const hand = (angle, length, width, color, tail = 0.18) => {
      ctx.strokeStyle = color; ctx.lineWidth = width * ui; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(cx - Math.sin(angle) * r * tail, cy + Math.cos(angle) * r * tail); ctx.lineTo(cx + Math.sin(angle) * r * length, cy - Math.cos(angle) * r * length); ctx.stroke()
    }
    // one hand: the hour (minutes only make it a blur at history speed)
    const ha = (hours % 12) / 12 * Math.PI * 2
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3 * ui
    hand(ha, 0.62, 2.8, rgba(C.accent, 1))
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
    ctx.fillStyle = rgba(C.accent, 1); ctx.beginPath(); ctx.arc(cx, cy, 2.2 * ui, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = rgba(C.bubbleBg, 1); ctx.beginPath(); ctx.arc(cx, cy, 0.9 * ui, 0, Math.PI * 2); ctx.fill()
    // AM / PM
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    ctx.font = `600 ${7 * ui}px "JetBrains Mono", monospace`
    ctx.fillStyle = 'rgba(129,147,170,0.9)'
    setLetterSpacing(1 * ui); ctx.fillText(hours >= 12 ? 'PM' : 'AM', cx, cy + r * 0.52); setLetterSpacing(0)
    ctx.restore()
  }

  function draw(dtWall = 0, advanceOrbit = playing) {
    wallClock += Math.min(0.1, Math.max(0, dtWall))
    ctx.clearRect(0, 0, width, height)
    graph = series.sample(now())
    posCache = new Map(); presenceCache = new Map()
    fl = flight(dtWall, advanceOrbit)
    // ---- activity heat: recently changed files warm the whole chain up to root ----
    const fresh = new Map()
    for (const n of visible) {
      if (n.type !== 'file') continue
      const age = curTs - latestChange(n) // negative/NaN when the file is not born yet
      if (!(age >= 0)) continue
      const f = 1 - age / activityWindow
      if (f <= 0) continue
      fresh.set(n, f)
      for (let a = n.parent; a && a !== root; a = a.parent) { if ((fresh.get(a) || 0) >= f) break; fresh.set(a, f) }
    }
    // where the action is: fresh files plus actors that are beaming
    const focus = []
    for (const [n, f] of fresh) if (n.type === 'file' && f > 0.3) { const [x, y] = graphPos(n); focus.push([x, y, f]) }
    const actorStates = []
    for (const a of actors) {
      const st = actorState(a, now(), histPerSec, visitOrigin)
      if (st) { actorStates.push([a, st]); if (st.acting > 0) focus.push([st.target[0], st.target[1], 1.5]) }
    }
    updateCamera(dtWall, focus)
    const ez = effectiveZoom()
    // Atmosphere sits behind everything: an additive wash, so the page and the
    // export composition keep painting their own background underneath.
    if (!reduceMotion) {
      const [gcx, gcy] = project(graph.center)
      backdrop(ctx, canvas, gcx, gcy, Math.max(width, height) * 0.34, wallClock)
      drawDust(ctx, width, height, wallClock, width < 640 ? 40 : 90)
    }
    const isMobile = width < 640
    const labels = []
    const actorPositions = [], actorLabels = []
    let hovered = null

    // hover: the chain from the hovered node up to root, plus its direct children
    const chain = new Set()
    for (let a = lastHovered; a && a !== root; a = a.parent) chain.add(a)
    const onChain = n => chain.has(n) || (lastHovered && n.parent === lastHovered)

    // big folders fold into a single disc while they are small on screen
    // fold when the dots would sit closer than ~11 px apart (density, not size)
    const collapsed = new Set()
    for (const n of visible) if (n.type === 'dir' && n.fileCount >= COLLAPSE_FILES) {
      const R = (graph.radii.get(n) || 0) * cam.scale * Math.exp(zoomMotion.value)
      if (R * R / n.fileCount < 120) collapsed.add(n)
    }
    lastCollapsed = collapsed
    const aliveFiles = n => { let k = 0; for (const c of n.children.values()) if (visibleSet.has(c) && c.type === 'file' && presence(c) > 0.5) k++; return k }
    const labelCandidates = []
    // ---- edges (Gource-style colour ribbons: parent tint → child tint) ----
    ctx.lineCap = 'round'
    const spokes = ez > 1.8 || !!lastHovered
    for (const n of visible) {
      const target = presence(n)
      const v = vstate(n)
      v.a = reduceMotion || options.manual ? target : lerp(v.a, target, 0.08)
      if (v.a < 0.03) continue
      const isDir = n.type === 'dir'
      const hot = onChain(n)
      if (!isDir && (!(spokes && (hot || ez > 1.8)) || collapsed.has(n.parent))) continue
      const [px, py, pk] = nodePos(n.parent)
      const [nx, ny, nk] = nodePos(n)
      const heat = fresh.get(n) || 0
      const depth = (pk + nk) / 2
      if (!isDir) {
        // file spokes only when zoomed in or inspecting a folder
        ctx.strokeStyle = rgba(n.color, v.a * (hot ? 0.6 : 0.14 + heat * 0.3))
        ctx.lineWidth = 0.8
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke()
        continue
      }
      const depthFade = Math.max(0.55, 1 - n.depth * 0.08)
      const alpha = v.a * (hot ? 0.95 : Math.min(0.9, 0.42 * depthFade + heat * 0.5))
      const w = ((hot ? 2.8 : 2.1 - Math.min(1, n.depth * 0.18)) + heat * 0.6) * depth
      // Branches bow with the tree rather than at a random angle: the control
      // point is the chord's midpoint pushed back out to the mean radius of the
      // two ends. A branch that runs straight out from the trunk stays straight,
      // one that reaches sideways sweeps around the ring — and because the
      // curve then stays inside the wedge the layout gave it, bending an edge
      // can no longer make it cross a neighbour (a random sideways bend did,
      // hundreds of times, even on a layout with no crossings at all).
      const dx = nx - px, dy = ny - py
      const [ox, oy] = graphPos(root)
      const gp = graphPos(n.parent), gn = graphPos(n)
      const gmx = (gp[0] + gn[0]) / 2 - ox, gmy = (gp[1] + gn[1]) / 2 - oy
      const chord = Math.hypot(gmx, gmy)
      const mean = (Math.hypot(gp[0] - ox, gp[1] - oy) + Math.hypot(gn[0] - ox, gn[1] - oy)) / 2
      const lift = chord > 1e-3 ? Math.min(1.6, mean / chord) : 1
      const [cx, cy] = project([ox + gmx * lift, oy + gmy * lift])
      ctx.strokeStyle = `rgba(0,0,0,${(0.35 * alpha).toFixed(3)})`
      ctx.lineWidth = w + 2
      ctx.beginPath(); ctx.moveTo(px + 1.5, py + 1.5); ctx.quadraticCurveTo(cx + 1.5, cy + 1.5, nx + 1.5, ny + 1.5); ctx.stroke()
      const g = ctx.createLinearGradient(px, py, nx, ny)
      const parentTint = n.parent === root ? C.dir : n.parent.color
      g.addColorStop(0, rgba(hot ? C.accent : parentTint, alpha * 0.85))
      g.addColorStop(1, rgba(hot ? C.accent : n.color, alpha))
      ctx.strokeStyle = g
      ctx.lineWidth = w
      ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(cx, cy, nx, ny); ctx.stroke()
      // Activity travels from parent to child along the actual curved branch.
      // History time makes these highlights repeatable in seeks and exports.
      if (heat > 0.15 || hot) {
        ctx.strokeStyle = rgba(hot ? C.accent : n.color, alpha * 0.07)
        ctx.lineWidth = w + 7
        ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(cx, cy, nx, ny); ctx.stroke()
        if (!reduceMotion && heat > 0.15 && Math.hypot(dx, dy) > 40) {
          const phase = ((now() - from) / histPerSec * 0.65 + (hashStr(n.path) % 100) / 100) % 1
          for (let j = 0; j < 3; j++) {
            const t = (phase + j / 3) % 1, q = 1 - t
            const x = q*q*px + 2*q*t*cx + t*t*nx, y = q*q*py + 2*q*t*cy + t*t*ny
            const a = Math.sin(t * Math.PI) * heat * v.a
            const tail = Math.max(0, t - 0.14), tq = 1 - tail
            ctx.strokeStyle = rgba(n.color, a * 0.5); ctx.lineWidth = 2.2 * depth
            ctx.beginPath(); ctx.moveTo(tq*tq*px + 2*tq*tail*cx + tail*tail*nx, tq*tq*py + 2*tq*tail*cy + tail*tail*ny)
            ctx.lineTo(x, y); ctx.stroke()
            ctx.fillStyle = rgba(n.color, a * 0.12)
            ctx.beginPath(); ctx.arc(x, y, 5 * depth, 0, Math.PI * 2); ctx.fill()
            ctx.fillStyle = rgba([225, 244, 248], a * 0.75)
            ctx.beginPath(); ctx.arc(x, y, 1.2 * depth, 0, Math.PI * 2); ctx.fill()
          }
        }
      }
    }

    // Large commits send bounded, layered waves behind the files and labels.
    if (!reduceMotion) {
      const impacts = actorStates.filter(([, st]) => st.acting > 0 && st.travel >= 1)
        .sort((a, b) => repo.commits[b[1].visit.index].files.length - repo.commits[a[1].visit.index].files.length).slice(0, 4)
      for (const [actor, st] of impacts) {
        const count = repo.commits[st.visit.index].files.length
        if (count < 8) continue
        const geom = commitGeometry(st.visit.index), [x, y] = project(geom.origin)
        const radius = Math.min(Math.min(width, height) * 0.38, 45 + Math.sqrt(count) * 12)
        drawCommitWave(ctx, x, y, radius, actor.col, 1 - st.acting, st.alpha)
      }
    }

    // root hub: a quiet marker where the top-level branches meet
    {
      const [rx, ry] = nodePos(root)
      ctx.globalAlpha = 0.9
      ctx.fillStyle = rgba(C.bubbleBg, 1)
      ctx.beginPath(); ctx.arc(rx, ry, 6, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = rgba(C.dir, 0.7); ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(rx, ry, 6, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = rgba(C.dir, 0.9)
      ctx.beginPath(); ctx.arc(rx, ry, 2, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
    }

    // nodes
    ctx.textAlign = 'center'
    for (const n of visible) {
      const v = vstate(n)
      if (v.a < 0.04) continue
      const isDir = n.type === 'dir'
      if (!isDir && collapsed.has(n.parent)) continue
      const [nx, ny, depth] = nodePos(n)
      const baseSize = isDir ? 4 : Math.max(1.8, Math.min(4.2, Math.min(width, height) * ez / Math.sqrt(leafCount) / 12))
      // dying files shrink as they fade
      const size = baseSize * depth * (isDir ? 1 : 0.5 + 0.5 * v.a)
      if (size < 0.5) continue

      // Freshness: new files are bright; files nobody has touched for a long
      // stretch of playback sink into the background
      const idle = (curTs - latestChange(n)) / histPerSec
      const floor = isDir ? 0.45 : lerp(0.55, 0.36, Math.max(0, Math.min(1, (idle - 12) / 30)))
      const heat = fresh.get(n) || 0
      const freshness = Math.max(floor, heat)
      const alpha = v.a * freshness
      const hot = onChain(n) || n === lastHovered

      // folder bloom: a soft disc over the file ring so clusters read as one body
      if (isDir) {
        // capped in px so zooming in never turns a small folder into grey fog
        const r = Math.min(110, (graph.radii.get(n) || 0) * cam.scale * Math.exp(zoomMotion.value) * depth)
        if (r > 8) {
          const bloom = ctx.createRadialGradient(nx, ny, 0, nx, ny, r)
          const strength = Math.max(0.45, Math.min(1, 36 / r))
          bloom.addColorStop(0, rgba(n.color, (0.10 + freshness * 0.16 + (hot ? 0.14 : 0)) * v.a * strength))
          bloom.addColorStop(1, rgba(n.color, 0))
          ctx.globalAlpha = 1
          ctx.fillStyle = bloom
          ctx.beginPath(); ctx.arc(nx, ny, r, 0, Math.PI * 2); ctx.fill()
        }
      }

      // a big folder folded into one disc: a dense body with a file count label
      if (isDir && collapsed.has(n)) {
        const R = Math.max(14, (graph.radii.get(n) || 0) * cam.scale * Math.exp(zoomMotion.value) * depth)
        const disc = ctx.createRadialGradient(nx, ny, R * 0.15, nx, ny, R)
        disc.addColorStop(0, rgba(n.color, 0.45 * v.a)); disc.addColorStop(1, rgba(n.color, 0.07 * v.a))
        ctx.globalAlpha = 1; ctx.fillStyle = disc
        ctx.beginPath(); ctx.arc(nx, ny, R, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = rgba(n.color, (hot ? 0.9 : 0.5) * v.a); ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(nx, ny, R, 0, Math.PI * 2); ctx.stroke()
        if (pointer && Math.hypot(pointer.x - nx, pointer.y - ny) < R) hovered = n
      }

      // outer glow (strong for fresh nodes)
      ctx.globalAlpha = alpha * (freshness > 0.9 ? 0.3 : 0.06)
      ctx.fillStyle = rgba(n.color, 1)
      ctx.beginPath(); ctx.arc(nx, ny, size * 3, 0, Math.PI * 2); ctx.fill()

      // spawn flash: a bright expanding ring the moment a node is born
      const birth = ((animationTs ?? curTs) - n.appearTs) / (histPerSec * 0.6)
      if (!reduceMotion && birth >= 0 && birth < 1) {
        const k = easeOutCubic(birth)
        const flash = Math.max(0.25, 1 / Math.sqrt(Math.max(1, (n.burst || 1) / 12)))
        ctx.globalAlpha = (1 - k) * 0.7 * flash
        ctx.strokeStyle = rgba(n.color, 1)
        ctx.lineWidth = 1.5 - k
        ctx.beginPath(); ctx.arc(nx, ny, size * 1.5 + k * (isDir ? 22 : 14), 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = (1 - k) * 0.5 * flash
        ctx.fillStyle = 'rgba(255,255,255,1)'
        ctx.beginPath(); ctx.arc(nx, ny, size * (1 + (1 - k) * 0.8), 0, Math.PI * 2); ctx.fill()
      }

      // modification flash: a thin white ring, distinct from the coloured birth ring
      if (!reduceMotion && !isDir && heat > 0.85 && birth >= 1) {
        const k = (1 - heat) / 0.15
        ctx.globalAlpha = (1 - k) * 0.55 * v.a
        ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(nx, ny, size * 1.4 + k * 9, 0, Math.PI * 2); ctx.stroke()
      }
      // deletion: a brief red ring as the file collapses
      if (!reduceMotion && !isDir && v.a < 0.999) {
        const d = deletedAt(events.get(n.path), curTs)
        const k = d == null ? 1 : (now() - d) / (histPerSec * 0.5)
        if (k >= 0 && k < 1) {
          ctx.globalAlpha = (1 - k) * 0.6
          ctx.strokeStyle = 'rgba(255,110,110,1)'; ctx.lineWidth = 1.2
          ctx.beginPath(); ctx.arc(nx, ny, size * 1.2 + k * 10, 0, Math.PI * 2); ctx.stroke()
        }
      }

      if (isDir) {
        ctx.globalAlpha = v.a * (hot ? 0.9 : 0.45)
        ctx.strokeStyle = rgba(hot ? C.accent : C.dir, 1)
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(nx, ny, size + 4, 0, Math.PI * 2); ctx.stroke()
      }
      // core
      ctx.globalAlpha = alpha
      ctx.fillStyle = rgba(n.color, 1)
      ctx.beginPath(); ctx.arc(nx, ny, size, 0, Math.PI * 2); ctx.fill()
      if (!isDir && heat > 0.4) {
        ctx.fillStyle = rgba([255, 250, 235], (heat - 0.4) * 0.75)
        ctx.beginPath(); ctx.arc(nx - size * 0.15, ny - size * 0.15, size * 0.45, 0, Math.PI * 2); ctx.fill()
      }

      // label: collected now, drawn afterwards in priority order so the
      // important names win when space is tight
      if (pointer && Math.hypot(pointer.x - nx, pointer.y - ny) < 12) hovered = n
      const wantLabel = !hidePaths() && (isDir
        ? hot || ez > 1.6 || n.depth <= 2 || n.weight >= 6 || heat > 0.5
        : ez > 2 || (!isMobile && alpha > 0.75))
      if (wantLabel && alpha > 0.15) {
        labelCandidates.push({
          n, nx, ny, isDir, alpha: isDir ? v.a * 0.8 : alpha,
          priority: hot ? 1e6 : isDir ? n.weight + (n.depth <= 1 ? 1000 : 0) + heat * 50 : heat * 10,
          sub: isDir && collapsed.has(n) ? `${aliveFiles(n)} files` : null,
        })
      }
      ctx.globalAlpha = 1
    }
    if (hidePaths()) for (const n of collapsed) { const v = vstate(n); if (v.a > 0.04) labelCandidates.push({ n, ...(() => { const [nx, ny] = nodePos(n); return { nx, ny } })(), isDir: true, alpha: v.a * 0.8, priority: n.weight, sub: `${aliveFiles(n)} files`, countOnly: true }) }
    lastLabelCount = 0
    labelCandidates.sort((a, b) => b.priority - a.priority)
    ctx.textAlign = 'center'
    for (const L of labelCandidates) {
      ctx.font = L.isDir ? '600 12px "Space Grotesk", sans-serif' : '500 11px "JetBrains Mono", monospace'
      const maxW = isMobile ? 80 : 120
      let t = L.n.name
      if (t.length > 20) t = t.slice(0, 18) + '…'
      if (ctx.measureText(t).width > maxW) {
        while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
        t += '…'
      }
      const w = ctx.measureText(t).width
      const h = L.sub ? 32 : 20
      const placements = [
        { x: L.nx - w / 2 - 7, y: L.ny + 9, w: w + 14, h },
        { x: L.nx - w / 2 - 7, y: L.ny - h - 9, w: w + 14, h },
        { x: L.nx + 12, y: L.ny - h / 2, w: w + 14, h },
      ]
      const box = placements.find(box => box.x >= 6 && box.y >= 6 && box.x + box.w <= width - 6 && box.y + box.h <= height - 6 && !labels.some(b => box.x < b.x + b.w + 4 && box.x + box.w + 4 > b.x && box.y < b.y + b.h + 3 && box.y + box.h + 3 > b.y))
      if (!box || labels.length >= (isMobile ? 22 : 55) && L.priority < 1e6) continue
      labels.push(box)
      if (!L.countOnly) lastLabelCount++
      ctx.globalAlpha = 1
      if (L.isDir) {
        ctx.fillStyle = rgba(C.bubbleBg, L.alpha * 0.8)
        roundRect(box.x, box.y, box.w, box.h, 5); ctx.fill()
      }
      ctx.fillStyle = rgba(L.isDir ? [215, 228, 241] : L.n.color, L.alpha)
      const tx = box.x + box.w / 2, ty = box.y + 14
      if (!L.countOnly) ctx.fillText(t, tx, ty)
      if (L.sub) { ctx.font = '500 9px "JetBrains Mono", monospace'; ctx.fillStyle = rgba(L.n.color, L.alpha); ctx.fillText(L.sub, tx, ty + (L.countOnly ? 0 : 12)) }

    }

    // ---- author actors ----
    {
      const ui = uiScale()
      ctx.textBaseline = 'middle'
      let energyBudget = isMobile ? 64 : 160
      for (const [a, st] of actorStates) {
        const c = repo.commits[st.visit.index]
        let g = st.target
        if (st.fromPos) { const e = easeInOut(st.travel); g = [lerp(st.fromPos[0], g[0], e), lerp(st.fromPos[1], g[1], e)] }
        else {
          // arrive from outside the tree, along the line from the centre
          const dx = g[0] - graph.center[0], dy = g[1] - graph.center[1], d = Math.hypot(dx, dy) || 1
          const R = Math.max(graph.width, graph.height) * 0.45 + 60
          const e = easeOutCubic(st.travel)
          g = [lerp(g[0] + dx / d * R, g[0], e), lerp(g[1] + dy / d * R, g[1], e)]
        }
        const [ox, oy, k] = project(g)
        const alpha = st.alpha * (st.fromPos ? 1 : easeOutCubic(Math.min(1, st.travel * 1.5)))
        if (alpha < 0.03) continue
        const r = 12 * ui * Math.min(1.3, k)
        let ax = ox + Math.cos(a.phase) * 46 * ui, ay = oy + Math.sin(a.phase) * 46 * ui - 8 * ui
        // Nearby contributors get separate orbits instead of covering each other.
        for (let j = 0; j < 24; j++) {
          const ring = Math.floor(j / 8), radius = (50 + ring * 38) * ui
          const angle = a.phase + j * Math.PI / 4 + ring * 0.3
          const x = ox + Math.cos(angle) * radius, y = oy + Math.sin(angle) * radius - 8 * ui
          if (x < r + 8 || y < r + 8 || x > width - r - 8 || y > height - r - 8) continue
          if (actorPositions.some(p => Math.hypot(p[0] - x, p[1] - y) < r * 3)) continue
          if (actorLabels.some(b => x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h)) continue
          ax = x; ay = y; break
        }
        // A short fading wake follows the contributor's actual approach.
        if (!reduceMotion && st.travel < 1 && actorPositions.length < 12) {
          let origin = st.fromPos
          if (!origin) {
            const dx = st.target[0] - graph.center[0], dy = st.target[1] - graph.center[1]
            const length = Math.hypot(dx, dy) || 1, reach = Math.max(graph.width, graph.height) * 0.45 + 60
            origin = [st.target[0] + dx / length * reach, st.target[1] + dy / length * reach]
          }
          ctx.save(); ctx.globalCompositeOperation = 'lighter'
          let last = [ax, ay]
          for (let j = 1; j <= 10; j++) {
            const t = Math.max(0, st.travel - j * 0.035), e = st.fromPos ? easeInOut(t) : easeOutCubic(t)
            const [x, y] = project([lerp(origin[0], st.target[0], e), lerp(origin[1], st.target[1], e)])
            const next = [x + ax - ox, y + ay - oy]
            ctx.strokeStyle = rgba(a.col, alpha * (1 - j / 11) * 0.6); ctx.lineWidth = (1 - j / 11) * r * 0.65
            ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...next); ctx.stroke(); last = next
          }
          ctx.restore()
        }
        actorPositions.push([ax, ay])
        const geom = commitGeometry(st.visit.index)
        const p = 1 - st.acting
        if (st.acting > 0 && st.travel >= 1 && geom.targets.length) {
          const spike = c.files.length >= spikeThreshold
          // beams: heads fly out over the first 45% of the act, then the beams fade
          const reach = Math.min(1, p / 0.45)
          const fade = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55
          ctx.lineWidth = 1
          for (const [targetIndex, n] of geom.targets.slice(0, 32).entries()) {
            const [tx, ty] = nodePos(n)
            if (!reduceMotion) {
              if (energyBudget-- <= 0) continue
              drawEnergyBeam(ctx, [ax, ay], [tx, ty], a.col, p, alpha * (spike ? 0.55 : 0.85), targetIndex)
              continue
            }
            const hx = lerp(ax, tx, reach), hy = lerp(ay, ty, reach)
            ctx.strokeStyle = rgba(a.col, alpha * fade * (spike ? 0.2 : 0.4))
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke()
            ctx.fillStyle = rgba(a.col, alpha * fade * 0.9)
            ctx.beginPath(); ctx.arc(hx, hy, reach < 1 ? 2 : 2.5 + (1 - fade) * 4, 0, Math.PI * 2); ctx.fill()
          }
        }
        // avatar
        ctx.globalAlpha = alpha
        ctx.fillStyle = rgba(a.col, 0.22 + st.acting * 0.18)
        ctx.beginPath(); ctx.arc(ax, ay, r * (2 + st.acting * 0.6), 0, Math.PI * 2); ctx.fill()
        const img = privacy === 'all' ? null : avatarImgs.get(a.name)
        ctx.save()
        ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
        if (img) ctx.drawImage(img, ax - r, ay - r, r * 2, r * 2)
        else {
          ctx.fillStyle = rgba(a.col, 1); ctx.fillRect(ax - r, ay - r, r * 2, r * 2)
          ctx.fillStyle = rgba(C.bubbleBg, 0.95); ctx.textAlign = 'center'
          ctx.font = `700 ${Math.round(r * 0.85)}px "Space Grotesk", sans-serif`
          ctx.fillText(initials(displayName(a.name)), ax, ay + r * 0.06)
        }
        ctx.restore()
        ctx.strokeStyle = rgba(a.col, 1); ctx.lineWidth = 1.5 * ui
        ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke()
        // name pill, flipped to the left near the right edge
        ctx.font = `600 ${12 * ui}px "Space Grotesk", sans-serif`
        let shown = displayName(a.name)
        const maxName = (isMobile ? 110 : 180) * ui
        if (ctx.measureText(shown).width > maxName) {
          while (shown.length > 1 && ctx.measureText(shown + '…').width > maxName) shown = shown.slice(0, -1)
          shown += '…'
        }
        const nameW = ctx.measureText(shown).width
        const extra = st.acting > 0 && c.files.length >= 5 ? `+${c.files.length}` : ''
        ctx.font = `500 ${10 * ui}px "JetBrains Mono", monospace`
        const extraW = extra ? ctx.measureText(extra).width + 8 * ui : 0
        const pw = nameW + extraW + 18 * ui, ph = 22 * ui
        const choices = [
          { x: ax + r + 6 * ui, y: ay - ph / 2, w: pw, h: ph },
          { x: ax - r - 6 * ui - pw, y: ay - ph / 2, w: pw, h: ph },
          { x: ax - pw / 2, y: ay + r + 7 * ui, w: pw, h: ph },
          { x: ax - pw / 2, y: ay - r - 7 * ui - ph, w: pw, h: ph },
        ]
        const pill = choices.find(b => b.x >= 6 && b.y >= 6 && b.x + b.w <= width - 6 && b.y + b.h <= height - 6 && ![...labels, ...actorLabels].some(o => b.x < o.x + o.w + 3 && b.x + b.w + 3 > o.x && b.y < o.y + o.h + 3 && b.y + b.h + 3 > o.y) && !actorPositions.slice(0, -1).some(([x, y]) => x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h))
        if (!pill) { ctx.globalAlpha = 1; continue }
        actorLabels.push(pill)
        const px = pill.x, py = pill.y + ph / 2
        ctx.fillStyle = rgba(C.bubbleBg, 0.86)
        roundRect(px, py - ph / 2, pw, ph, ph / 2); ctx.fill()
        ctx.strokeStyle = rgba(a.col, 0.5); ctx.lineWidth = 1
        roundRect(px, py - ph / 2, pw, ph, ph / 2); ctx.stroke()
        ctx.textAlign = 'left'
        ctx.fillStyle = 'rgba(235,240,248,0.96)'
        ctx.font = `600 ${12 * ui}px "Space Grotesk", sans-serif`
        ctx.fillText(shown, px + 9 * ui, py + 1)
        if (extra) { ctx.fillStyle = rgba(a.col, 1); ctx.font = `500 ${10 * ui}px "JetBrains Mono", monospace`; ctx.fillText(extra, px + 9 * ui + nameW + 8 * ui, py + 1) }
        ctx.globalAlpha = 1
      }
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'
    }
    // Bloom the graph before the HUD is drawn, so cards and labels stay crisp.
    if (!reduceMotion) bloom(ctx, canvas, 1)
    lastHovered = dragging ? null : hovered
    drawCards()
    drawDate()
    if (hovered && !dragging) {
      ctx.font = '12px "JetBrains Mono", monospace'
      const text = hidePaths() ? describeHidden(hovered, hovered.type === 'dir' && aliveFiles(hovered) ? aliveFiles(hovered) : null) : hovered.path + (collapsed.has(hovered) ? ` · ${aliveFiles(hovered)} files` : '')
      const boxWidth = Math.min(width - 16, ctx.measureText(text).width + 24)
      const x = Math.max(8, Math.min(width - boxWidth - 8, pointer.x + 14))
      const y = Math.max(8, Math.min(height - 40, pointer.y + 16))
      ctx.fillStyle = rgba(C.bubbleBg, 0.96)
      roundRect(x, y, boxWidth, 30, 6); ctx.fill()
      ctx.fillStyle = 'rgb(235,240,248)'
      ctx.textAlign = 'left'
      ctx.fillText(text, x + 12, y + 20, boxWidth - 24)
    }
    ctx.textAlign = 'center'
  }

  function frame(now) {
    let dt = (now - lastFrame) / 1000
    lastFrame = now
    dt = Math.max(0, Math.min(0.1, dt))
    doResize() // pick up any size changes from React
    if (playing) {
      curTs += dt * histPerSec * speed * (autoPace ? pacing.paceAt(curTs) : 1)
      if (curTs >= to) { curTs = to; playing = false }
    }
    draw(dt)
    if (onTick) onTick(curTs, playing)
    raf = requestAnimationFrame(frame)
  }
  if (!options.manual) raf = requestAnimationFrame(frame)

  return {
    doResize,
    renderAt(t, settleSeconds = 0, presentationSeconds = null) {
      const next = Math.max(from, Math.min(to, t))
      const frameNow = performance.now() / 1000
      const clock = presentationSeconds ?? (autoPace ? pacing.elapsed(next) : (next - from) / histPerSec) + settleSeconds
      const delta = lastCameraSeconds == null ? 0 : clock - lastCameraSeconds
      // Normal video frames use their exact output timestamps, including holds.
      // Scrubbing and paused previews can settle without snapping to a new pose.
      const dtWall = lastManualFrame == null ? 0 : Math.max(0, Math.min(0.1, delta > 0 && delta <= 0.25 ? delta : frameNow - lastManualFrame))
      const advanceOrbit = delta > 0 && delta <= 0.25
      lastCameraSeconds = clock; lastManualFrame = frameNow
      curTs = next
      animationTs = curTs + settleSeconds * histPerSec
      doResize()
      draw(dtWall, advanceOrbit)
      animationTs = null
    },
    // debug/test hook: on-screen positions of visible folders
    camera() { return { scale: cam.scale, full: view?.full, zoom, cx: cam.cx, cy: cam.cy, userCamera, flyover, angle: orbit.value, tilt: tilt.value, renderedZoom: Math.exp(zoomMotion.value), panX: panMotionX.value, panY: panMotionY.value, graph: { w: graph.width, h: graph.height }, canvas: { width, height } } },
    probe() { return visible.filter(n => n.type === 'dir' && vstate(n).a > 0.5).map(n => { const [x, y] = nodePos(n); return { path: n.path, x, y, collapsed: lastCollapsed.has(n) } }) },
    resetView,
    authorColor(name) { return authorColor[name] || C.dir },
    avatar(name) { return privacy === 'all' ? null : (avatarImgs.get(name) || null) },
    displayName,
    get privacy() { return privacy },
    get clock() { return showClock },
    setClock(v) { showClock = !!v },
    setPrivacy(v) { privacy = normalizePrivacy(v) },
    get labelCount() { return lastLabelCount },
    avatarsReady(ms = 4000) { return avatarsSettled(ms) },
    get flyover() { return flyover },
    get autoPace() { return autoPace },
    setAutoPace(v) { autoPace = !!v },
    // playback progress 0..1 → history time (paced when auto-pace is on)
    warp(u) { return autoPace ? pacing.warp(u) : from + span * Math.max(0, Math.min(1, u)) },
    elapsed(ts) { return autoPace ? pacing.elapsed(ts) : Math.max(0, (ts - from) / histPerSec) },
    get playbackSeconds() { return autoPace ? pacing.playbackSeconds : span / histPerSec },
    setFlyover(v) { flyover = !!v && !reduceMotion },
    zoomBy(factor) { zoom = Math.max(0.4, Math.min(8, zoom * factor)); userCamera = true },
    set onTick(fn) { onTick = fn },
    play() { if (curTs >= to) { curTs = from; vis.clear() } playing = true },
    pause() { playing = false },
    toggle() { if (playing) this.pause(); else this.play() },
    get playing() { return playing },
    get time() { return curTs },
    get from() { return from },
    get to() { return to },
    seek(t) {
      const newTs = Math.max(from, Math.min(to, t))
      if (newTs <= from + span * 0.01) vis.clear() // clear when seeking near the start
      // A jump lands on a differently-arranged tree, not just a different set of
      // files: the layout moves as history plays. Gliding the camera across that
      // takes seconds and leaves the tree off frame meanwhile, so cut to the new
      // pose. Dragging the scrubber stays under this and still glides.
      if (Math.abs(newTs - curTs) > span * 0.02) cam.snap = true
      curTs = newTs
    },
    setSpeed(s) { speed = s },
    getSpeed() { return speed },
    destroy() {
      cancelAnimationFrame(raf)
      if (canvas.parentElement) ro.disconnect()
      window.removeEventListener('resize', doResize)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('dblclick', resetView)
    },
  }
}
