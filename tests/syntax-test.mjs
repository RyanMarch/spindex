// Every source file must at least parse. (`node --check` only looks at one file per run, so check each on its own.)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(m?js)$/.test(entry.name) ? [full] : [];
  });
}

const files = ['public', 'functions', 'tests'].flatMap((dir) => sourceFiles(path.join(root, dir)));
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`Syntax error in ${path.relative(root, file)}:\n${err.stderr}`);
  }
}
if (failed > 0) process.exit(1);
console.log(`Syntax OK (${files.length} files).`);
