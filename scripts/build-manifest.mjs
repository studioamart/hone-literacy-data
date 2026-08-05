#!/usr/bin/env node
/**
 * Rebuilds data/manifest.json from data/passages.json.
 *
 * - The `version` field inside passages.json is authoritative: bump it whenever
 *   you change the data (the app stores this same number and re-downloads only
 *   when the remote version is higher). This script copies it into the manifest
 *   and refuses to publish a content change that forgot to bump it.
 * - Computes the sha256 of the data file (the app verifies it after download).
 * - Validates the optional per-passage `releasedAt` (yyyy-MM-dd), which drives
 *   the app's Pro-first window: a passage stays Pro-only for its first 30 days,
 *   then joins the general corpus on its own. The field is OPTIONAL — passages
 *   without it are free-eligible immediately, which is how the whole corpus
 *   behaved before content packs existed.
 * - Passes through the optional data/free-limits.json as the manifest's
 *   `freeLimits`, so the free tier can be resized without an App Store release.
 *   Absent file = no key in the manifest = the app's bundled defaults.
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
// OPTIONAL. Absent is the normal state: no file means no `freeLimits` key in
// the manifest, which means the app uses the limits it shipped with.
const FREE_LIMITS_PATH = join(ROOT, 'data', 'free-limits.json');

// Public Pages URL where the app fetches the data from. Must match the LIVE
// hosting org (studioamart) — the legacy support-teamam URL still serves a
// stale v3 corpus with pre-rebrand strings, and a manifest pointing there
// makes every refresh fail its sha256 check.
const DATA_URL = 'https://studioamart.github.io/hone-literacy-data/data/passages.json';
// Bump this only if the JSON shape changes incompatibly. Older app builds
// ignore remote data whose schema is newer than they understand.
//
// `releasedAt` did NOT bump this: it is an optional additive key, older builds
// decode right past it, and its absence means exactly what it always meant.
const SCHEMA_VERSION = 1;
// Must match PassageStore.proWindowDays in the app. Used only to report how
// much of a drop is still Pro-first at publish time; the app is the authority.
const PRO_WINDOW_DAYS = 30;
// The free-tier limits this repo may publish, and the floors they may not go
// under — mirrors FreeLimits in the app (minWorkoutPerDay / minFreePoolSize).
// The app clamps to these floors anyway; failing here is the point, so a bad
// number is caught by the person publishing it instead of silently landing on
// every free reader and being quietly corrected.
const FREE_LIMIT_FLOORS = { workoutPerDay: 1, freePoolSize: 20 };

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
let proFirstCount = 0;
const nowMs = Date.now();
for (const p of passages) {
  if (!p.id || !p.title || typeof p.text !== 'string' || p.text.length < 40) {
    console.error(`Passage "${p.id ?? '?'}" missing id/title/text.`);
    process.exit(1);
  }
  // Optional. A malformed date is rejected rather than silently ignored: the
  // app reads an unparseable date as "no date", which would quietly publish a
  // Pro-first drop as free on day one.
  if (p.releasedAt !== undefined) {
    if (typeof p.releasedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.releasedAt)) {
      console.error(`Passage "${p.id}" has a malformed releasedAt "${p.releasedAt}" (expected YYYY-MM-DD).`);
      process.exit(1);
    }
    const released = Date.parse(`${p.releasedAt}T00:00:00Z`);
    if (Number.isNaN(released)) {
      console.error(`Passage "${p.id}" has an impossible releasedAt "${p.releasedAt}".`);
      process.exit(1);
    }
    if ((nowMs - released) / 86400000 < PRO_WINDOW_DAYS) proFirstCount++;
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

// Optional free-tier limits. Hard-fails on anything malformed, exactly like a
// bad `releasedAt`: the app is deliberately forgiving (an unreadable value there
// reads as "use the bundled default"), so a typo would publish as a silent no-op
// and the experiment would look like it had no effect.
const freeLimits = readFreeLimits();

function readFreeLimits() {
  if (!existsSync(FREE_LIMITS_PATH)) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(FREE_LIMITS_PATH, 'utf8'));
  } catch (e) {
    console.error('data/free-limits.json is not valid JSON:', e.message);
    process.exit(1);
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    console.error('data/free-limits.json must be a JSON object.');
    process.exit(1);
  }
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    const floor = FREE_LIMIT_FLOORS[key];
    if (floor === undefined) {
      console.error(
        `data/free-limits.json has an unknown key "${key}" ` +
        `(expected: ${Object.keys(FREE_LIMIT_FLOORS).join(', ')}).`);
      process.exit(1);
    }
    if (!Number.isInteger(value)) {
      console.error(`data/free-limits.json "${key}" must be a whole number, got ${JSON.stringify(value)}.`);
      process.exit(1);
    }
    if (value < floor) {
      console.error(`data/free-limits.json "${key}" is ${value}; the floor is ${floor}.`);
      process.exit(1);
    }
    out[key] = value;
  }
  // An empty object would publish a key that says nothing; omit it so "absent"
  // has exactly one representation on the wire.
  return Object.keys(out).length > 0 ? out : null;
}

let prev = null;
if (existsSync(MANIFEST_PATH)) {
  try { prev = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* ignore */ }
}

// A limits-only push changes NO passage bytes, so the sha256 short-circuit has
// to notice the limits too — otherwise the one kind of change this file exists
// for could never be published.
const limitsChanged =
  JSON.stringify(prev?.freeLimits ?? null) !== JSON.stringify(freeLimits);

if (prev && prev.sha256 === sha256 && prev.schema === SCHEMA_VERSION && !limitsChanged) {
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
  // Optional and additive — omitted entirely when there is no config, so older
  // builds see the manifest they have always seen. Did NOT bump SCHEMA_VERSION.
  ...(freeLimits ? { freeLimits } : {}),
  generatedAt: new Date().toISOString(),
};

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Wrote manifest version ${manifest.version} ` +
  `(${passageCount} passages, ${questionCount} questions, sha256 ${sha256.slice(0, 12)}…).`
);
console.log(
  proFirstCount > 0
    ? `${proFirstCount} passage(s) are inside the ${PRO_WINDOW_DAYS}-day Pro-first window.`
    : 'No passages are inside the Pro-first window — this drop is free-eligible on arrival.'
);
console.log(
  freeLimits
    ? `Free-tier limits published: ${JSON.stringify(freeLimits)} (omitted keys stay at the app's defaults).`
    : 'No free-tier limits published — the app uses the limits it shipped with.'
);
