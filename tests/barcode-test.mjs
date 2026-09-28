// tests/barcode-test.mjs - Unit tests for barcode validation, cleaning, and 1D decoding.
import assert from 'node:assert/strict';
import { cleanBarcode, isValidEAN13, isValidUPCA, isValidBarcode, decode1DBarcodeFromImageData } from '../public/js/barcode.js';

// 1. Cleaning barcodes
assert.equal(cleanBarcode('0 7559-60861-1 3'), '075596086113');
assert.equal(cleanBarcode('  5099748508412 \n'), '5099748508412');
assert.equal(cleanBarcode(''), '');
assert.equal(cleanBarcode(null), '');

// 2. EAN-13 validation
assert.equal(isValidEAN13('4006381333931'), true, 'Valid Stabilo EAN-13');
assert.equal(isValidEAN13('4006381333932'), false, 'Bad checksum');
assert.equal(isValidEAN13('12345'), false, 'Too short');
assert.equal(isValidEAN13('0398414000210'), false);

// 3. UPC-A validation
assert.equal(isValidUPCA('039841400021'), true, 'Valid UPC-A');
assert.equal(isValidUPCA('039841400022'), false, 'Bad checksum');
assert.equal(isValidUPCA('123'), false);

// 4. General barcode validation
assert.equal(isValidBarcode('4006381333931'), true);
assert.equal(isValidBarcode('039841400021'), true);
assert.equal(isValidBarcode('0 3984-14000-2 1'), true);
assert.equal(isValidBarcode('12'), false);

// 5. Decoding a synthetic EAN-13 image buffer
// EAN-13 for 4006381333931:
// 4 -> parity LGLLGG
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011'
];
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011011', // Wait: 4 is 0011101
  '0111001', '0000101', '0010001', '0001001', '0010111'
];
const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100'
];

// Let's build bit string for 4006381333931:
// Left digits: 0 (L), 0 (G), 6 (L), 3 (L), 8 (G), 1 (G)
// Right digits: 3, 3, 3, 9, 3, 1 (all R)
const G_CORRECT = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111'
];

let bits = '00000000'; // Quiet zone
bits += '101'; // Start guard
bits += L[0]; // 0 (L)
bits += G_CORRECT[0]; // 0 (G)
bits += L[6]; // 6 (L)
bits += L[3]; // 3 (L)
bits += G_CORRECT[8]; // 8 (G)
bits += G_CORRECT[1]; // 1 (G)
bits += '01010'; // Center guard
bits += R[3]; // 3
bits += R[3]; // 3
bits += R[3]; // 3
bits += R[9]; // 9
bits += R[3]; // 3
bits += R[1]; // 1
bits += '101'; // End guard
bits += '00000000'; // Quiet zone

// Scale bits to image with module width = 3px, height = 40px
const scale = 3;
const imgWidth = bits.length * scale;
const imgHeight = 40;
const pixelData = new Uint8ClampedArray(imgWidth * imgHeight * 4);

for (let y = 0; y < imgHeight; y++) {
  for (let x = 0; x < imgWidth; x++) {
    const bitIndex = Math.floor(x / scale);
    const bit = bits[bitIndex] === '1';
    const color = bit ? 0 : 255; // 0 = black, 255 = white
    const idx = (y * imgWidth + x) * 4;
    pixelData[idx] = color;
    pixelData[idx + 1] = color;
    pixelData[idx + 2] = color;
    pixelData[idx + 3] = 255;
  }
}

const decoded = decode1DBarcodeFromImageData({ width: imgWidth, height: imgHeight, data: pixelData });
assert.equal(decoded, '4006381333931', 'Successfully decoded synthetic EAN-13 barcode');

console.log('Barcode tests passed.');
