// imagematch.js - is this candidate cover the same artwork as the Discogs image for the record?
//
// Cleaner covers from Deezer or iTunes are only swapped in when they look like the same picture. A digital release can
// have completely different art from a special-edition pressing, and a Discogs image can be a photograph of the sleeve
// (glare, shrink wrap, a tilted shot with background) or even a photo of the disc, so the comparison has to forgive
// lighting, colour casts and framing while still telling different pictures apart.
//
// Each picture is reduced to a 96 x 96 greyscale map and a hue histogram. The Discogs image is compared with the
// candidate at a range of crops and shifts (its best alignment wins), on two views: brightness, and the edges in it.
// Hue settles borderline cases. When in doubt the answer is "different": keeping the Discogs image is the safe outcome,
// and a person can still choose the cleaner cover by hand.

export const SIZE = 96;
const GRID = 24; // maps are compared at 24 x 24
const HUE_BINS = 12;

// Thresholds, tuned on 96 real Discogs vinyl pressings (scans, photos, disc photos) against their albums' clean covers and
// about 670 deliberately mismatched pairs. With these, 82 of 96 pressings match (most of the rest are photos of the disc or a test-pressing sheet, not the cover) and none of the mismatches do.
export const SURE_EDGE = 0.55; // edge structure lines up (the closest mismatch scored 0.48)
export const SURE_GREY = 0.7; // brightness structure lines up
export const LIKELY_EDGE = 0.4; // ...or both are fairly close, and the colours agree
export const LIKELY_GREY = 0.55;
export const LIKELY_HUE = 0.6;

// rgba: pixels of a SIZE x SIZE picture (RGBA, as a canvas provides them)
export function fingerprint(rgba) {
  const grey = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) grey[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];

  // Which colours are there, weighted by how vivid they are (grey pixels have no hue): 12 bins, adding up to 1
  const hue = new Float32Array(HUE_BINS);
  const block = 3;
  for (let by = 0; by < SIZE; by += block) {
    for (let bx = 0; bx < SIZE; bx += block) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const i = ((by + y) * SIZE + bx + x) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
        }
      }
      r /= block * block * 255;
      g /= block * block * 255;
      b /= block * block * 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      if (chroma <= 0) continue;
      let h;
      if (max === r) h = ((g - b) / chroma + 6) % 6;
      else if (max === g) h = (b - r) / chroma + 2;
      else h = (r - g) / chroma + 4;
      const saturation = chroma / max;
      hue[Math.min(HUE_BINS - 1, Math.floor((h / 6) * HUE_BINS))] += saturation * max;
    }
  }
  const total = hue.reduce((sum, v) => sum + v, 0) || 1;
  for (let i = 0; i < HUE_BINS; i++) hue[i] /= total;
  return { grey, hue };
}

// The part of a map inside `box` (fractions 0..1 of the width and height), as a size x size map. Each cell is the
// average of a few smoothly interpolated samples.
function resample(grey, box, size) {
  const out = new Float32Array(size * size);
  const [x0, y0, x1, y1] = box;
  const taps = 3;
  const at = (x, y) => {
    const fx = Math.min(SIZE - 1, Math.max(0, x * SIZE - 0.5));
    const fy = Math.min(SIZE - 1, Math.max(0, y * SIZE - 0.5));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const jx = Math.min(SIZE - 1, ix + 1);
    const jy = Math.min(SIZE - 1, iy + 1);
    const tx = fx - ix;
    const ty = fy - iy;
    return (grey[iy * SIZE + ix] * (1 - tx) + grey[iy * SIZE + jx] * tx) * (1 - ty) + (grey[jy * SIZE + ix] * (1 - tx) + grey[jy * SIZE + jx] * tx) * ty;
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let v = 0; v < taps; v++) {
        for (let u = 0; u < taps; u++) {
          const x = x0 + ((i + (u + 0.5) / taps) / size) * (x1 - x0);
          const y = y0 + ((j + (v + 0.5) / taps) / size) * (y1 - y0);
          sum += at(x, y);
        }
      }
      out[j * size + i] = sum / (taps * taps);
    }
  }
  return out;
}

// Edge strength of a map: brightness change, ignoring where it is bright
function edges(grey, box) {
  const size = GRID * 2;
  const map = resample(grey, box, size);
  // a light blur, so texture and noise don't count as edges
  const blurred = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < size && xx >= 0 && xx < size) {
            sum += map[yy * size + xx];
            n++;
          }
        }
      }
      blurred[y * size + x] = sum / n;
    }
  }
  const out = [];
  for (let y = 1; y < size - 1; y += 2) {
    for (let x = 1; x < size - 1; x += 2) {
      const gx = blurred[y * size + x + 1] - blurred[y * size + x - 1];
      const gy = blurred[(y + 1) * size + x] - blurred[(y - 1) * size + x];
      out.push(Math.hypot(gx, gy));
    }
  }
  return Float32Array.from(out);
}

// Pearson correlation: how alike the patterns are, whatever the overall brightness or contrast
function correlation(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va < 1e-6 || vb < 1e-6 ? 0 : cov / Math.sqrt(va * vb);
}

// Crops of the Discogs image to try: the whole picture, and 90%, 80% and 70% windows at nine positions (photos have
// margins and are framed loosely)
const CROPS = (() => {
  const crops = [[0, 0, 1, 1]];
  for (const f of [0.9, 0.8, 0.7]) {
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const slack = (1 - f) / 2;
        const x0 = slack + dx * slack;
        const y0 = slack + dy * slack;
        crops.push([x0, y0, x0 + f, y0 + f]);
      }
    }
  }
  return crops;
})();

const WHOLE = [0, 0, 1, 1];

// How alike two pictures are: { edge, grey, hue }, each roughly 0 (unrelated) to 1 (the same picture)
export function scoreImages(discogs, candidate) {
  const greyTarget = resample(candidate.grey, WHOLE, GRID);
  const edgeTarget = edges(candidate.grey, WHOLE);
  let grey = -1;
  let edge = -1;
  for (const box of CROPS) {
    grey = Math.max(grey, correlation(resample(discogs.grey, box, GRID), greyTarget));
    edge = Math.max(edge, correlation(edges(discogs.grey, box), edgeTarget));
  }
  let hue = 0;
  for (let i = 0; i < HUE_BINS; i++) hue += Math.min(discogs.hue[i], candidate.hue[i]);
  return { edge, grey, hue };
}

export function decide({ edge, grey, hue }) {
  if (edge >= SURE_EDGE || grey >= SURE_GREY) return true;
  return edge >= LIKELY_EDGE && grey >= LIKELY_GREY && hue >= LIKELY_HUE;
}

export const sameArtwork = (discogs, candidate) => decide(scoreImages(discogs, candidate));

// ---- in the browser: get a fingerprint for an image address ------------------------------------------------------

function draw(img) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, SIZE, SIZE);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

// Resolves with a fingerprint; rejects if the image can't be loaded or read.
export function fingerprintFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(fingerprint(draw(img)));
      } catch (err) {
        reject(err); // a picture that can't be read (not allowed cross-site)
      }
    };
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

// Discogs images can't be read from another site, so they come through our own address
export const discogsImageUrl = (url) => `/api/img?url=${encodeURIComponent(url)}`;
