// Run with: node tests/vinyl-test.mjs
import assert from 'node:assert/strict';
import { parseVinyl, vinylFill } from '../public/js/vinyl.js';

const pressing = (text, descriptions = ['LP', 'Album']) => [{ name: 'Vinyl', qty: '1', descriptions, text }];
const kind = (text, descriptions) => parseVinyl(pressing(text, descriptions)).kind;

// Plain and unknown pressings stay black
for (const text of ['', 'Black', 'Black Vinyl', '180 Gram', undefined]) assert.equal(kind(text), 'black', `black: ${text}`);
assert.equal(parseVinyl(undefined).kind, 'black');
assert.equal(parseVinyl([]).kind, 'black');
assert.equal(parseVinyl(null).kind, 'black');

// Solid colours
assert.equal(kind('Red'), 'solid');
assert.equal(kind('Opaque Yellow'), 'solid');
assert.deepEqual(parseVinyl(pressing('Red')).colors[0], [178, 30, 40]);

// Modifiers move the colour lighter / darker
const blue = parseVinyl(pressing('Blue')).colors[0];
const light = parseVinyl(pressing('Light Blue')).colors[0];
const dark = parseVinyl(pressing('Dark Blue')).colors[0];
assert.ok(light[0] > blue[0] && light[2] >= blue[2], 'light blue is lighter');
assert.ok(dark[2] < blue[2], 'dark blue is darker');

// Translucent / clear
assert.equal(kind('Clear'), 'translucent');
assert.equal(parseVinyl(pressing('Clear')).clear, true);
assert.equal(kind('Transparent Blue'), 'translucent');
assert.equal(parseVinyl(pressing('Transparent Blue')).clear, undefined, 'a tinted record is not "clear"');
assert.equal(kind('Coke Bottle Clear'), 'translucent');

// Patterns
assert.equal(kind('Red Marbled'), 'marble');
assert.equal(kind('Blue Marble'), 'marble');
assert.equal(kind('Opaque Yellow w/ Black Splatter'), 'splatter');
assert.deepEqual(parseVinyl(pressing('Opaque Yellow w/ Black Splatter')).colors.length, 2);
assert.equal(kind('Blue / Yellow Split'), 'split');
assert.equal(kind('Red & White Half and Half'), 'split');
assert.equal(kind('Black, Grey, Silver Tri-Color'), 'split');
assert.equal(parseVinyl(pressing('Black, Grey, Silver Tri-Color')).colors.length, 3);
assert.equal(kind('Galaxy Blue Purple'), 'swirl');
assert.equal(kind('Blue / Yellow'), 'swirl', 'several colours with no finish named');
assert.equal(kind('', ['LP', 'Picture Disc']), 'picture');
assert.equal(kind('Picture Disc'), 'picture');

// Ordinary descriptions must not be mistaken for finishes
assert.equal(kind('', ['LP', 'Album', 'Reissue', 'Remastered', 'Half-Speed Mastered', 'Stereo', '180 Gram']), 'black', 'half-speed is not a split');
assert.equal(kind('', ['LP', 'Album', 'Limited Edition', 'Numbered']), 'black');

// Bracketed shades refine the colour before them ("Blue [Light Blue]")
{
  const plain = parseVinyl(pressing('Blue Translucent')).colors[0];
  const refined = parseVinyl(pressing('Blue [Light Blue] Translucent'));
  assert.equal(refined.kind, 'translucent');
  assert.equal(refined.colors.length, 1, 'the bracket replaces, not adds');
  assert.ok(refined.colors[0][0] > plain[0], 'light blue is lighter than blue');
}
assert.equal(kind('Copper [Metallic Copper]'), 'solid');
assert.equal(kind('Magenta Swirl, 10th Anniversary Edition'), 'swirl');
assert.equal(kind('Green Swirl [Hanalei Green]'), 'swirl');
assert.equal(kind('Red Translucent w/ Black Marble'), 'marble');

// A one-colour swirl still gets a second tone so it isn't a flat disc
{
  const css = vinylFill(parseVinyl(pressing('Magenta Swirl')));
  const stops = css.match(/rgba\(\d+, \d+, \d+, 1\)/g);
  assert.ok(new Set(stops).size >= 2, 'swirl has two distinct colours');
}

// Only the vinyl format is read
assert.equal(parseVinyl([{ name: 'CD', text: 'Red' }, { name: 'Vinyl', text: 'Blue' }]).colors[0][2] > 150, true);

// Every kind produces a usable background
for (const text of ['Black', 'Red', 'Clear', 'Red Marbled', 'Yellow w/ Black Splatter', 'Blue / Yellow Split', 'Galaxy Blue Purple', 'Picture Disc']) {
  const css = vinylFill(parseVinyl(pressing(text)), 'https://example.com/art.jpg?x="1"');
  assert.ok(typeof css === 'string' && css.length > 10, `fill for ${text}`);
  assert.ok(!css.includes('undefined') && !css.includes('NaN'), `clean fill for ${text}`);
}
assert.ok(vinylFill(parseVinyl(pressing('Picture Disc')), 'https://e.com/a.jpg').includes('url("https://e.com/a.jpg")'));
assert.ok(!vinylFill(parseVinyl(pressing('Picture Disc')), 'x"); evil("').includes('evil("'), 'artwork URLs cannot break out of url()');

console.log('Vinyl colour tests passed.');
