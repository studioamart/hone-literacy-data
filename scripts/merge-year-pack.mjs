#!/usr/bin/env node
/** Merge the reviewed 365-reading authoring pack into the schema-1 OTA file. */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK_DIR = join(ROOT, 'content', 'year-of-readings-2026');
const DEFAULT_DATA_PATH = join(ROOT, 'data', 'passages.json');
const PACK_ID = /^og-y26-d(\d{3})-/;
const TARGET_VERSION = 12;

function parseArgs(argv) {
  const options = { input: DEFAULT_DATA_PATH, output: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--input' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      options[argument.slice(2)] = isAbsolute(value) ? value : resolve(process.cwd(), value);
      index += 1;
    } else if (argument === '--help') {
      console.log('Usage: node scripts/merge-year-pack.mjs [--dry-run] [--input PATH] [--output PATH]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.output === null) options.output = options.input;
  return options;
}

const options = parseArgs(process.argv.slice(2));

// Keep the merge from bypassing the stricter editorial/schema contract.
execFileSync('python3', [join(ROOT, 'scripts', 'validate-year-pack.py')], {
  cwd: ROOT,
  stdio: 'inherit',
});

const batchNames = readdirSync(PACK_DIR)
  .filter((name) => /^batch-\d+[a-z]?\.json$/.test(name))
  .sort();

const pack = batchNames.flatMap((name) => {
  const parsed = JSON.parse(readFileSync(join(PACK_DIR, name), 'utf8'));
  return parsed.passages;
});

pack.sort((a, b) => Number(a.id.match(PACK_ID)[1]) - Number(b.id.match(PACK_ID)[1]));

const data = JSON.parse(readFileSync(options.input, 'utf8'));
if (data.schema !== 1 || !Array.isArray(data.passages)) {
  throw new Error('data/passages.json is not a schema-1 corpus.');
}
if (![TARGET_VERSION - 1, TARGET_VERSION].includes(data.version)) {
  throw new Error(
    `Expected corpus version ${TARGET_VERSION - 1} or ${TARGET_VERSION}, found ${data.version}. ` +
    'Rebase the pack and choose a new OTA version before merging.'
  );
}

// Idempotent for review iterations: replace an earlier copy of this pack while
// preserving every passage whose ID belongs to another release.
const preserved = data.passages.filter((passage) => !PACK_ID.test(passage.id));
const preservedIDs = new Set(preserved.map((passage) => passage.id));
const collision = pack.find((passage) => preservedIDs.has(passage.id));
if (collision) throw new Error(`Pack id collides with existing passage: ${collision.id}`);

data.version = TARGET_VERSION;
data.passages = [...preserved, ...pack];
if (!options.dryRun) writeFileSync(options.output, JSON.stringify(data, null, 2) + '\n');

const questions = data.passages.reduce((sum, passage) => sum + passage.questions.length, 0);
console.log(
  `${options.dryRun ? 'Would merge' : 'Merged'} ${pack.length} readings from ${batchNames.length} batch file(s): ` +
  `corpus v${data.version}, ${data.passages.length} readings, ${questions} questions.`
);
