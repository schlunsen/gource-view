// Privacy levels for publishing closed-source history:
//   off    everything as-is
//   paths  file and folder names hidden (structure, colours and activity stay)
//   all    paths hidden and contributors shown as "Contributor N"
export const PRIVACY_LEVELS = ['off', 'paths', 'all']
export const PRIVACY_LABELS = { off: 'Privacy off', paths: 'Names hidden', all: 'Names + people hidden' }

export function normalizePrivacy(v) { return PRIVACY_LEVELS.includes(v) ? v : 'off' }
export function nextPrivacy(v) { return PRIVACY_LEVELS[(PRIVACY_LEVELS.indexOf(normalizePrivacy(v)) + 1) % PRIVACY_LEVELS.length] }

/** Stable pseudonyms in order of first appearance. */
export function buildPseudonyms(commits) {
  const map = new Map()
  for (const c of commits) if (!map.has(c.name)) map.set(c.name, `Contributor ${map.size + 1}`)
  return map
}

/** What a hovered node may reveal when paths are hidden. */
export function describeHidden(node, fileCount) {
  const depth = node.path ? node.path.split('/').length : 0
  return node.type === 'dir' ? `folder · depth ${depth}${fileCount != null ? ` · ${fileCount} files` : ''}` : `file · depth ${depth}`
}
