// gource-style tree layout: recursive horizontal spacing + depth = y
export const COLORS = ['#4f8ef7', '#5eead4', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#fb7185', '#60a5fa', '#f97316', '#c084fc']

export function fileColor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  const map = {
    js: 0, mjs: 0, cjs: 0, jsx: 0, ts: 1, tsx: 1,
    py: 2, rb: 3, go: 4, rs: 5, java: 6, c: 7, h: 7, cpp: 7,
    html: 8, css: 8, scss: 8, less: 8,
    json: 1, md: 9, txt: 9, yml: 2, yaml: 2, toml: 2, sh: 6,
  }
  return map[ext]
}

export function buildTree(repo) {
  // node: {name, path, children: Map, firstTs, commits, type}
  const root = { name: '', path: '', children: new Map(), firstTs: Infinity, type: 'dir' }
  for (const c of repo.commits) {
    for (const f of c.files) {
      const parts = f.p.split('/').filter(Boolean)
      let node = root
      node.firstTs = Math.min(node.firstTs, c.ts)
      node.activity = (node.activity || 0) + f.a + f.d
      for (let i = 0; i < parts.length - 1; i++) {
        let child = node.children.get(parts[i])
        if (!child) {
          child = { name: parts[i], path: node.path ? node.path + '/' + parts[i] : parts[i], children: new Map(), firstTs: Infinity, type: 'dir' }
          node.children.set(parts[i], child)
        }
        child.firstTs = Math.min(child.firstTs, c.ts)
        child.activity = (child.activity || 0) + f.a + f.d
        node = child
      }
      const leafName = parts[parts.length - 1]
      let leaf = node.children.get(leafName)
      if (!leaf) {
        leaf = { name: leafName, path: f.p, children: null, firstTs: Infinity, type: 'file', color: fileColor(f.p) }
        node.children.set(leafName, leaf)
      }
      leaf.firstTs = Math.min(leaf.firstTs, c.ts)
      leaf.activity = (leaf.activity || 0) + f.a + f.d
    }
  }
  const nodes = [root]
  const walk = n => { for (const ch of n.children.values()) { nodes.push(ch); if (ch.children) walk(ch) } }
  walk(root)
  return { root, nodes }
}

// layout: assign x (in leaf units) and depth to every node
export function layout(root) {
  let leafCursor = 0
  const rec = (node, depth) => {
    node.depth = depth
    node.activeAt = node.firstTs
    if (!node.children || node.children.size === 0) {
      node.leafIndex = leafCursor
      node.x = leafCursor + 0.5
      leafCursor += 1
    } else {
      let min = Infinity, max = -Infinity
      for (const ch of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        rec(ch, depth + 1)
        min = Math.min(min, ch.x); max = Math.max(max, ch.x)
      }
      node.x = (min + max) / 2
    }
  }
  rec(root, 0)
  return leafCursor // total leaf units
}
