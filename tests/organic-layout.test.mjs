import test from 'node:test'
import assert from 'node:assert/strict'
import { organicLayout } from '../src/gource/organic-layout.js'

function fixture(folderCount, filesPerFolder) {
  const root = { path: '', type: 'dir', children: new Map() }
  const visible = []
  for (let i = 0; i < folderCount; i++) {
    const parent = i && i % 3 === 0 ? visible.find(n => n.path === `folder${i - 1}`) : root
    const dir = { path: `folder${i}`, type: 'dir', parent, children: new Map() }
    parent.children.set(dir.path, dir); visible.push(dir)
    for (let j = 0; j < filesPerFolder; j++) {
      const file = { path: `${dir.path}/file${j}`, type: 'file', parent: dir }
      dir.children.set(file.path, file); visible.push(file)
    }
  }
  return { root, visible }
}
test('layout covers every node and remains deterministic across seeks/reloads', () => {
  const { root, visible } = fixture(18, 30)
  const first = organicLayout(root, visible), second = organicLayout(root, visible)
  assert.deepEqual(first, second)
  assert.equal(first.positions.size, visible.length + 1)
  for (const p of first.positions.values()) assert.ok(p.every(Number.isFinite))
  assert.ok(first.width > 0 && first.height > 0)
  const radii = visible.filter(n => n.type === 'dir').map(n => Math.hypot(...first.positions.get(n)))
  assert.ok(Math.max(...radii) - Math.min(...radii) > 50, 'folders should not sit on one ring')
})
test('empty and root-only file histories have usable bounds', () => {
  const { root } = fixture(0, 0)
  assert.ok(organicLayout(root, []).width > 0)
  const file = { path: 'README.md', type: 'file', parent: root }
  root.children.set(file.path, file)
  assert.ok(organicLayout(root, [file]).positions.has(file))
})
test('pruned files do not occupy layout space', () => {
  const { root, visible } = fixture(3, 10)
  const kept = visible.filter(n => n.type === 'dir' || n.path.endsWith('file0'))
  assert.equal(organicLayout(root, kept).positions.size, kept.length + 1)
})
test('folders branch away from their grandparent and files stay inside their folder ring', () => {
  const { root, visible } = fixture(18, 30)
  const { positions, radii } = organicLayout(root, visible)
  let outward = 0, nested = 0
  for (const n of visible) {
    if (n.type !== 'dir' || n.parent === root) continue
    nested++
    const [x, y] = positions.get(n), [px, py] = positions.get(n.parent), [gx, gy] = positions.get(n.parent.parent)
    if ((x - px) * (px - gx) + (y - py) * (py - gy) > 0) outward++
  }
  assert.ok(nested > 0 && outward / nested >= 0.7, `${outward}/${nested} nested folders point outward`)
  for (const n of visible) {
    if (n.type !== 'file') continue
    const [x, y] = positions.get(n), [px, py] = positions.get(n.parent)
    assert.ok(Math.hypot(x - px, y - py) <= radii.get(n.parent) + 1)
  }
})
test('folder circles do not overlap once settled', () => {
  const { root, visible } = fixture(24, 12)
  const { positions } = organicLayout(root, visible)
  const dirs = visible.filter(n => n.type === 'dir')
  let overlaps = 0
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    const [ax, ay] = positions.get(dirs[i]), [bx, by] = positions.get(dirs[j])
    if (Math.hypot(ax - bx, ay - by) < 20) overlaps++
  }
  assert.equal(overlaps, 0)
})

test('dense file clusters have breathing room without escaping their folder', () => {
  const { root, visible } = fixture(1, 100)
  const { positions } = organicLayout(root, visible)
  const files = visible.filter(n => n.type === 'file')
  let closest = Infinity
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
    const [ax, ay] = positions.get(files[i]), [bx, by] = positions.get(files[j])
    closest = Math.min(closest, Math.hypot(ax - bx, ay - by))
  }
  assert.ok(closest > 5, `file centers are only ${closest} units apart`)
})

/** Does segment ab properly cross segment cd? (shared endpoints do not count) */
function crosses(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]))
  const [o1, o2, o3, o4] = [side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b)]
  return o1 !== o2 && o3 !== o4 && !!o1 && !!o2 && !!o3 && !!o4
}
/** A repo shaped like a real one: a few deep branches, a couple of wide ones. */
function repoShape() {
  const root = { path: '', type: 'dir', children: new Map(), parent: null }
  const visible = []
  const add = p => {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/')
      let ch = node.children.get(path)
      if (!ch) {
        ch = { path, type: i === parts.length - 1 && p.includes('.') ? 'file' : 'dir', children: new Map(), parent: node }
        if (ch.type === 'file') ch.children = null
        node.children.set(path, ch); visible.push(ch)
      }
      node = ch
    }
  }
  for (let i = 0; i < 22; i++) add(`src/client/features/f${i}/components/view${i}.tsx`)
  for (let i = 0; i < 16; i++) add(`src/server/features/s${i}/services/svc${i}.ts`)
  for (let i = 0; i < 14; i++) add(`.agents/skills/skill${i}/SKILL.md`)
  for (let i = 0; i < 40; i++) add(`drizzle/meta/snap${i}.json`)
  for (let i = 0; i < 8; i++) add(`web/src/routes/_marketing/library/topic${i}/page.tsx`)
  for (const p of ['docs/a.md', 'public/logo.svg', 'scripts/seed.ts', 'self-host/compose.yml']) add(p)
  return { root, visible }
}
/** A shallower, bushier shape: the tangent-cone rule bites here, not in repoShape. */
function bushyShape() {
  const root = { path: '', type: 'dir', children: new Map(), parent: null }
  const visible = []
  const add = p => {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/')
      let ch = node.children.get(path)
      if (!ch) {
        ch = { path, type: i === parts.length - 1 && p.includes('.') ? 'file' : 'dir', children: new Map(), parent: node }
        if (ch.type === 'file') ch.children = null
        node.children.set(path, ch); visible.push(ch)
      }
      node = ch
    }
  }
  for (const d of ['client/hooks', 'client/lib', 'components/ui', 'schemas', 'serverFunctions', 'types',
    'server/db', 'server/lib', 'server/middleware', 'lib', 'routes/api/auth', 'routes/api/billing']) {
    for (let i = 0; i < 5; i++) add(`src/${d}/f${i}.ts`)
  }
  for (const d of ['audit', 'backlinks', 'billing', 'domain', 'keywords', 'page', 'workflows']) {
    for (let i = 0; i < 4; i++) add(`src/features/${d}/components/c${i}.tsx`)
  }
  for (const p of ['.github/workflows/ci.yml', 'docs/a.md', 'drizzle/meta/s0.json', 'public/logo.svg',
    'scripts/seed.ts', 'self-host/compose.yml', '_marketing/src/routes/index.tsx', 'web/content/blog/p1.md']) add(p)
  return { root, visible }
}
test('no two folder edges cross, and no edge cuts through a foreign folder', () => {
  const { root, visible } = repoShape()
  const { positions, radii } = organicLayout(root, visible)
  const dirs = [root, ...visible.filter(n => n.type === 'dir')]
  const edges = dirs.filter(n => n.parent).map(n => [positions.get(n.parent), positions.get(n), n])
  let crossings = 0
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    if (crosses(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) crossings++
  }
  assert.equal(crossings, 0, `${crossings} of ${edges.length} branches cross`)
  let through = 0
  for (const [a, b, n] of edges) for (const m of dirs) {
    if (m === n || m === n.parent) continue
    const [cx, cy] = positions.get(m)
    const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((cx - a[0]) * dx + (cy - a[1]) * dy) / len))
    if (Math.hypot(a[0] + t * dx - cx, a[1] + t * dy - cy) < radii.get(m)) through++
  }
  assert.equal(through, 0, `${through} branches run through an unrelated folder's files`)
})
test('branches curve with the ring, so drawing them bent cannot make them cross', () => {
  const { root, visible } = repoShape()
  const { positions } = organicLayout(root, visible)
  const dirs = [root, ...visible.filter(n => n.type === 'dir')]
  // the control point the renderer uses: the chord's midpoint lifted back out
  // to the mean radius of the two ends
  const curve = n => {
    const [px, py] = positions.get(n.parent), [nx, ny] = positions.get(n)
    const mx = (px + nx) / 2, my = (py + ny) / 2
    const chord = Math.hypot(mx, my)
    const mean = (Math.hypot(px, py) + Math.hypot(nx, ny)) / 2
    const lift = chord > 1e-3 ? Math.min(1.6, mean / chord) : 1
    const cx = mx * lift, cy = my * lift
    const pts = []
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, q = 1 - t
      pts.push([q * q * px + 2 * q * t * cx + t * t * nx, q * q * py + 2 * q * t * cy + t * t * ny])
    }
    return pts
  }
  const paths = dirs.filter(n => n.parent).map(curve)
  let crossings = 0
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) {
      if (crosses(paths[i][a], paths[i][a + 1], paths[j][b], paths[j][b + 1])) { crossings++; a = b = 12 }
    }
  }
  assert.equal(crossings, 0, `${crossings} curved branches cross`)
})

test('a shallow, bushy tree stays crossing-free too', () => {
  // Wide fans close to the centre are what force a ring outwards to keep its
  // edges inside their tangent cone; without that push this shape crosses.
  const { root, visible } = bushyShape()
  const { positions } = organicLayout(root, visible)
  const dirs = [root, ...visible.filter(n => n.type === 'dir')]
  const edges = dirs.filter(n => n.parent).map(n => [positions.get(n.parent), positions.get(n)])
  let crossings = 0
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    if (crosses(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) crossings++
  }
  assert.equal(crossings, 0, `${crossings} of ${edges.length} branches cross`)
})
