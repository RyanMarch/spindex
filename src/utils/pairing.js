// src/utils/pairing.js - Vinyl album to Speakeasy cocktail pairing engine
import CATALOG from '../data/speakeasy-catalog.json' with { type: 'json' };

export { CATALOG };

/**
 * Mapping of Discogs styles/genres to target flavor profile vectors and tone descriptors.
 * Axes: sweet, sour, bitter, boozy, herbal (0-100 scale).
 */
export const STYLE_DEFINITIONS = [
  {
    patterns: [
      /(?<!post[- ])hardcore\b/i,
      /skate punk/i,
      /\bthrash\b/i,
      /melodic hardcore/i,
      /fast post-punk/i,
      /speed metal/i,
      /power ?violence/i,
      /horror punk/i,
      /crust punk/i,
      /street punk/i,
      /d-beat/i,
    ],
    vector: { sweet: 45, sour: 70, bitter: 50, boozy: 52, herbal: 25 },
    descriptor: 'bitter-tart, kinetic',
    genreCategory: 'dark-fast',
    tempoEnergy: 'dark-fast',
  },
  {
    patterns: [
      /doom metal/i,
      /\bdoom\b/i,
      /darkwave/i,
      /goth rock/i,
      /gothic rock/i,
      /\bgoth\b/i,
      /sludge/i,
      /slowcore/i,
      /funeral doom/i,
      /drone metal/i,
      /post-metal/i,
    ],
    vector: { sweet: 28, sour: 5, bitter: 80, boozy: 88, herbal: 45 },
    descriptor: 'dark, spirit-forward',
    genreCategory: 'dark-slow',
    tempoEnergy: 'dark-slow',
  },
  {
    patterns: [/post-hardcore/i, /screamo/i, /metalcore/i, /emo\b/i],
    vector: { sweet: 35, sour: 35, bitter: 65, boozy: 72, herbal: 30 },
    descriptor: 'intense, bittersweet',
    genreCategory: 'post-hardcore',
    tempoEnergy: 'mid-tempo',
  },
  {
    patterns: [/^punk$/i, /punk rock/i, /garage punk/i, /oi!/i],
    vector: { sweet: 42, sour: 68, bitter: 50, boozy: 55, herbal: 25 },
    descriptor: 'punchy, bittersweet',
    genreCategory: 'punk',
    tempoEnergy: 'dark-fast',
  },
  {
    patterns: [/no wave/i, /post-punk/i, /garage rock/i, /noise rock/i, /grunge/i],
    vector: { sweet: 25, sour: 25, bitter: 70, boozy: 75, herbal: 35 },
    descriptor: 'raw, bittersweet',
    genreCategory: 'alt-punk',
    tempoEnergy: 'mid-tempo',
  },
  {
    patterns: [/classic rock/i, /rock & roll/i, /blues rock/i, /hard rock/i],
    vector: { sweet: 25, sour: 15, bitter: 45, boozy: 80, herbal: 35 },
    descriptor: 'spirit-forward, dry',
    genreCategory: 'classic-rock',
  },
  {
    patterns: [/pop rock/i, /soft rock/i],
    vector: { sweet: 45, sour: 35, bitter: 25, boozy: 60, herbal: 25 },
    descriptor: 'melodic, balanced',
    genreCategory: 'pop-rock',
  },
  {
    patterns: [/alt-rock/i, /alternative rock/i, /indie rock/i],
    vector: { sweet: 30, sour: 25, bitter: 55, boozy: 75, herbal: 35 },
    descriptor: 'sharp, spirit-forward',
    genreCategory: 'alt-rock',
  },
  {
    patterns: [/pop punk/i, /power pop/i],
    vector: { sweet: 40, sour: 35, bitter: 50, boozy: 65, herbal: 25 },
    descriptor: 'punchy, bittersweet',
    genreCategory: 'pop-punk',
  },
  {
    patterns: [/dance-pop/i, /synth-pop/i, /bubblegum/i, /teen pop/i, /^pop$/i, /electropop/i],
    vector: { sweet: 65, sour: 65, bitter: 10, boozy: 45, herbal: 15 },
    descriptor: 'bright, sparkling',
    genreCategory: 'pop',
  },
  {
    patterns: [/modal/i, /hard bop/i, /post-bop/i, /cool jazz/i, /bebop/i, /jazz/i, /swing/i, /big band/i],
    vector: { sweet: 15, sour: 5, bitter: 35, boozy: 85, herbal: 30 },
    descriptor: 'dry, spirit-forward',
    genreCategory: 'jazz',
  },
  {
    patterns: [/psychedelic/i, /prog/i, /art rock/i, /space rock/i, /krautrock/i, /math rock/i],
    vector: { sweet: 35, sour: 20, bitter: 45, boozy: 60, herbal: 80 },
    descriptor: 'herbal, botanically complex',
    genreCategory: 'psych-prog',
  },
  {
    patterns: [/funk/i, /disco/i, /boogie/i, /nu-disco/i, /euro-disco/i],
    vector: { sweet: 55, sour: 70, bitter: 10, boozy: 45, herbal: 15 },
    descriptor: 'bright, citrusy',
    genreCategory: 'disco',
  },
  {
    patterns: [/soul/i, /r&b/i, /motown/i, /neo-soul/i, /gospel/i, /rhythm and blues/i],
    vector: { sweet: 50, sour: 25, bitter: 30, boozy: 65, herbal: 25 },
    descriptor: 'warm, velvety',
    genreCategory: 'soul',
  },
  {
    patterns: [/ambient/i, /downtempo/i, /trip hop/i, /drone/i, /chillout/i, /lo-fi/i, /new age/i],
    vector: { sweet: 30, sour: 25, bitter: 25, boozy: 40, herbal: 70 },
    descriptor: 'gentle, aromatic',
    genreCategory: 'ambient',
  },
  {
    patterns: [/electronic/i, /techno/i, /house/i, /electro/i, /idm/i, /breakbeat/i, /drum and bass/i],
    vector: { sweet: 40, sour: 65, bitter: 15, boozy: 55, herbal: 25 },
    descriptor: 'crisp, electric',
    genreCategory: 'electronic',
  },
  {
    patterns: [/hip hop/i, /rap/i, /boom bap/i, /trap/i, /east coast/i, /west coast/i, /golden age/i],
    vector: { sweet: 50, sour: 35, bitter: 20, boozy: 70, herbal: 20 },
    descriptor: 'bold, spirit-forward',
    genreCategory: 'hip-hop',
  },
  {
    patterns: [/reggae/i, /dub/i, /ska/i, /rocksteady/i, /dancehall/i, /roots reggae/i],
    vector: { sweet: 60, sour: 65, bitter: 10, boozy: 55, herbal: 20 },
    descriptor: 'tropical, zesty',
    genreCategory: 'reggae',
  },
  {
    patterns: [/latin/i, /salsa/i, /bossa nova/i, /samba/i, /cumbia/i, /tango/i, /mambo/i],
    vector: { sweet: 50, sour: 70, bitter: 15, boozy: 55, herbal: 25 },
    descriptor: 'vibrant, citrus-bright',
    genreCategory: 'latin',
  },
  {
    patterns: [/folk/i, /country/i, /americana/i, /bluegrass/i, /acoustic/i, /singer-songwriter/i],
    vector: { sweet: 45, sour: 15, bitter: 35, boozy: 75, herbal: 40 },
    descriptor: 'warm, rustic',
    genreCategory: 'folk',
  },
  {
    patterns: [/blues/i, /delta blues/i, /chicago blues/i, /electric blues/i],
    vector: { sweet: 25, sour: 10, bitter: 50, boozy: 85, herbal: 25 },
    descriptor: 'deep, bittersweet',
    genreCategory: 'blues',
  },
  {
    patterns: [/metal/i, /heavy metal/i, /stoner/i],
    vector: { sweet: 15, sour: 10, bitter: 75, boozy: 90, herbal: 40 },
    descriptor: 'heavy, high-proof',
    genreCategory: 'metal',
  },
  {
    patterns: [/classical/i, /baroque/i, /romantic/i, /orchestral/i, /chamber/i],
    vector: { sweet: 35, sour: 25, bitter: 35, boozy: 60, herbal: 55 },
    descriptor: 'refined, elegant',
    genreCategory: 'classical',
  },
];

export const DEFAULT_STYLE = {
  vector: { sweet: 35, sour: 30, bitter: 35, boozy: 65, herbal: 35 },
  descriptor: 'balanced, spirit-forward',
  genreCategory: 'general',
  tempoEnergy: 'standard',
};

/**
 * Maps an album's Discogs styles and genres into an aggregate target flavor profile and tempo/energy.
 */
export function getAlbumTargetVector(album) {
  const candidates = [...(album?.styles || []), ...(album?.genres || [])];
  const matched = [];

  for (const token of candidates) {
    if (!token) continue;
    for (const def of STYLE_DEFINITIONS) {
      if (def.patterns.some((p) => p.test(token))) {
        matched.push(def);
        break;
      }
    }
  }

  if (matched.length === 0) {
    return {
      vector: { ...DEFAULT_STYLE.vector },
      descriptor: DEFAULT_STYLE.descriptor,
      genreCategory: DEFAULT_STYLE.genreCategory,
      tempoEnergy: 'standard',
    };
  }

  const avg = { sweet: 0, sour: 0, bitter: 0, boozy: 0, herbal: 0 };
  let detectedEnergy = 'standard';
  for (const m of matched) {
    avg.sweet += m.vector.sweet;
    avg.sour += m.vector.sour;
    avg.bitter += m.vector.bitter;
    avg.boozy += m.vector.boozy;
    avg.herbal += m.vector.herbal;
    if (m.tempoEnergy === 'dark-fast') {
      detectedEnergy = 'dark-fast';
    } else if (m.tempoEnergy === 'dark-slow' && detectedEnergy !== 'dark-fast') {
      detectedEnergy = 'dark-slow';
    }
  }
  const len = matched.length;

  return {
    vector: {
      sweet: Math.round(avg.sweet / len),
      sour: Math.round(avg.sour / len),
      bitter: Math.round(avg.bitter / len),
      boozy: Math.round(avg.boozy / len),
      herbal: Math.round(avg.herbal / len),
    },
    descriptor: matched[0].descriptor,
    genreCategory: matched[0].genreCategory,
    tempoEnergy: detectedEnergy,
  };
}

/**
 * Historical mid-century and pre-prohibition cocktail standards.
 */
export const ICONIC_PRE1970 = new Set([
  'martini', 'dry-martini', 'vodka-martini', 'manhattan', 'old-fashioned', 'gibson', 'gimlet',
  'sidecar', 'sazerac', 'martinez', 'negroni', 'boulevardier', 'daiquiri',
  'french-75', 'aviation', 'last-word', 'clover-club', 'corpse-reviver-no-2',
  'brooklyn', 'bijou', 'hanky-panky', 'vieux-carre', 'chrysanthemum', 'bamboo',
  'gin-rickey', 'tom-collins', 'chancellor', 'rob-roy', 'affinity', 'blood-and-sand',
  'white-lady', 'monkey-gland', 'between-the-sheets', 'ramos-gin-fizz', 'mint-julep',
]);

/**
 * Target cocktail sets for separated tempo and energy profiles.
 * Dark & Fast: Hardcore, Skate Punk, Thrash, Fast Post-Punk (high sour, high bitter, effervescent/crushed ice).
 * Dark & Slow: Doom Metal, Darkwave, Goth Rock, Sludge, Slowcore (high boozy, high bitter, stirred).
 */
export const DARK_FAST_TARGETS = new Set([
  'mexican-firing-squad',
  'siesta',
  'paloma',
  'jungle-bird',
  'el-diablo',
  'ward-eight',
]);

export const DARK_SLOW_TARGETS = new Set([
  'trident',
  'black-manhattan',
  'boulevardier',
  'toronto',
  'negroni',
  'little-italy',
]);

/**
 * Returns estimated historical creation year for a cocktail based on source text and tags.
 */
export function getCocktailYear(drink) {
  const text = `${drink?.source || ''} ${drink?.description || ''}`;
  const match = text.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
  if (match) return parseInt(match[1], 10);

  const tags = drink?.tags || [];
  if (tags.includes('pre-prohibition')) return 1910;
  if (tags.includes('prohibition-era')) return 1925;
  if (tags.includes('modern-craft')) return 2006;
  if (tags.includes('tropical-tiki') || tags.includes('party') || tags.includes('highball')) return 1975;
  if (tags.includes('classic')) return 1930;
  return 1960;
}

/**
 * Multi-factor score for a cocktail against an album.
 * 1. Palate Alignment (0-40 pts)
 * 2. Era Weighting (0-30 pts)
 * 3. Spirit / Regional Affinity (0-15 pts)
 * 4. Tempo / Energy & Format Modifiers (-35 to +25 pts)
 */
export function scoreCocktail(album, targetProfile, drink) {
  const b = drink?.balance || {};
  const target = targetProfile.vector;

  // 1. Palate Alignment (0-40 pts): closeness to flavor profile
  const dist = Math.sqrt(
    Math.pow(target.sweet - (b.sweet || 0), 2) +
    Math.pow(target.sour - (b.sour || 0), 2) +
    Math.pow(target.bitter - (b.bitter || 0), 2) +
    Math.pow(target.boozy - (b.boozy || 0), 2) +
    Math.pow(target.herbal - (b.herbal || 0), 2)
  );
  const palateScore = Math.max(0, 40 - (dist / 2.5));

  // 2. Era Weighting (0-30 pts)
  const albumYear = Number(album?.year || album?.originalYear) || 0;
  const cYear = getCocktailYear(drink);
  const tags = drink?.tags || [];
  let eraScore = 15;

  if (albumYear > 0 && albumYear < 1970) {
    // Pre-1970 albums: heavily penalize modern party drinks / neon highballs
    if (tags.includes('party') || drink.id === 'long-island-iced-tea' || drink.id === 'blue-hawaii') {
      eraScore = 0;
    } else if (ICONIC_PRE1970.has(drink.id)) {
      eraScore = 30; // boost Pre-Prohibition and Mid-Century classics
    } else if (cYear < 1970 || tags.includes('classic') || tags.includes('pre-prohibition') || tags.includes('prohibition-era')) {
      eraScore = 26;
    } else if (tags.includes('modern-craft') || cYear >= 1990) {
      eraScore = 4;
    } else {
      eraScore = 10;
    }
  } else if (albumYear >= 1970 && albumYear < 1990) {
    // 1970s-1980s: allow highballs, disco drinks, tiki, classics
    if (tags.includes('highball') || tags.includes('tropical-tiki') || tags.includes('party') || (cYear >= 1970 && cYear < 1990)) {
      eraScore = 28;
    } else if (tags.includes('classic')) {
      eraScore = 20;
    } else if (tags.includes('modern-craft') || cYear >= 2000) {
      eraScore = 12;
    } else {
      eraScore = 16;
    }
  } else if (albumYear >= 1990) {
    // 1990s-Present
    if (targetProfile.tempoEnergy === 'dark-fast' && DARK_FAST_TARGETS.has(drink.id)) {
      eraScore = 28;
    } else if (targetProfile.tempoEnergy === 'dark-slow' && DARK_SLOW_TARGETS.has(drink.id)) {
      eraScore = 28;
    } else if (tags.includes('modern-craft') || cYear >= 1990) {
      eraScore = 30;
    } else if (tags.includes('party') || tags.includes('highball')) {
      eraScore = 22;
    } else if (tags.includes('classic')) {
      eraScore = 20;
    } else {
      eraScore = 16;
    }
  }

  // 3. Spirit / Regional Affinity (0-15 pts)
  const country = String(album?.country || '').toLowerCase();
  const spirit = drink?.primarySpirit || '';
  const desc = `${drink?.description || ''} ${drink?.name || ''} ${(drink?.tags || []).join(' ')}`.toLowerCase();
  let spiritScore = 4;

  const isUK = /uk|united kingdom|britain|england|scotland/i.test(country);
  const isUS = /us|united states|usa/i.test(country);
  const isLatin = /jamaica|cuba|puerto rico|barbados|caribbean|brazil|mexico/i.test(country);

  if (isUK) {
    if (spirit === 'gin') {
      spiritScore = 14;
    } else if (spirit === 'whiskey' && /scotch/i.test(desc)) {
      spiritScore = 15;
    } else if (spirit === 'brandy' || spirit === 'amaro') {
      spiritScore = 8;
    }
  } else if (isUS) {
    if (spirit === 'whiskey' || spirit === 'bourbon' || spirit === 'rye') {
      spiritScore = 15;
    } else if ((spirit === 'tequila' || spirit === 'mezcal' || spirit === 'rum') && targetProfile.tempoEnergy === 'dark-fast') {
      spiritScore = 15;
    } else if (spirit === 'gin' || spirit === 'vodka') {
      spiritScore = 8;
    }
  } else if (isLatin) {
    if (spirit === 'tequila' || spirit === 'mezcal' || spirit === 'rum') {
      spiritScore = 15;
    }
  } else if (/france/i.test(country)) {
    if (spirit === 'brandy' || /cognac|champagne/i.test(desc)) spiritScore = 15;
  } else if (/italy/i.test(country)) {
    if (spirit === 'amaro' || /campari|vermouth/i.test(desc)) spiritScore = 15;
  }

  // 4. Tempo / Energy & Kinetic Format Modifiers (-35 to +25 pts)
  let tempoScore = 0;
  if (targetProfile.tempoEnergy === 'dark-fast') {
    if (DARK_FAST_TARGETS.has(drink.id)) {
      tempoScore += 22;
    } else if ((drink.method === 'Shaken' || drink.method === 'Built') && (b.sour || 0) >= 30 && (b.bitter || 0) >= 20) {
      tempoScore += 8;
    }

    // Heavy penalty for slow stirred room-temperature drinks with low acid
    if (drink.method === 'Stirred' && (b.sour || 0) < 18) {
      tempoScore -= 30;
    }
    if (tags.includes('slow-sipper')) {
      tempoScore -= 15;
    }
    if (drink.glassware === 'Shot') {
      tempoScore -= 25;
    }
    if (tags.includes('party') && !DARK_FAST_TARGETS.has(drink.id)) {
      tempoScore -= 15;
    }
    if ((b.bitter || 0) < 18 && !DARK_FAST_TARGETS.has(drink.id)) {
      tempoScore -= 12;
    }
  } else if (targetProfile.tempoEnergy === 'dark-slow') {
    if (DARK_SLOW_TARGETS.has(drink.id)) {
      tempoScore += 22;
    } else if (drink.method === 'Stirred' && (b.boozy || 0) >= 65 && (b.bitter || 0) >= 40) {
      tempoScore += 8;
    }

    if (tags.includes('party') || tags.includes('tropical-tiki') || ((b.sour || 0) >= 40 && (b.boozy || 0) < 60)) {
      tempoScore -= 25;
    }
    if (drink.glassware === 'Shot') {
      tempoScore -= 25;
    }
  }

  const total = palateScore + eraScore + spiritScore + tempoScore;
  return { cocktail: drink, total, palateScore, eraScore, spiritScore, tempoScore, dist };
}

/**
 * Stable 32-bit FNV-1a string hash.
 */
export function hashString(str = '') {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Returns an appropriate glass emoji for a cocktail.
 */
export function getCocktailEmoji(cocktail) {
  const glass = String(cocktail?.glassware || '').toLowerCase();
  if (glass.includes('rocks') || glass.includes('old-fashioned') || glass.includes('tumbler') || glass.includes('lowball')) {
    return '🥃';
  }
  if (glass.includes('martini') || glass.includes('coupe') || glass.includes('nick')) {
    return '🍸';
  }
  if (glass.includes('highball') || glass.includes('collins') || glass.includes('mug') || glass.includes('tiki')) {
    return '🍹';
  }
  if (glass.includes('flute') || glass.includes('wine') || glass.includes('champagne')) {
    return '🥂';
  }
  return '🍸';
}

/**
 * Dynamically constructs an expressive single-sentence pairing rationale.
 */
export function buildDynamicRationale(album, cocktail) {
  const year = Number(album?.year || album?.originalYear) || 0;
  const title = album?.title || 'this record';
  const artist = album?.artist || '';
  const b = cocktail?.balance || {};
  const tags = cocktail?.tags || [];
  const allStyles = [...(album?.styles || []), ...(album?.genres || [])].join(' ').toLowerCase();

  const isDarkFast = /(?<!post[- ])hardcore\b|skate punk|thrash|fast post-punk|melodic hardcore|power ?violence|speed metal|horror punk|d-beat|crust punk|street punk/i.test(allStyles);
  const isDarkSlow = /doom metal|\bdoom\b|darkwave|goth rock|gothic rock|\bgoth\b|sludge|slowcore|funeral doom|drone metal|post-metal/i.test(allStyles);

  // 1. Flavor descriptor
  let flavor = 'spirit-forward';
  if (isDarkFast) {
    if (b.sour >= 30 && b.bitter >= 20) {
      flavor = 'thirst-quenching, bitter-tart';
    } else if (b.sour >= 30) {
      flavor = 'crisp, citrus-forward';
    } else if (b.bitter >= 30) {
      flavor = 'bittersweet';
    }
  } else if (isDarkSlow) {
    flavor = 'dark, bitter';
  } else if (b.bitter >= 45 && b.boozy >= 60 && cocktail?.method === 'Stirred') {
    flavor = 'dark, bitter';
  } else if (b.bitter >= 50 && b.boozy >= 60) {
    flavor = 'dark, bitter';
  } else if (b.boozy >= 70 && b.sweet <= 30) {
    flavor = 'dry, spirit-forward';
  } else if (b.sour >= 55 && b.sweet >= 45) {
    flavor = 'bright, citrus-forward';
  } else if (b.sour >= 55) {
    flavor = 'crisp, tart';
  } else if (b.herbal >= 55) {
    flavor = 'botanical, layered';
  } else if (b.bitter >= 45) {
    flavor = 'bittersweet';
  } else if (b.sweet >= 55) {
    flavor = 'rich, velvety';
  } else if (b.boozy >= 65) {
    flavor = 'spirit-forward';
  }

  // 2. Era / format descriptor
  let eraFormat = 'pour';
  if (isDarkFast) {
    if (tags.includes('highball') || cocktail?.glassware === 'Highball' || cocktail?.glassware === 'Collins') {
      eraFormat = 'highball';
    } else if (cocktail?.method === 'Shaken') {
      eraFormat = 'shaken pour';
    } else {
      eraFormat = 'pour';
    }
  } else if (isDarkSlow) {
    eraFormat = cocktail?.method === 'Stirred' ? 'stirred slow-sipper' : 'stirred pour';
  } else if (year > 0 && year < 1970) {
    if (year < 1930) eraFormat = 'Pre-Prohibition classic';
    else if (year < 1960) eraFormat = '1950s classic';
    else eraFormat = '1960s classic';
  } else if (year >= 1970 && year < 1980) {
    eraFormat = tags.includes('highball') ? '1970s highball' : '1970s classic';
  } else if (year >= 1980 && year < 1990) {
    eraFormat = tags.includes('highball') ? '1980s highball' : '1980s classic';
  } else if (year >= 1990) {
    if (cocktail?.method === 'Stirred') {
      eraFormat = 'stirred pour';
    } else if (tags.includes('modern-craft') || tags.includes('riff')) {
      eraFormat = 'modern craft pour';
    } else {
      eraFormat = 'shaken pour';
    }
  } else {
    eraFormat = tags.includes('classic') ? 'timeless classic' : 'pour';
  }

  // 3. Bridge phrase
  const bridges = ['to match', 'echoing', 'tailored to', 'mirroring', 'attuned to'];
  const bridgeIndex = hashString(`${album?.id || ''}:${title}`) % bridges.length;
  const bridge = bridges[bridgeIndex];

  // 4. Musical vibe / album context
  let vibe = `${title}’s rich studio craft`;

  if (isDarkFast) {
    vibe = /afi\b/i.test(artist) || /black sails/i.test(title)
      ? 'the frantic kinetic drive of 200 BPM East Bay melodic hardcore'
      : `the frantic kinetic drive and raw speed of ${title}`;
  } else if (isDarkSlow) {
    vibe = `${title}’s brooding, atmospheric gothic weight`;
  } else if (/post-hardcore|emo\b|screamo|metalcore/.test(allStyles)) {
    vibe = year >= 1990 && year < 2005
      ? 'the aggressive drive of late-90s post-hardcore'
      : `the raw emotional drive of ${title}`;
  } else if (/punk|no wave|post-punk|garage rock/.test(allStyles)) {
    vibe = `${title}’s raw post-punk energy`;
  } else if (/classic rock|blues rock|hard rock/.test(allStyles)) {
    vibe = `${title}’s rich studio craft`;
  } else if (/pop rock|soft rock/.test(allStyles)) {
    vibe = `${title}’s melodic studio warmth`;
  } else if (/pop|bubblegum|synth-pop/.test(allStyles)) {
    vibe = `${title}’s sparkling melodic hooks`;
  } else if (/modal|hard bop|post-bop|cool jazz|jazz/.test(allStyles)) {
    vibe = `${title}’s late-night modal cool`;
  } else if (/psychedelic|prog|art rock|space rock/.test(allStyles)) {
    vibe = `${title}’s intricate studio arrangements`;
  } else if (/funk|disco|nu-disco/.test(allStyles)) {
    vibe = `${title}’s vibrant groove and upbeat rhythm`;
  } else if (/soul|r&b|motown/.test(allStyles)) {
    vibe = `${title}’s deep soulful warmth`;
  } else if (/ambient|downtempo|trip hop|drone/.test(allStyles)) {
    vibe = `the atmospheric soundscapes of ${title}`;
  } else if (/electronic|techno|house/.test(allStyles)) {
    vibe = `${title}’s pulsating electronic pulse`;
  } else if (/hip hop|rap|boom bap/.test(allStyles)) {
    vibe = `${title}’s head-nodding cadence`;
  } else if (/reggae|dub|ska/.test(allStyles)) {
    vibe = `${title}’s sun-drenched island riddims`;
  } else if (/latin|salsa|bossa nova/.test(allStyles)) {
    vibe = `${title}’s dynamic Latin rhythm`;
  } else if (/folk|americana|country|acoustic/.test(allStyles)) {
    vibe = `${title}’s warm acoustic storytelling`;
  } else if (/metal|doom|stoner/.test(allStyles)) {
    vibe = `${title}’s towering guitar riffs`;
  } else if (artist) {
    vibe = `${title}’s timeless sound`;
  }

  return `A ${flavor} ${eraFormat} ${bridge} ${vibe}.`;
}

/**
 * Backward compatibility alias for matchAlbumStyle.
 */
export function matchAlbumStyle(album) {
  const targetProfile = getAlbumTargetVector(album);
  return {
    vector: targetProfile.vector,
    descriptor: targetProfile.descriptor,
    vibe: targetProfile.genreCategory,
    matchedTag: targetProfile.genreCategory,
    tempoEnergy: targetProfile.tempoEnergy,
  };
}

/**
 * Pairs an album with a cocktail from the Speakeasy catalog.
 *
 * @param {Object} album - Album with Discogs metadata (genres, styles, year, country, id)
 * @param {Array} [catalogOverride] - Optional custom catalog array for testing
 * @returns {{ cocktail: Object, reason: string, emoji: string, url: string }}
 */
export function getAlbumCocktailPairing(album, catalogOverride) {
  const catalog = Array.isArray(catalogOverride) && catalogOverride.length > 0 ? catalogOverride : CATALOG;
  if (!catalog || catalog.length === 0) {
    return {
      cocktail: { id: 'old-fashioned', name: 'Old Fashioned' },
      reason: 'A balanced, spirit-forward timeless classic to match rich vinyl warmth.',
      emoji: '🥃',
      url: 'https://speakeasy.ryanmarch.me/app#old-fashioned',
    };
  }

  // 1. Calculate target flavor profile from album styles/genres
  const targetProfile = getAlbumTargetVector(album);

  // 2. Multi-factor scoring across all cocktails in the catalog
  const scored = catalog.map((drink) => scoreCocktail(album, targetProfile, drink));
  scored.sort((a, b) => b.total - a.total);

  // 3. Take top 5 candidates and deterministically select using album hash
  const topCandidates = scored.slice(0, 5);
  const albumKey = `${album?.id || ''}:${album?.title || 'album'}`;
  const selectedIndex = hashString(albumKey) % topCandidates.length;
  const chosen = topCandidates[selectedIndex].cocktail;

  // 4. Generate dynamic rationale tailored to album and chosen drink
  const reason = buildDynamicRationale(album, chosen);
  const emoji = getCocktailEmoji(chosen);
  const url = `https://speakeasy.ryanmarch.me/app#${chosen.id}`;

  return {
    cocktail: chosen,
    reason,
    emoji,
    url,
  };
}
