// The two editions of the picture.
//
// Everything the renderer and the composition draw takes its colour from here,
// so a light version is a table rather than a search through five modules for
// hex literals. The file-type hues are not merely lightened between the two:
// orange and blue that glow against a dark field go muddy and low-contrast on
// paper, so the light edition uses deeper, less luminous versions of the same
// hues. The point is that a file reads as "code" in both, not that the numbers
// match.
export const PALETTES = {
  dark: {
    bgInner: '#182b3b', bgOuter: '#0a101b', card: '#0c101a', cardInk: '#0c101a',
    ink: '#e7edf6', inkSoft: '#a4b6cb', inkFaint: '#8193aa', rule: '#25384a',
    accent: '#64dedb',
    code: [255, 160, 58], data: [58, 190, 255], image: [140, 120, 255],
    dir: [140, 160, 190], edge: [100, 120, 150], bubbleBg: [12, 16, 26],
    accentRgb: [100, 222, 219],
    nebula: [[22, 104, 106], [36, 92, 148], [78, 46, 138]],
    haze: [170, 210, 240], hazeAlpha: 1, glowAlpha: 1,
    // The HUD drawn over the graph: labels, the clock, the milestone cards.
    hudInk: [235, 240, 248], hudSoft: [164, 182, 203], hudMuted: [129, 147, 170],
    hudLine: [115, 137, 162], hudFace: [26, 38, 54], hudFaceNight: [22, 30, 46],
    hudBright: [200, 215, 235], hudWhite: [255, 255, 255], hudWarn: [255, 110, 110],
    hudRim: [140, 120, 255],
    shadow: [0, 0, 0], shadowK: 1,
    scrim: [10, 16, 27], rowFace: [17, 27, 40], rowFaceA: 0.85, track: [115, 137, 162], trackA: 0.35,
  },
  light: {
    bgInner: '#fdf9f0', bgOuter: '#e9dfc9', card: '#fffaf0', cardInk: '#f7f0e2',
    ink: '#241f18', inkSoft: '#5d5446', inkFaint: '#8b8171', rule: '#d6c9b0',
    accent: '#0e6b63',
    code: [191, 102, 8], data: [21, 104, 173], image: [98, 68, 196],
    dir: [150, 137, 112], edge: [176, 164, 141], bubbleBg: [255, 250, 240],
    accentRgb: [14, 107, 99],
    // The nebula is a glow; on paper it has to become a wash instead, or it
    // reads as a smudge. Same hues, far weaker, and the additive bloom that
    // makes lights bloom against black is turned nearly off.
    nebula: [[214, 232, 226], [214, 226, 241], [230, 222, 244]],
    // Bloom is light added on top of the frame. Against black that is what makes
    // a node glow; against paper there is nothing above the ground colour to add,
    // so it only lifts the whole picture towards white and takes the contrast
    // with it. Off entirely here, rather than merely quiet.
    haze: [150, 138, 116], hazeAlpha: 0.42, glowAlpha: 0,
    // Ink and paper for the same furniture. The shadows come down hard: a
    // drop shadow tuned to read against black is a bruise on cream.
    hudInk: [36, 31, 24], hudSoft: [93, 84, 70], hudMuted: [125, 114, 95],
    hudLine: [120, 106, 84], hudFace: [255, 250, 240], hudFaceNight: [247, 240, 226],
    hudBright: [52, 45, 34], hudWhite: [26, 22, 16], hudWarn: [178, 44, 44],
    hudRim: [120, 96, 220],
    shadow: [92, 80, 60], shadowK: 0.42,
    scrim: [247, 240, 226], rowFace: [255, 250, 240], rowFaceA: 0.94, track: [36, 31, 24], trackA: 0.16,
  },
}

export function paletteFor(name) {
  return PALETTES[name === 'light' ? 'light' : 'dark']
}
