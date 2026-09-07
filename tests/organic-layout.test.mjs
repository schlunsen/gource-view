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
