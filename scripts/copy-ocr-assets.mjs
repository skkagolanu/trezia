#!/usr/bin/env node
// tesseract.js defaults to loading its worker, wasm cores, and language model
// from the jsdelivr CDN at runtime. This app's CSP forbids third-party script
// origins, so those assets must be served from public/tesseract/ instead.
// This script copies them out of node_modules at install/build time.
// public/tesseract/ is gitignored — this script is the only thing that populates it.
//
// All three `-lstm` core variants are copied because
// tesseract.js/src/worker-script/browser/getCore.js picks one at RUNTIME via
// wasm-feature-detect (relaxed-SIMD, then SIMD, then plain) — each device
// downloads exactly one. Only `-lstm` variants are needed because
// Tesseract.recognize hard-codes OEM 1 (LSTM_ONLY). The wasm binary is
// base64-embedded inside each `.wasm.js`, so there is no separate `.wasm` file.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed relative to this file, not process.cwd(), so the script works
// regardless of which directory it's invoked from (npm scripts, CI, etc).
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const nodeModules = join(repoRoot, 'node_modules');
const destRoot = join(repoRoot, 'public', 'tesseract');

const manifest = [
  {
    src: join(nodeModules, 'tesseract.js', 'dist', 'worker.min.js'),
    dest: join(destRoot, 'worker.min.js'),
  },
  {
    src: join(nodeModules, 'tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    dest: join(destRoot, 'core', 'tesseract-core-relaxedsimd-lstm.wasm.js'),
  },
  {
    src: join(nodeModules, 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'),
    dest: join(destRoot, 'core', 'tesseract-core-simd-lstm.wasm.js'),
  },
  {
    src: join(nodeModules, 'tesseract.js-core', 'tesseract-core-lstm.wasm.js'),
    dest: join(destRoot, 'core', 'tesseract-core-lstm.wasm.js'),
  },
  {
    src: join(nodeModules, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'),
    dest: join(destRoot, 'lang', 'eng.traineddata.gz'),
  },
];

// All paths above are built from fixed, hardcoded segments — never from
// user input or argv — so non-literal fs access here is safe.

const missing = manifest.filter(({ src }) => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return !existsSync(src);
});
if (missing.length > 0) {
  console.error('Missing OCR asset source file(s):');
  for (const { src } of missing) console.error(`  ${src}`);
  console.error(
    '\nA tesseract.js / tesseract.js-core / @tesseract.js-data/eng version bump ' +
      'likely moved these paths. Update the manifest in scripts/copy-ocr-assets.mjs to match.'
  );
  process.exit(1);
}

for (const dir of [destRoot, join(destRoot, 'core'), join(destRoot, 'lang')]) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function fileSize(path) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return statSync(path).size;
}

for (const { src, dest } of manifest) {
  const srcSize = fileSize(src);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const unchanged = existsSync(dest) && fileSize(dest) === srcSize;
  if (unchanged) {
    console.log(`unchanged  ${dest}`);
    continue;
  }
  await copyFile(src, dest);
  console.log(`copied     ${dest}`);
}

function totalBytes(dir) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readdirSync(dir).reduce((sum, name) => {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stat = statSync(path);
    return sum + (stat.isDirectory() ? totalBytes(path) : stat.size);
  }, 0);
}

console.log(`\npublic/tesseract/ ready — ${totalBytes(destRoot).toLocaleString()} bytes total.`);
