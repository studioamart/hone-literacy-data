#!/usr/bin/env node
/**
 * Authoring helper for adding a reading passage to data/passages.json.
 *
 * Usage:
 *   node scripts/new-passage.mjs --id my-passage-id --title "My Title" \
 *        --source-type original --genre nonfiction --level 3 \
 *        --text "Full passage text here..." [--source "..."] [--attribution "..."]
 *
 * It computes wordCount automatically, appends a passage skeleton with one
 * placeholder question (which you then fill in), validates the file, and leaves
 * data/passages.json ready for `node scripts/build-manifest.mjs`.
 *
 * Content rules (keep IP clean):
 *   - source-type "public-domain": only pre-1929 / verified public-domain text.
 *     Fill `source` and `attribution` precisely.
 *   - source-type "original": written for Hone Literacy (human or AI-assisted,
 *     human-reviewed). attribution defaults to a Team AM line.
 * Questions: skills are one of main-idea | inference | vocabulary | detail.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = join(ROOT, 'data', 'passages.json');

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const id = arg('id');
const title = arg('title');
const text = arg('text');
const sourceType = arg('source-type', 'original');
const genre = arg('genre', 'nonfiction');
const level = Number(arg('level', '3'));

if (!id || !title || !text) {
  console.error('Required: --id, --title, --text. See header for full usage.');
  process.exit(1);
}
if (!['public-domain', 'original'].includes(sourceType)) {
  console.error('--source-type must be "public-domain" or "original".');
  process.exit(1);
}
if (!(level >= 1 && level <= 5)) {
  console.error('--level must be 1..5.');
  process.exit(1);
}

const wordCount = text.trim().split(/\s+/).length;
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
if (data.passages.some((p) => p.id === id)) {
  console.error(`Passage id "${id}" already exists.`);
  process.exit(1);
}

data.passages.push({
  id,
  title,
  sourceType,
  source: arg('source', sourceType === 'original' ? 'Written for Hone Literacy' : ''),
  attribution: arg(
    'attribution',
    sourceType === 'original' ? 'Original passage © Team AM, written for Hone Literacy.' : ''
  ),
  genre,
  level,
  wordCount,
  text: text.trim(),
  questions: [
    {
      id: 'q1',
      skill: 'main-idea',
      stem: 'TODO: write the question stem',
      choices: ['TODO correct', 'TODO', 'TODO', 'TODO'],
      answer: 0,
      explanation: 'TODO: explain why the answer is correct.',
    },
  ],
});

// Bump the authoritative version so build-manifest publishes the change.
data.version = (typeof data.version === 'number' ? data.version : 0) + 1;

writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
console.log(
  `Added "${id}" (${wordCount} words); bumped version to ${data.version}. ` +
  `Fill in its questions, then run:\n  node scripts/build-manifest.mjs`
);
