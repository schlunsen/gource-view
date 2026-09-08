import * as git from 'isomorphic-git'
import { diffLines } from 'diff'

import { browserLimit } from './options.js'

// Bound expensive text diffs while preserving the file's activity in the graph.
export function lineChanges(before = new Uint8Array(), after = new Uint8Array()) {
  if (before.subarray(0, 8000).includes(0) || after.subarray(0, 8000).includes(0)) return { a: 0, d: 0 }
  if (before.length > 1024 * 1024 || after.length > 1024 * 1024) return { a: 0, d: 0, countsOmitted: true }
  const decode = new TextDecoder()
  const diff = diffLines(decode.decode(before), decode.decode(after), { timeout: 100, maxEditLength: 20000 })
  if (!diff) return { a: 0, d: 0, countsOmitted: true }
  return diff.reduce((n, part) => ({ a: n.a + (part.added ? part.count : 0), d: n.d + (part.removed ? part.count : 0) }), { a: 0, d: 0 })
}

export async function collectBrowserCommits({ fs, dir, ref = 'HEAD', maxCommits = 3000, blobs = true, onProgress = () => {} }) {
  const limit = browserLimit(maxCommits), cache = {}
  const options = { fs, dir, cache }
  const history = await git.log({ ...options, ref, depth: limit + 1 })
  const commits = []
  let countsOmitted = 0, shallow = false, changes = 0
  // Sequential tree traversal bounds transient blob memory. Equal subtrees are pruned.
  async function compare(oldOid, newOid, prefix = '') {
    if (oldOid === newOid) return []
    const oldTree = oldOid ? (await git.readTree({ ...options, oid: oldOid })).tree : []
    const newTree = newOid ? (await git.readTree({ ...options, oid: newOid })).tree : []
    const oldEntries = new Map(oldTree.map(e => [e.path, e]))
    const newEntries = new Map(newTree.map(e => [e.path, e]))
    const files = []
    for (const name of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
      if (name === 'node_modules' || name === '.git') continue
      const before = oldEntries.get(name), after = newEntries.get(name), p = prefix + name
      if (before?.oid === after?.oid && before?.mode === after?.mode) continue
      if (before?.type === 'tree' || after?.type === 'tree') {
        files.push(...await compare(before?.type === 'tree' ? before.oid : undefined, after?.type === 'tree' ? after.oid : undefined, p + '/'))
      }
      const oldBlob = before?.type === 'blob', newBlob = after?.type === 'blob'
      if (!oldBlob && !newBlob) continue
      if (++changes > 250000) throw new Error('This history changes too many files for browser playback. Try fewer commits.')
      let counts = { a: 0, d: 0 }
      if (blobs) {
        const a = oldBlob ? (await git.readBlob({ ...options, oid: before.oid })).blob : undefined
        const b = newBlob ? (await git.readBlob({ ...options, oid: after.oid })).blob : undefined
        counts = lineChanges(a, b)
        if (counts.countsOmitted) countsOmitted++
      }
      files.push({ p, a: counts.a, d: counts.d, ...(!newBlob ? { s: 'D' } : {}) })
    }
    return files
  }
  for (let i = 0; i < Math.min(history.length, limit); i++) {
    const { oid: hash, commit } = history[i]
    onProgress({ pct: 65 + i / Math.min(history.length, limit) * 30, detail: `Reading changes · ${i + 1} / ${Math.min(history.length, limit)} commits` })
    if (commit.parent.length > 1) continue // same semantics as git log --no-merges
    let parent
    if (commit.parent[0]) {
      try { parent = (await git.readCommit({ ...options, oid: commit.parent[0] })).commit.tree }
      catch (e) { if (e.code !== 'NotFoundError') throw e; shallow = true; continue }
    }
    const files = await compare(parent, commit.tree)
    if (files.length) commits.push({ hash, ts: commit.committer?.timestamp ?? commit.author.timestamp, name: commit.author.name, email: commit.author.email, subject: commit.message.split('\n')[0], files })
  }
  commits.sort((a, b) => a.ts - b.ts)
  return { commits, countsOmitted, linesUnavailable: !blobs, hasMore: shallow || history.length > limit }
}
