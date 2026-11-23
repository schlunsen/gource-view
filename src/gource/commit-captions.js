// Commit captions: what the commit on screen actually said.
//
// One caption is up at a time and each holds long enough to read, so in a busy
// stretch most commits go uncaptioned. The schedule is a pure function of the
// history, like the contributor cards, so seeking and video export show the
// same caption at the same moment.

const clean = subject => String(subject || '').replace(/\s+/g, ' ').trim()

/**
 * Build the caption schedule for a commit list (sorted by ts).
 * When several commits land together, the one touching the most files speaks:
 * it is the one the picture is reacting to.
 */
export function buildCaptions(commits, { histPerSec, lifeSeconds = 3.4, gapSeconds = 0.3 }) {
  const life = histPerSec * lifeSeconds, gap = histPerSec * gapSeconds
  const captions = []
  let free = -Infinity
  for (let i = 0; i < commits.length; i++) {
    if (commits[i].ts < free || !clean(commits[i].subject)) continue
    let best = i
    for (let j = i + 1; j < commits.length && commits[j].ts <= commits[i].ts + life / 3; j++) {
      if (clean(commits[j].subject) && commits[j].files.length > commits[best].files.length) best = j
    }
    const c = commits[best]
    let added = 0, removed = 0
    for (const f of c.files) { added += f.a || 0; removed += f.d || 0 }
    captions.push({ showTs: c.ts, life, index: best, subject: clean(c.subject), name: c.name, hash: String(c.hash || '').slice(0, 7), files: c.files.length, added, removed })
    free = c.ts + life + gap
  }
  return captions
}

/** The caption on screen at t, or null. */
export function captionAt(captions, t) {
  let lo = 0, hi = captions.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (captions[mid].showTs <= t) lo = mid + 1; else hi = mid }
  const c = captions[lo - 1]
  return c && t - c.showTs <= c.life ? c : null
}

/** Break text into at most `maxLines` lines that fit `maxWidth`, ending in an ellipsis when cut. */
export function wrapLines(text, maxWidth, measure, maxLines = 2) {
  const fit = s => {
    if (measure(s) <= maxWidth) return s
    while (s.length > 1 && measure(s + '…') > maxWidth) s = s.slice(0, -1)
    return s.trimEnd() + '…'
  }
  const lines = []
  let line = ''
  const words = text.split(' ')
  for (let i = 0; i < words.length; i++) {
    const next = line ? line + ' ' + words[i] : words[i]
    if (measure(next) <= maxWidth) { line = next; continue }
    if (lines.length === maxLines - 1) return [...lines, fit(line ? line + ' ' + words.slice(i).join(' ') : words.slice(i).join(' '))]
    // a single word wider than the line is cut rather than left to overflow
    if (!line) { lines.push(fit(words[i])); continue }
    lines.push(line); line = ''; i--
  }
  if (line) lines.push(line)
  return lines
}
