// tests/pairing-test.mjs - Test suite for cocktail pairing engine
import assert from 'node:assert/strict';
import {
  getAlbumCocktailPairing,
  getCocktailEmoji,
  CATALOG,
  hashString,
  getAlbumTargetVector,
  scoreCocktail,
  buildDynamicRationale,
  DARK_FAST_TARGETS,
  DARK_SLOW_TARGETS,
} from '../src/utils/pairing.js';

console.log('Testing Cocktail Pairing Engine...');

// 1. Catalog integrity & full catalog coverage
assert.ok(Array.isArray(CATALOG), 'CATALOG should be an array');
assert.ok(CATALOG.length >= 250, `Expected full catalog (at least 250 cocktails), got ${CATALOG.length}`);
for (const drink of CATALOG) {
  assert.ok(drink.id, 'Every cocktail must have an id');
  assert.ok(drink.name, `Cocktail ${drink.id} missing name`);
  assert.ok(drink.balance, `Cocktail ${drink.id} missing balance`);
  for (const axis of ['sweet', 'sour', 'bitter', 'boozy', 'herbal']) {
    assert.equal(typeof drink.balance[axis], 'number', `${drink.id}.${axis} should be a number`);
  }
}

// 2. Determinism: Same album ID and title always yields identical pairing
const testAlbum = {
  id: 'discogs_mock_001',
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  genres: ['Jazz'],
  styles: ['Modal Jazz', 'Hard Bop'],
  year: 1959,
  country: 'US',
};

const runA = getAlbumCocktailPairing(testAlbum);
const runB = getAlbumCocktailPairing(testAlbum);
assert.equal(runA.cocktail.id, runB.cocktail.id, 'Pairing must be deterministic across identical runs');
assert.equal(runA.reason, runB.reason, 'Reason must be deterministic across identical runs');
assert.ok(runA.url.startsWith('https://speakeasy.ryanmarch.me/app#'), 'URL must link to speakeasy app hash route');

// 3. Fallbacks and resilient error handling
const emptyAlbum = { id: 'empty', genres: [], styles: [] };
const resultEmpty = getAlbumCocktailPairing(emptyAlbum);
assert.ok(resultEmpty.cocktail, 'Empty album should return a cocktail');
assert.ok(resultEmpty.reason, 'Empty album should return a reason');
assert.ok(resultEmpty.url, 'Empty album should return a url');

const nullAlbum = null;
const resultNull = getAlbumCocktailPairing(nullAlbum);
assert.ok(resultNull.cocktail, 'Null album should return a cocktail');
assert.ok(resultNull.reason, 'Null album should return a reason');

const obscureAlbum = {
  id: 'obscure_123',
  title: 'Obscure Sounds',
  artist: 'Unknown',
  genres: ['Microtonal Glitchcore'],
  styles: ['Experimental Noise 9000'],
  year: 2024,
};
const resultObscure = getAlbumCocktailPairing(obscureAlbum);
assert.ok(resultObscure.cocktail, 'Obscure album should return a cocktail without throwing');
assert.ok(resultObscure.reason, 'Obscure album should have a valid reason string');

// 4. Multi-Factor Scoring: Palate (0-40), Era (0-30), Spirit (0-15)
const abbeyRoad = {
  id: 'beatles_abbey_road',
  title: 'Abbey Road',
  artist: 'The Beatles',
  genres: ['Rock'],
  styles: ['Classic Rock', 'Pop Rock'],
  year: 1969,
  country: 'UK',
};
const abbeyTarget = getAlbumTargetVector(abbeyRoad);
const brooklynDrink = CATALOG.find((c) => c.id === 'brooklyn');
const liitDrink = CATALOG.find((c) => c.id === 'long-island-iced-tea');

assert.ok(brooklynDrink, 'Brooklyn cocktail must exist');
assert.ok(liitDrink, 'Long Island Iced Tea must exist');

const brooklynScore = scoreCocktail(abbeyRoad, abbeyTarget, brooklynDrink);
const liitScore = scoreCocktail(abbeyRoad, abbeyTarget, liitDrink);

// Pre-1970 era penalty: Long Island Iced Tea must get 0 era points for a 1969 album
assert.equal(liitScore.eraScore, 0, 'Long Island Iced Tea must receive 0 era points for pre-1970 album');
assert.ok(brooklynScore.eraScore >= 25, 'Mid-century/classic must receive high era points for pre-1970 album');
assert.ok(brooklynScore.total > liitScore.total, 'Classic Brooklyn must score substantially higher than Long Island Iced Tea');

// Verify The Beatles pairing is never Long Island Iced Tea
const abbeyPairing = getAlbumCocktailPairing(abbeyRoad);
assert.notEqual(abbeyPairing.cocktail.id, 'long-island-iced-tea', 'The Beatles should NEVER pair with Long Island Iced Tea');
assert.notEqual(abbeyPairing.cocktail.id, 'mexican-firing-squad', 'The Beatles should not collapse to Mexican Firing Squad');
assert.ok(
  abbeyPairing.cocktail.tags.includes('classic') || abbeyPairing.cocktail.primarySpirit === 'whiskey' || abbeyPairing.cocktail.primarySpirit === 'gin',
  `Abbey Road should pair with an appropriate classic/whiskey/gin cocktail, got: ${abbeyPairing.cocktail.name}`
);

// 5. Dynamic Rationale Generation
assert.match(abbeyPairing.reason, /Abbey Road/i, 'Rationale should reference album title');
assert.match(abbeyPairing.reason, /studio craft|melodic/i, 'Rationale should dynamically incorporate musical attributes');

const afiAlbum = {
  id: 'afi_december',
  title: 'Decemberunderground',
  artist: 'AFI',
  genres: ['Rock'],
  styles: ['Post-Hardcore', 'Emo'],
  year: 2006,
  country: 'US',
};
const afiPairing = getAlbumCocktailPairing(afiAlbum);
assert.match(afiPairing.reason, /Decemberunderground|hardcore|emotional/i, 'AFI rationale should reflect post-hardcore attributes');

// 6. Variety & Deterministic Top-5 Hashing across same-era Rock albums
const rock2000s = [
  { id: 'discogs_afi', title: 'Decemberunderground', artist: 'AFI', year: 2006, styles: ['Post-Hardcore', 'Emo'], country: 'US' },
  { id: 'discogs_mcr', title: 'The Black Parade', artist: 'My Chemical Romance', year: 2006, styles: ['Post-Hardcore', 'Alternative Rock'], country: 'US' },
  { id: 'discogs_jew', title: 'Bleed American', artist: 'Jimmy Eat World', year: 2001, styles: ['Emo', 'Alternative Rock'], country: 'US' },
  { id: 'discogs_fob', title: 'From Under the Cork Tree', artist: 'Fall Out Boy', year: 2005, styles: ['Pop Punk', 'Emo'], country: 'US' },
  { id: 'discogs_bn', title: 'Deja Entendu', artist: 'Brand New', year: 2003, styles: ['Emo', 'Indie Rock'], country: 'US' },
];

const pairedDrinks = new Set(rock2000s.map((a) => getAlbumCocktailPairing(a).cocktail.id));
assert.ok(
  pairedDrinks.size >= 3,
  `5 Rock albums from the 2000s should produce distinct pairings across top 5 candidates, got ${pairedDrinks.size} unique drinks`
);

// Re-running Decemberunderground must return the exact same drink
const afiSecondRun = getAlbumCocktailPairing(afiAlbum);
assert.equal(afiPairing.cocktail.id, afiSecondRun.cocktail.id, 'Decemberunderground must consistently pair with the same drink');

// 7. Regional and Genre tests
// Latin / Caribbean -> Rum / Tequila
const salsaAlbum = {
  id: 'salsa_test',
  title: 'Siembra',
  artist: 'Willie Colón & Rubén Blades',
  genres: ['Latin'],
  styles: ['Salsa'],
  year: 1978,
  country: 'Puerto Rico',
};
const salsaPairing = getAlbumCocktailPairing(salsaAlbum);
assert.ok(
  salsaPairing.cocktail.primarySpirit === 'rum' || salsaPairing.cocktail.primarySpirit === 'tequila' || salsaPairing.cocktail.balance.sour >= 35,
  `Latin album should favor tropical/rum/tequila or zesty profile, got ${salsaPairing.cocktail.name}`
);

// Glassware Emoji mapping
assert.equal(getCocktailEmoji({ glassware: 'Coupe' }), '🍸');
assert.equal(getCocktailEmoji({ glassware: 'Rocks' }), '🥃');
assert.equal(getCocktailEmoji({ glassware: 'Highball' }), '🍹');

// 8. Dark & Fast (Kinetic Hardcore Punk) vs Dark & Slow (Atmospheric Goth / Doom)
const blackSailsAlbum = {
  id: 'afi_black_sails',
  title: 'Black Sails in the Sunset',
  artist: 'AFI',
  genres: ['Rock'],
  styles: ['Hardcore', 'Punk', 'Melodic Hardcore'],
  year: 1999,
  country: 'US',
};

const blackSailsTarget = getAlbumTargetVector(blackSailsAlbum);
assert.equal(blackSailsTarget.tempoEnergy, 'dark-fast', 'Hardcore punk must be classified as dark-fast');
assert.ok(blackSailsTarget.vector.sour >= 60, 'Dark-fast target must have high sour');
assert.ok(blackSailsTarget.vector.bitter >= 40, 'Dark-fast target must have high bitter');

// Trident must be penalized and NEVER paired with Black Sails
const tridentDrink = CATALOG.find((c) => c.id === 'trident');
assert.ok(tridentDrink, 'Trident cocktail exists in catalog');
const tridentScoreOnBS = scoreCocktail(blackSailsAlbum, blackSailsTarget, tridentDrink);
assert.ok(tridentScoreOnBS.tempoScore <= -25, 'Trident must receive severe penalty for fast kinetic punk');

const blackSailsPairing = getAlbumCocktailPairing(blackSailsAlbum);
assert.notEqual(blackSailsPairing.cocktail.id, 'trident', 'Black Sails in the Sunset must NEVER pair with Trident');
assert.notEqual(blackSailsPairing.cocktail.method, 'Stirred', 'Black Sails should pair with a kinetic shaken/highball drink, not stirred room-temp');
assert.ok(
  DARK_FAST_TARGETS.has(blackSailsPairing.cocktail.id) ||
  (blackSailsPairing.cocktail.balance.sour >= 30 && blackSailsPairing.cocktail.balance.bitter >= 20),
  `Black Sails should pair with a kinetic bitter-tart or highball target, got: ${blackSailsPairing.cocktail.name}`
);
assert.match(
  blackSailsPairing.reason,
  /kinetic drive|East Bay melodic hardcore/i,
  'Rationale for Black Sails should capture the kinetic drive of East Bay melodic hardcore'
);

// Dark & Slow: Burials (Goth Rock, Darkwave)
const burialsAlbum = {
  id: 'afi_burials',
  title: 'Burials',
  artist: 'AFI',
  genres: ['Rock'],
  styles: ['Goth Rock', 'Darkwave', 'Alternative Rock'],
  year: 2013,
  country: 'US',
};

const burialsTarget = getAlbumTargetVector(burialsAlbum);
assert.equal(burialsTarget.tempoEnergy, 'dark-slow', 'Goth Rock / Darkwave must be classified as dark-slow');
assert.ok(burialsTarget.vector.boozy >= 80, 'Dark-slow target must have high booziness');
assert.ok(burialsTarget.vector.sour <= 15, 'Dark-slow target must have low acid');

const burialsPairing = getAlbumCocktailPairing(burialsAlbum);
assert.equal(burialsPairing.cocktail.method, 'Stirred', 'Burials must pair with a stirred slow-sipping pour');
assert.ok(
  DARK_SLOW_TARGETS.has(burialsPairing.cocktail.id) || burialsPairing.cocktail.balance.boozy >= 70,
  `Burials should pair with a dark stirred cocktail, got: ${burialsPairing.cocktail.name}`
);
assert.match(burialsPairing.reason, /gothic weight|brooding|dark/i, 'Rationale for Burials should reflect gothic atmospheric weight');

// 9. AFI Discography Variety: albums across different eras do NOT collapse to the same drink
const afiDiscography = [
  { id: 'afi_1995', title: 'Answer That and Stay Fashionable', artist: 'AFI', year: 1995, styles: ['Hardcore', 'Punk', 'Skate Punk'], country: 'US' },
  { id: 'afi_1997', title: 'Shut Your Mouth and Open Your Eyes', artist: 'AFI', year: 1997, styles: ['Hardcore', 'Punk'], country: 'US' },
  { id: 'afi_1999', title: 'Black Sails in the Sunset', artist: 'AFI', year: 1999, styles: ['Hardcore', 'Punk', 'Melodic Hardcore'], country: 'US' },
  { id: 'afi_2000', title: 'The Art of Drowning', artist: 'AFI', year: 2000, styles: ['Hardcore', 'Punk', 'Horror Punk'], country: 'US' },
  { id: 'afi_2003', title: 'Sing the Sorrow', artist: 'AFI', year: 2003, styles: ['Post-Hardcore', 'Alternative Rock', 'Emo'], country: 'US' },
  { id: 'afi_2006', title: 'Decemberunderground', artist: 'AFI', year: 2006, styles: ['Post-Hardcore', 'Emo', 'Alternative Rock'], country: 'US' },
  { id: 'afi_2009', title: 'Crash Love', artist: 'AFI', year: 2009, styles: ['Alternative Rock', 'Pop Rock', 'Glam'], country: 'US' },
  { id: 'afi_2013', title: 'Burials', artist: 'AFI', year: 2013, styles: ['Goth Rock', 'Darkwave', 'Alternative Rock'], country: 'US' },
  { id: 'afi_2017', title: 'AFI (The Blood Album)', artist: 'AFI', year: 2017, styles: ['Alternative Rock', 'Post-Hardcore', 'New Wave'], country: 'US' },
  { id: 'afi_2021', title: 'Bodies', artist: 'AFI', year: 2021, styles: ['Post-Punk', 'New Wave', 'Synth-pop'], country: 'US' },
];

const afiDrinkIds = new Set(afiDiscography.map((album) => getAlbumCocktailPairing(album).cocktail.id));
assert.ok(
  afiDrinkIds.size >= 5,
  `AFI discography across different eras should produce diverse pairings (at least 5 unique drinks), got ${afiDrinkIds.size} unique drinks: ${Array.from(afiDrinkIds).join(', ')}`
);

console.log('All Cocktail Pairing Engine tests passed successfully!');
