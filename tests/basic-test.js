import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

// Verify directory structure
assert.ok(fs.existsSync(path.join(root, 'public/index.html')), 'public/index.html must exist');
assert.ok(fs.existsSync(path.join(root, 'wrangler.toml')), 'wrangler.toml must exist');
assert.ok(fs.existsSync(path.join(root, '.gitignore')), '.gitignore must exist');

console.log('All basic tests passed.');
