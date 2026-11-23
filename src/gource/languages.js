// Which language a file is written in. The renderer colours files by it and
// the legend counts them, so a migration shows up as the picture changing hue.
//
// Only languages with a hue of their own are named; any other source file is
// `code`, and the two non-source groups keep the names the palette always had.
const GROUPS = [
  ['ts', 'TypeScript', 'ts tsx mts cts'],
  ['js', 'JavaScript', 'js jsx mjs cjs vue svelte'],
  ['py', 'Python', 'py pyi pyx ipynb'],
  ['go', 'Go', 'go'],
  ['rust', 'Rust', 'rs'],
  ['c', 'C / C++', 'c h cc cpp cxx hpp hh m mm'],
  ['jvm', 'Java / Kotlin', 'java kt kts scala groovy'],
  ['ruby', 'Ruby', 'rb erb rake gemspec'],
  ['php', 'PHP', 'php'],
  ['shell', 'Shell', 'sh bash zsh fish ps1'],
  ['style', 'Styles', 'css scss sass less styl'],
  ['data', 'Docs & data', 'html htm xml md markdown mdx rst txt json yml yaml toml csv sql ini lock'],
  ['image', 'Assets', 'png jpg jpeg gif svg webp ico bmp pdf woff woff2 ttf otf eot mp3 mp4'],
]

const byExtension = new Map()
for (const [key, , extensions] of GROUPS) for (const ext of extensions.split(' ')) byExtension.set(ext, key)

export const LANGUAGE_LABELS = { ...Object.fromEntries(GROUPS.map(([key, label]) => [key, label])), code: 'Other source' }

/** Language key for a path; `code` for source the table does not name. */
export function languageOf(path) {
  const name = String(path).split('/').pop()
  const dot = name.lastIndexOf('.')
  return byExtension.get(dot >= 0 ? name.slice(dot + 1).toLowerCase() : '') || 'code'
}

/**
 * Legend rows for a count of files per language, largest first.
 * `colors` maps a language key to its [r, g, b].
 */
export function languageRows(counts, colors) {
  const rows = [...counts].filter(([, files]) => files > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const total = rows.reduce((sum, [, files]) => sum + files, 0)
  return rows.map(([key, files]) => ({ key, label: LANGUAGE_LABELS[key] || key, color: colors[key], files, share: files / total }))
}
