// barcode.js - Barcode detection, validation, Discogs search, and collection management.
import { discogsFetch } from './discogs.js';

// L-code normalized run lengths for digits 0-9 [space, bar, space, bar]
const L_PATTERNS = [
  [3, 2, 1, 1], // 0
  [2, 2, 2, 1], // 1
  [2, 1, 2, 2], // 2
  [1, 4, 1, 1], // 3
  [1, 1, 3, 2], // 4
  [1, 2, 3, 1], // 5
  [1, 1, 1, 4], // 6
  [1, 3, 1, 2], // 7
  [1, 2, 1, 3], // 8
  [3, 1, 1, 2], // 9
];

// G-code normalized run lengths [space, bar, space, bar]
const G_PATTERNS = [
  [1, 1, 2, 3], // 0
  [1, 2, 2, 2], // 1
  [2, 2, 1, 2], // 2
  [1, 1, 4, 1], // 3
  [2, 3, 1, 1], // 4
  [1, 3, 2, 1], // 5
  [4, 1, 1, 1], // 6
  [2, 1, 3, 1], // 7
  [3, 1, 2, 1], // 8
  [2, 1, 1, 3], // 9
];

// First digit parity map for EAN-13
const PARITY_MAP = [
  'LLLLLL', // 0
  'LLGLGG', // 1
  'LLGGLG', // 2
  'LLGGGL', // 3
  'LGLLGG', // 4
  'LGGLLG', // 5
  'LGGGLL', // 6
  'LGLGLG', // 7
  'LGLGGL', // 8
  'LGGLGL', // 9
];

export function cleanBarcode(raw) {
  if (!raw) return '';
  return String(raw).trim().replace(/[^0-9A-Za-z]/g, '');
}

export function isValidEAN13(digits) {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digits[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[12]);
}

export function isValidUPCA(digits) {
  if (!/^\d{12}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const d = Number(digits[i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[11]);
}

export function isValidBarcode(str) {
  const clean = cleanBarcode(str);
  if (!clean || clean.length < 4) return false;
  if (clean.length === 13) return isValidEAN13(clean);
  if (clean.length === 12) return isValidUPCA(clean);
  return /^[\dA-Za-z\- ]{6,32}$/.test(clean);
}

// Helper: match 4 runs against patterns with tolerance
function matchDigit(runs, patterns) {
  const total = runs[0] + runs[1] + runs[2] + runs[3];
  if (total === 0) return { digit: -1, diff: Infinity };

  let bestDigit = -1;
  let minDiff = Infinity;

  for (let d = 0; d < 10; d++) {
    const target = patterns[d];
    let diff = 0;
    for (let p = 0; p < 4; p++) {
      const expected = (target[p] / 7) * total;
      diff += Math.abs(runs[p] - expected);
    }
    if (diff < minDiff) {
      minDiff = diff;
      bestDigit = d;
    }
  }

  // Normalize error relative to total width
  const normalizedDiff = minDiff / total;
  return { digit: bestDigit, diff: normalizedDiff };
}

// Decode EAN-13 / UPC-A from run-length encoded bars & spaces
function decodeEANFromRuns(runs) {
  if (runs.length < 59) return null;

  for (let i = 0; i <= runs.length - 59; i++) {
    // Check start guard: bar (1), space (0), bar (1)
    if (runs[i].bit !== 1 || runs[i + 1].bit !== 0 || runs[i + 2].bit !== 1) continue;

    const guardWidth = runs[i].length + runs[i + 1].length + runs[i + 2].length;
    const unit = guardWidth / 3;
    if (unit < 0.5) continue;

    // Check center guard at i + 3 + 24 = i + 27: space (0), bar (1), space (0), bar (1), space (0)
    const cg = i + 27;
    if (
      runs[cg].bit !== 0 ||
      runs[cg + 1].bit !== 1 ||
      runs[cg + 2].bit !== 0 ||
      runs[cg + 3].bit !== 1 ||
      runs[cg + 4].bit !== 0
    ) continue;

    // Check end guard at i + 27 + 5 + 24 = i + 56: bar (1), space (0), bar (1)
    const eg = i + 56;
    if (runs[eg].bit !== 1 || runs[eg + 1].bit !== 0 || runs[eg + 2].bit !== 1) continue;

    // Decode 6 left digits (starts at i + 3)
    let leftParity = '';
    const leftDigits = [];
    let leftValid = true;

    for (let d = 0; d < 6; d++) {
      const idx = i + 3 + d * 4;
      const digitRuns = [runs[idx].length, runs[idx + 1].length, runs[idx + 2].length, runs[idx + 3].length];
      const matchL = matchDigit(digitRuns, L_PATTERNS);
      const matchG = matchDigit(digitRuns, G_PATTERNS);

      if (matchL.diff > 0.45 && matchG.diff > 0.45) {
        leftValid = false;
        break;
      }

      if (matchL.diff <= matchG.diff) {
        leftParity += 'L';
        leftDigits.push(matchL.digit);
      } else {
        leftParity += 'G';
        leftDigits.push(matchG.digit);
      }
    }
    if (!leftValid) continue;

    // Determine first digit from parity map
    const firstDigit = PARITY_MAP.indexOf(leftParity);
    if (firstDigit === -1) continue;

    // Decode 6 right digits (starts at i + 32, using L_PATTERNS because R-code has same run lengths)
    const rightDigits = [];
    let rightValid = true;

    for (let d = 0; d < 6; d++) {
      const idx = i + 32 + d * 4;
      const digitRuns = [runs[idx].length, runs[idx + 1].length, runs[idx + 2].length, runs[idx + 3].length];
      const matchR = matchDigit(digitRuns, L_PATTERNS);
      if (matchR.diff > 0.45) {
        rightValid = false;
        break;
      }
      rightDigits.push(matchR.digit);
    }
    if (!rightValid) continue;

    const full13 = [firstDigit, ...leftDigits, ...rightDigits].join('');
    if (isValidEAN13(full13)) {
      return full13;
    }
  }

  return null;
}

export function decode1DBarcodeFromImageData(imageData) {
  const { width, height, data } = imageData;
  if (!width || !height) return null;

  // Sample multiple horizontal scanlines
  const sampleYs = [0.5, 0.45, 0.55, 0.38, 0.62, 0.3, 0.7].map((p) => Math.floor(height * p));

  for (const y of sampleYs) {
    const lineStart = y * width * 4;
    const luminances = new Uint8Array(width);
    let minL = 255;
    let maxL = 0;

    for (let x = 0; x < width; x++) {
      const idx = lineStart + x * 4;
      const lum = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
      luminances[x] = lum;
      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;
    }

    if (maxL - minL < 35) continue;

    const threshold = (minL + maxL) / 2;
    const bits = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      bits[x] = luminances[x] < threshold ? 1 : 0;
    }

    // Build runs
    const runs = [];
    let currentBit = bits[0];
    let currentLen = 1;
    for (let x = 1; x < width; x++) {
      if (bits[x] === currentBit) {
        currentLen++;
      } else {
        runs.push({ bit: currentBit, length: currentLen });
        currentBit = bits[x];
        currentLen = 1;
      }
    }
    runs.push({ bit: currentBit, length: currentLen });

    const code = decodeEANFromRuns(runs) || decodeEANFromRuns(runs.slice().reverse());
    if (code) return code;
  }

  return null;
}

// Detect barcode using native BarcodeDetector if available, falling back to 1D canvas reader
export async function detectBarcode(source) {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const formats = ['ean_13', 'upc_a', 'upc_e', 'ean_8', 'code_128', 'code_39'];
      const detector = new window.BarcodeDetector({ formats });
      const barcodes = await detector.detect(source);
      if (barcodes && barcodes.length > 0) {
        return cleanBarcode(barcodes[0].rawValue);
      }
    } catch {
      // Fall through to manual canvas decode
    }
  }

  // Fallback: draw source to canvas and read scanlines
  try {
    let canvas;
    if (source instanceof HTMLCanvasElement) {
      canvas = source;
    } else {
      canvas = document.createElement('canvas');
      const w = source.videoWidth || source.naturalWidth || source.width || 640;
      const h = source.videoHeight || source.naturalHeight || source.height || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(source, 0, 0, w, h);
      }
    }
    const ctx = canvas.getContext('2d');
    if (ctx && canvas.width && canvas.height) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = decode1DBarcodeFromImageData(imgData);
      if (decoded) return decoded;
    }
  } catch {
    // Canvas read failed (e.g. tainted canvas or unready video)
  }

  return null;
}

export async function searchDiscogsBarcode(barcode) {
  const cleaned = cleanBarcode(barcode);
  if (!cleaned) throw new Error('Please enter a valid barcode');

  const res = await discogsFetch(`/database/search?barcode=${encodeURIComponent(cleaned)}&type=release`);
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Discogs search error (${res.status})`);
  }
  const data = await res.json();
  return (data.results || []).map((item) => {
    let artist = '';
    let album = item.title || 'Untitled';
    if (item.title && item.title.includes(' - ')) {
      const parts = item.title.split(' - ');
      artist = parts[0].trim();
      album = parts.slice(1).join(' - ').trim();
    }
    return {
      id: item.id,
      title: item.title || 'Untitled',
      artist,
      album,
      year: item.year || '',
      country: item.country || '',
      format: Array.isArray(item.format) ? item.format.join(', ') : (item.format || ''),
      label: Array.isArray(item.label) ? item.label.join(', ') : (item.label || ''),
      catno: item.catno || '',
      thumb: item.thumb || item.cover_image || '',
      coverImage: item.cover_image || item.thumb || '',
      inCollection: Boolean(item.user_data?.in_collection),
      inWantlist: Boolean(item.user_data?.in_wantlist),
      masterId: item.master_id || null,
      barcode: item.barcode || [cleaned],
    };
  });
}

export async function addReleaseToCollection(username, releaseId, folderId = 1) {
  if (!username) throw new Error('Not connected to Discogs');
  const res = await discogsFetch(`/users/${encodeURIComponent(username)}/collection/folders/${folderId}/releases/${releaseId}`, {
    method: 'POST',
  });
  if (!res.ok && res.status !== 201) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Could not add to collection (${res.status})`);
  }
  return await res.json().catch(() => ({ instance_id: null }));
}
