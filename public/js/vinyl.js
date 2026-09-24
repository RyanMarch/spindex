// vinyl.js - turn a Discogs pressing description ("Red Marbled", "Clear", "Blue / Yellow Split", "Picture Disc")
// into the look of the record. Discogs stores the colour as free text, so this understands the common colours and
// finishes and falls back to plain black for anything it doesn't recognise.

const COLORS = {
  black: [11, 11, 13],
  white: [236, 236, 230],
  red: [178, 30, 40],
  blue: [40, 92, 198],
  green: [44, 140, 78],
  yellow: [226, 196, 48],
  orange: [224, 122, 32],
  pink: [232, 138, 180],
  purple: [104, 62, 158],
  violet: [120, 78, 176],
  lilac: [184, 156, 216],
  lavender: [190, 170, 224],
  grey: [140, 140, 148],
  gray: [140, 140, 148],
  silver: [178, 180, 188],
  gold: [200, 160, 40],
  brown: [104, 66, 40],
  tan: [200, 170, 130],
  cream: [238, 226, 196],
  bone: [232, 222, 200],
  beige: [222, 208, 180],
  magenta: [200, 40, 140],
  cyan: [40, 190, 210],
  aqua: [60, 200, 200],
  teal: [30, 130, 130],
  turquoise: [48, 190, 180],
  mint: [156, 216, 190],
  olive: [110, 116, 44],
  maroon: [110, 24, 36],
  burgundy: [110, 24, 44],
  navy: [24, 40, 96],
  smoke: [76, 78, 86],
  copper: [184, 115, 51],
  bronze: [140, 100, 50],
};

// "light blue", "baby blue", "dark green"...: shift the base colour toward white or black
const MODIFIERS = { light: 0.38, pale: 0.5, baby: 0.5, sky: 0.45, bright: 0.12, neon: 0.14, hot: 0.05, dark: -0.4, deep: -0.32, dirty: -0.18 };

const mix = (rgb, amount) => rgb.map((v) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)));
const rgba = (rgb, alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
const flat = (rgb, alpha = 1) => `linear-gradient(${rgba(rgb, alpha)}, ${rgba(rgb, alpha)})`;

const COLOR_WORDS = Object.keys(COLORS).join('|');
const COLOR_PATTERN = new RegExp(`\\b(?:(${Object.keys(MODIFIERS).join('|')})\\s+)?(${COLOR_WORDS})\\b`, 'g');

const GLASS = [226, 232, 238]; // "clear" vinyl: colourless, see-through
const COKE_BOTTLE = [150, 190, 170]; // "coke bottle clear": a greenish tint

// formats: the Discogs `formats` array, e.g. [{ name: 'Vinyl', descriptions: ['LP', 'Album'], text: 'Red Marbled' }]
export function parseVinyl(formats = []) {
  const vinyl = (formats || []).find((f) => /vinyl|^lp$|^12"|^10"|^7"/i.test(f?.name || '')) || (formats || [])[0];
  const text = [vinyl?.text, ...(vinyl?.descriptions || [])].filter(Boolean).join(' ').toLowerCase();

  // Discogs users add the exact shade in brackets: "Blue [Light Blue]". A bracketed colour replaces the one before it.
  const bracketRanges = [...text.matchAll(/\[[^\]]*\]/g)].map((m) => [m.index, m.index + m[0].length]);
  const colors = [];
  for (const m of text.matchAll(COLOR_PATTERN)) {
    const base = COLORS[m[2]];
    const rgb = m[1] ? mix(base, MODIFIERS[m[1]]) : base;
    const inBracket = bracketRanges.some(([a, b]) => m.index >= a && m.index < b);
    if (inBracket && colors.length > 0) colors[colors.length - 1] = rgb;
    else colors.push(rgb);
  }

  const has = (re) => re.test(text);
  let kind = 'solid';
  if (has(/picture\s*disc|pic\s*disc|\bpicture\b/)) kind = 'picture';
  else if (has(/marbl?e?d?|marbeled/)) kind = 'marble';
  else if (has(/splatter|speckle/)) kind = 'splatter';
  else if (colors.length > 1 && has(/\bsplit\b|tri[- ]?colou?r|half\s*(?:&|and|\/|-)\s*half/)) kind = 'split'; // not "Half-Speed Mastered"
  else if (has(/swirl|galaxy|haze|nebula|tie[- ]?dye/)) kind = 'swirl';
  else if (has(/translucent|transparent|\bclear\b|see[- ]through/) && !has(/opaque/)) kind = 'translucent';
  else if (colors.length > 1) kind = 'swirl'; // several colours, no finish named

  // Nothing recognisable (or plain "Black"): a standard black record
  if (kind === 'solid' && colors.length === 0) return { kind: 'black', colors: [COLORS.black], text };
  if (colors.length === 0) {
    const tint = has(/coke\s*bottle/) ? COKE_BOTTLE : GLASS;
    return { kind: kind === 'translucent' || kind === 'solid' ? 'translucent' : kind, colors: [tint], text, clear: true };
  }
  // A lone "Black" is just a standard record
  if (kind === 'solid' && colors.length === 1 && colors[0] === COLORS.black) return { kind: 'black', colors: [COLORS.black], text };
  return { kind, colors, text };
}

// CSS background layers for the disc (later layers sit underneath). `art` is used for picture discs.
export function vinylFill(v, art = '') {
  const c1 = v.colors[0];
  // "Magenta Swirl" names one colour: pair it with a lighter (or, if already light, darker) tone of itself
  const luminance = 0.3 * c1[0] + 0.59 * c1[1] + 0.11 * c1[2];
  const c2 = v.colors[1] || (v.kind === 'solid' || v.kind === 'black' || v.kind === 'translucent' ? c1 : mix(c1, luminance < 140 ? 0.4 : -0.35));

  switch (v.kind) {
    case 'black':
    case 'solid':
      return flat(c1);

    case 'translucent':
      return flat(c1, v.clear ? 0.5 : 0.8);

    case 'marble':
      return [
        `radial-gradient(ellipse 55% 40% at 28% 30%, ${rgba(c2, 0.95)} 0%, ${rgba(c2, 0.95)} 38%, rgba(0, 0, 0, 0) 72%)`,
        `radial-gradient(ellipse 50% 45% at 72% 68%, ${rgba(c2, 0.85)} 0%, ${rgba(c2, 0.85)} 34%, rgba(0, 0, 0, 0) 70%)`,
        `radial-gradient(ellipse 34% 28% at 62% 22%, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 70%)`,
        flat(c1),
      ].join(', ');

    case 'splatter': {
      // Fixed positions, so the same record always looks the same
      const dots = [[22, 30, 3.2], [68, 18, 2.4], [80, 52, 3.8], [40, 74, 2.8], [58, 88, 2.2], [14, 62, 2.6], [50, 46, 3], [86, 80, 2], [30, 12, 1.8], [72, 66, 2.6]];
      return [...dots.map(([x, y, r]) => `radial-gradient(circle at ${x}% ${y}%, ${rgba(c2)} 0%, ${rgba(c2)} ${r}%, rgba(0, 0, 0, 0) ${r + 0.6}%)`), flat(c1)].join(', ');
    }

    case 'split': {
      // Two colours make halves, three make thirds... The seams start at about 2 o'clock so they show on the crescent
      // that peeks out of the sleeve
      const parts = v.colors.length > 1 ? v.colors : [c1, c2];
      const step = 360 / parts.length;
      const stops = parts.map((c, i) => `${rgba(c)} ${i * step}deg, ${rgba(c)} ${(i + 1) * step}deg`);
      return `conic-gradient(from 55deg, ${stops.join(', ')})`;
    }

    case 'swirl':
      return [
        'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 55%)',
        `conic-gradient(from 50deg, ${rgba(c1)}, ${rgba(c2)} 22%, ${rgba(c1)} 42%, ${rgba(c2)} 62%, ${rgba(c1)} 82%, ${rgba(c2)})`,
      ].join(', ');

    case 'picture':
      return art
        ? `linear-gradient(rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.12)), url("${String(art).replace(/"/g, '%22')}") center / cover no-repeat`
        : flat(COLORS.black);

    default:
      return flat(COLORS.black);
  }
}
