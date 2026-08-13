#!/usr/bin/env node
/**
 * Authoring helper for adding a reading passage to data/passages.json.
 *
 * Usage:
 *   node scripts/new-passage.mjs --id my-passage-id --title "My Title" \
 *        --source-type original --genre nonfiction --level 3 \
 *        --text "Full passage text here..." [--source "..."] [--attribution "..."]
 *
 * It computes wordCount automatically, stamps today's date as `releasedAt`,
 * appends a passage skeleton with one placeholder question (which you then fill
 * in), validates the file, and leaves data/passages.json ready for
 * `node scripts/build-manifest.mjs`.
 *
 * `releasedAt` (yyyy-MM-dd) gives a passage a 30-day New tag in current Fluency
 * builds; it does not schedule or hide content. Pass `--released-at YYYY-MM-DD`
 * to record another real publication date, or `--released-at none` to omit the
 * tag metadata. Older schema-1 builds may still treat a recent date as a
 * Pro-first gate, so do not use future dates to preload scheduled content.
 *
 * Content rules (keep IP clean):
 *   - source-type "public-domain": only pre-1929 / verified public-domain text.
 *     Fill `source` and `attribution` precisely.
 *   - source-type "original": written for Fluency (human or AI-assisted,
 *     human-reviewed). attribution defaults to a Studio AM line.
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

// Local calendar day, not toISOString() — the app parses this as a calendar day
// and a UTC stamp would read as "tomorrow" for an evening drop in the Americas.
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const releasedAtArg = arg('released-at', today());
const releasedAt = releasedAtArg === 'none' ? null : releasedAtArg;
if (releasedAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(releasedAt)) {
  console.error('--released-at must be YYYY-MM-DD (or "none" to omit New-tag metadata).');
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
  source: arg('source', sourceType === 'original' ? 'Written for Fluency' : ''),
  attribution: arg(
    'attribution',
    sourceType === 'original' ? 'Original passage © Studio AM, written for Fluency.' : ''
  ),
  genre,
  level,
  wordCount,
  // Omitted entirely when "none": the passage receives no date-based New tag.
  ...(releasedAt ? { releasedAt } : {}),
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
  `Added "${id}" (${wordCount} words${releasedAt ? `, released ${releasedAt}` : ', no release date'}); ` +
  `bumped version to ${data.version}. ` +
  `Fill in its questions, then run:\n  node scripts/build-manifest.mjs`
);
