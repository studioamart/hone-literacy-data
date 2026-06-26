#!/usr/bin/env node
/**
 * Rebuilds data/manifest.json from data/passages.json.
 *
 * - The `version` field inside passages.json is authoritative: bump it whenever
 *   you change the data (the app stores this same number and re-downloads only
 *   when the remote version is higher). This script copies it into the manifest
 *   and refuses to publish a content change that forgot to bump it.
 * - Computes the sha256 of the data file (the app verifies it after download).
 *
 * Run locally:  node scripts/build-manifest.mjs
 * In CI:        invoked by .github/workflows/update-data.yml
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = join(ROOT, 'data', 'passages.json');
const MANIFEST_PATH = join(ROOT, 'data', 'manifest.json');

// Public Pages URL where the app fetches the data from.
const DATA_URL = 'https://support-teamam.github.io/honeliteracy-data/data/passages.json';
// Bump this only if the JSON shape changes incompatibly. Older app builds
// ignore remote data whose schema is newer than they understand.
const SCHEMA_VERSION = 1;

const raw = readFileSync(DATA_PATH);
const sha256 = createHash('sha256').update(raw).digest('hex');

let parsed;
try {
  parsed = JSON.parse(raw.toString('utf8'));
} catch (e) {
  console.error('passages.json is not valid JSON:', e.message);
  process.exit(1);
}

const passages = Array.isArray(parsed.passages) ? parsed.passages : [];
const passageCount = passages.length;
if (passageCount === 0) {
  console.error('Refusing to publish: passages array is empty.');
  process.exit(1);
}

// Structural validation: every passage needs text + at least one well-formed
// question whose `answer` indexes into its `choices`.
let questionCount = 0;
for (const p of passages) {
  if (!p.id || !p.title || typeof p.text !== 'string' || p.text.length < 40) {
    console.error(`Passage "${p.id ?? '?'}" missing id/title/text.`);
    process.exit(1);
  }
  if (!Array.isArray(p.questions) || p.questions.length === 0) {
    console.error(`Passage "${p.id}" has no questions.`);
    process.exit(1);
  }
  for (const q of p.questions) {
    if (!Array.isArray(q.choices) || q.choices.length < 2) {
      console.error(`Question "${q.id}" in "${p.id}" needs >= 2 choices.`);
      process.exit(1);
    }
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.choices.length) {
      console.error(`Question "${q.id}" in "${p.id}" has an out-of-range answer.`);
      process.exit(1);
    }
    questionCount++;
  }
}

const version = parsed.version;
if (typeof version !== 'number' || version < 1) {
  console.error('passages.json must carry a numeric "version" >= 1.');
  process.exit(1);
}

let prev = null;
if (existsSync(MANIFEST_PATH)) {
  try { prev = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* ignore */ }
}

if (prev && prev.sha256 === sha256 && prev.schema === SCHEMA_VERSION) {
  console.log(`No change (sha256 matches, version ${prev.version}). Nothing to do.`);
  process.exit(0);
}

// Guard: content changed but the author forgot to bump passages.json "version".
// Shipping a new sha under an old version means apps never fetch the update.
if (prev && prev.sha256 !== sha256 && prev.version === version) {
  console.error(
    `Content changed but version is still ${version}. Bump "version" in ` +
    `data/passages.json (to ${version + 1}) before publishing.`);
  process.exit(1);
}

const manifest = {
  schema: SCHEMA_VERSION,
  version,
  url: DATA_URL,
  sha256,
  passageCount,
  questionCount,
  generatedAt: new Date().toISOString(),
};

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Wrote manifest version ${manifest.version} ` +
  `(${passageCount} passages, ${questionCount} questions, sha256 ${sha256.slice(0, 12)}…).`
);
