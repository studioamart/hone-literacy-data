#!/usr/bin/env node
/**
 * Insert reviewed paragraph breaks into the 60 legacy passages that remained
 * single blocks in the v12 candidate.
 *
 * The ID-keyed markers below are sentence endings chosen by editorial review;
 * there is no automatic sentence splitting or prose rewriting. The script
 * accepts either the original single-block state or its exact repaired state.
 * Any changed source prose, unreviewed one-paragraph passage, alternate break
 * layout, missing marker, or split lesson signal fails closed.
 *
 * By default this targets data/passages.json. Use --dry-run to validate without
 * writing, or --input/--output to exercise it on a copy first.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = join(ROOT, 'data', 'passages.json');
const YEAR_PACK_ID = /^og-y26-d\d{3}-/;
const EXPECTED_LEGACY_COUNT = 286;
const EXPECTED_SOURCE_DIGEST = 'e3aa2f8b9f5d82e586d3b329bbeec8b859fcf6e86b7e037439e12b5060d4301a';

// Each marker is a unique suffix ending at the reviewed sentence boundary.
// Marker order is paragraph order. Only the following space is replaced by a
// blank line; all words and punctuation remain byte-for-byte identical.
const REVIEWED_BREAKS = new Map([
  ['pd-aesop-ant-grasshopper', [
    'But the Ant went on its way and continued its toil.',
  ]],
  ['pd-lincoln-gettysburg', [
    'dedicated to the proposition that all men are created equal.',
    'those who here gave their lives that that nation might live.',
  ]],
  ['pd-darwin-entangled-bank', [
    'have all been produced by laws acting around us.',
    'the Extinction of less-improved forms.',
  ]],
  ['pd-wells-time-machine', [
    'his usually pale face was flushed and animated.',
    'said Filby, an argumentative person with red hair.',
  ]],
  ['pd-aurelius-morning', [
    'But this is more pleasant.',
  ]],
  ['pd-doyle-scandal-opening', [
    "excellent for drawing the veil from men's motives and actions.",
  ]],
  ['og-attention-economy', [
    'skim, react, move on.',
    'feeds quietly let atrophy.',
  ]],
  ['og-ai-and-the-reader', [
    'for some purposes that is enough.',
    'keeps the understanding for the machine.',
  ]],
  ['og-how-memory-consolidates', [
    'the material was reorganized while you rested.',
  ]],
  ['pd-twain-mississippi', [
    'it had a new story to tell every day.',
  ]],
  ['pd-austen-pride-opening', [
    'some one or other of their daughters.',
    'Mr. Bennet replied that he had not.',
  ]],
  ['og-deep-vs-shallow-reading', [
    'we do it dozens of times a day.',
    'but only one of them grows with practice.',
  ]],
  ['pd-douglass-learning-to-read', [
    'it was unlawful, as well as unsafe, to teach a slave to read.',
    'but struggled in vain.',
  ]],
  ['pd-plato-cave', [
    'shadows of these images cast upon the wall before them.',
  ]],
  ['og-fic-last-bus', [
    'the rain starting again.',
  ]],
  ['og-fic-the-spare-key', [
    'he did not panic.',
    'smiled at the screen.',
  ]],
  ['og-fic-tide-pool', [
    'let the silence do its slow work.',
    'His grandmother nodded slowly.',
  ]],
  ['og-fic-the-understudy', [
    'most evenings she almost believed it.',
    'mouthing the opening speech under her breath.',
    'never let herself say out loud.',
  ]],
  ['og-fic-snow-day', [
    'went back to sleep.',
    'knelt beside him without a word.',
  ]],
  ['og-fic-the-lighthouse-keeper', [
    "old man's company in the dark.",
    'the absence of disaster is the hardest kind of work to see.',
  ]],
  ['og-fic-the-borrowed-coat', [
    'because the truth was complicated.',
    'Reza had nearly refused.',
  ]],
  ['og-phi-the-weight-of-attention', [
    'the worry in our chest, the noise of the street.',
    'but a measure of freedom.',
  ]],
  ['og-phi-the-uses-of-boredom', [
    'a problem to be solved as quickly as possible.',
    'the couch becomes a ship.',
  ]],
  ['og-ess-small-courage', [
    'other, harder situations.',
    'everyone around you is saying yes.',
  ]],
  ['og-sci-moon-tides', [
    'caused mostly by the Moon.',
    'high tide and low tide arrive at regular times.',
  ]],
  ['og-sci-honeybee-dance', [
    'then loops back to repeat the pattern.',
    'distant ones produce a long, vigorous one.',
  ]],
  ['og-sci-volcano-rock', [
    'hardens into igneous rock.',
    'presses them into sedimentary rock.',
    'it has been turning for billions of years.',
  ]],
  ['og-sci-tardigrade', [
    'films of water that cling to soil.',
    'as though nothing had happened.',
  ]],
  ['og-sci-photosynthesis', [
    'a gas called carbon dioxide from the air.',
    'The process is called photosynthesis.',
  ]],
  ['og-sci-neuron-signals', [
    'down a long fiber toward its neighbors.',
    'drift across the gap and pass the message along.',
  ]],
  ['og-sci-coral-reef', [
    'the reef slowly rises.',
    'why reefs grow only in clear, sunlit waters.',
  ]],
  ['og-sci-water-cycle', [
    'called the water cycle.',
    'the journey starts over.',
  ]],
  ['og-sci-deep-sea-light', [
    'the rule rather than the exception.',
    'light has become both a weapon and a language.',
    'recognized only by their own kind.',
  ]],
  ['og-sci-greenhouse-effect', [
    'without it the planet would freeze.',
    'pushing the balance toward a warmer state.',
  ]],
  ['og-sci-spider-silk', [
    'a web can catch prey without shattering.',
    'wraps eggs in a protective case.',
  ]],
  ['og-sci-star-life-cycle', [
    'releasing enormous energy and igniting the star.',
    "the star's fate depends on its mass.",
    'the planets that circle them.',
  ]],
  ['og-l12-first-day', [
    'did not know where anything was.',
    'Nadia felt a little better.',
    'Cole just showed her how to hold it.',
  ]],
  ['og-l12-pack-light', [
    'pack light.',
    'your papers, your money, and your phone.',
  ]],
  ['og-l12-beans-and-rice', [
    'soft enough to cook.',
    'so you never grow tired of it.',
  ]],
  ['og-l12-save-a-little', [
    'You need a habit.',
    'save first, then spend the rest.',
  ]],
  ['og-l12-a-daily-walk', [
    'It costs nothing.',
    'after twenty minutes outside.',
  ]],
  ['og-l12-morning-birds', [
    'But why do birds sing so much at dawn?',
    'Females listen and choose.',
  ]],
  ['og-l12-the-food-cart', [
    'She nods and smiles.',
    'he wants them to find him there.',
  ]],
  ['og-l12-ask-the-way', [
    'too shy to ask anyone.',
    'followed her signs.',
  ]],
  ['og-l12-the-quiet-library', [
    'find a quiet corner to study.',
    'open to anyone who walks in.',
  ]],
  ['og-l12-rest-your-eyes', [
    'for too long.',
    'since it wets the eye again.',
  ]],
  ['og-l12-night-baker', [
    'bring them to life.',
    'the whole shop smells of fresh bread.',
  ]],
  ['og-l12-the-long-train', [
    'the whole land unrolled before her.',
    'the air grew thin and cold.',
    'these places she would never visit.',
  ]],
  ['og-l12-why-we-sleep', [
    'hard at work while we rest.',
    'builds up while we are awake.',
  ]],
  ['og-l12-emergency-fund', [
    'often at a high cost.',
    'it may take years.',
    'It is only for a true emergency.',
  ]],
  ['og-l12-river-otters', [
    'they will need to hunt.',
    'faster than their prey can flee.',
  ]],
  ['og-l12-street-tea', [
    'people have built countless customs.',
    'to refuse it can seem rude.',
  ]],
  ['og-l12-buying-used', [
    'can serve you just as well for far less money.',
    'look for strong joints and clean lines.',
  ]],
  ['og-l12-desert-cactus', [
    'to hold on to water.',
    'little escapes into the hot air.',
    'guard the juicy stem from thirsty animals.',
  ]],
  ['og-l12-working-from-home', [
    'it brings both gains and costs.',
    'without the noise of a busy office.',
    'shared lunches of an office.',
  ]],
  ['og-l12-jet-lag', [
    'It is set mostly by light.',
    'sleepy at noon.',
  ]],
  ['og-l12-compost-pile', [
    'through a slow, natural process called composting.',
    'dark, crumbly soil is left.',
  ]],
  ['og-l12-market-morning', [
    'jars of honey that catch the light.',
    'slip an extra plum into her bag.',
  ]],
  ['og-l12-stretch-at-desk', [
    'not to hold one shape for eight hours.',
    'you often work better after them, not worse.',
  ]],
  ['og-l12-migrating-geese', [
    'It saves the birds a great deal of energy.',
    'gets no such help.',
  ]],
]);

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: null, dryRun: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      if (seen.has(argument)) throw new Error(`${argument} may be supplied only once.`);
      seen.add(argument);
      options.dryRun = true;
    } else if (argument === '--input' || argument === '--output') {
      if (seen.has(argument)) throw new Error(`${argument} may be supplied only once.`);
      seen.add(argument);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      options[argument.slice(2)] = isAbsolute(value) ? value : resolve(process.cwd(), value);
      index += 1;
    } else if (argument === '--help') {
      console.log('Usage: node scripts/repair-legacy-paragraphs.mjs [--dry-run] [--input PATH] [--output PATH]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.output === null) options.output = options.input;
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function paragraphList(text) {
  return text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

function collapseParagraphs(text) {
  return paragraphList(text).join(' ');
}

function occurrences(haystack, needle) {
  let count = 0;
  let position = -1;
  let searchFrom = 0;
  while ((searchFrom = haystack.indexOf(needle, searchFrom)) !== -1) {
    count += 1;
    position = searchFrom;
    searchFrom += needle.length;
  }
  return { count, position };
}

if (REVIEWED_BREAKS.size !== 60) {
  throw new Error(`Internal repair table must contain 60 IDs; found ${REVIEWED_BREAKS.size}.`);
}

const options = parseArgs(process.argv.slice(2));
let data;
try {
  data = JSON.parse(readFileSync(options.input, 'utf8'));
} catch (error) {
  throw new Error(`Cannot read valid JSON from ${options.input}: ${error.message}`);
}

if (data.schema !== 1 || ![11, 12].includes(data.version) || !Array.isArray(data.passages)) {
  throw new Error(
    `Expected schema=1, version=11/12 with a passages array; ` +
    `found schema=${data.schema}, version=${data.version}.`,
  );
}

const passagesById = new Map(data.passages.map((passage) => [passage.id, passage]));
if (passagesById.size !== data.passages.length) throw new Error('Passage IDs must be unique.');

const legacyPassages = data.passages.filter((passage) => !YEAR_PACK_ID.test(passage.id));
if (legacyPassages.length !== EXPECTED_LEGACY_COUNT) {
  throw new Error(`Expected ${EXPECTED_LEGACY_COUNT} legacy passages, found ${legacyPassages.length}.`);
}

for (const id of REVIEWED_BREAKS.keys()) {
  const passage = passagesById.get(id);
  if (!passage) throw new Error(`Required reviewed passage is missing: ${id}`);
  if (YEAR_PACK_ID.test(id)) throw new Error(`Repair table must contain only legacy IDs: ${id}`);
  if (typeof passage.text !== 'string' || !passage.text.trim()) {
    throw new Error(`${id}: text must be a non-empty string.`);
  }
}

const unreviewedSingleBlocks = data.passages
  .filter((passage) => paragraphList(passage.text ?? '').length < 2 && !REVIEWED_BREAKS.has(passage.id))
  .map((passage) => passage.id);
if (unreviewedSingleBlocks.length) {
  throw new Error(`Unreviewed one-paragraph passages: ${unreviewedSingleBlocks.join(', ')}`);
}

const sourcePairs = [...REVIEWED_BREAKS.keys()].map((id) => {
  const passage = passagesById.get(id);
  return [id, collapseParagraphs(passage.text)];
});
const sourceDigest = sha256(JSON.stringify(sourcePairs));
if (sourceDigest !== EXPECTED_SOURCE_DIGEST) {
  throw new Error(
    `Reviewed source prose changed: expected digest ${EXPECTED_SOURCE_DIGEST}, found ${sourceDigest}.`,
  );
}

const nonTextBefore = new Map([...REVIEWED_BREAKS.keys()].map((id) => {
  const { text: _text, ...rest } = passagesById.get(id);
  return [id, JSON.stringify(rest)];
}));

let changedPassages = 0;
let alreadyRepaired = 0;
let insertedBreaks = 0;

for (const [id, markers] of REVIEWED_BREAKS) {
  const passage = passagesById.get(id);
  const sourceText = collapseParagraphs(passage.text);
  let previousPosition = -1;
  let repairedText = sourceText;

  if (markers.length < 1 || markers.length > 3) {
    throw new Error(`${id}: reviewed marker count must be 1..3.`);
  }
  for (const marker of markers) {
    if (typeof marker !== 'string' || !/[.!?][\"'”’]?$/.test(marker)) {
      throw new Error(`${id}: marker is not an explicit sentence ending: ${JSON.stringify(marker)}`);
    }
    const match = occurrences(sourceText, marker);
    if (match.count !== 1) {
      throw new Error(`${id}: marker must occur exactly once: ${JSON.stringify(marker)}; found ${match.count}.`);
    }
    if (match.position <= previousPosition) {
      throw new Error(`${id}: reviewed markers are not in passage order: ${JSON.stringify(marker)}.`);
    }
    const boundary = match.position + marker.length;
    if (sourceText[boundary] !== ' ') {
      throw new Error(`${id}: marker is not followed by the expected sentence-boundary space: ${JSON.stringify(marker)}.`);
    }
    previousPosition = match.position;
    repairedText = repairedText.replace(`${marker} `, `${marker}\n\n`);
  }

  if (passage.text === sourceText) {
    passage.text = repairedText;
    changedPassages += 1;
    insertedBreaks += markers.length;
  } else if (passage.text === repairedText) {
    alreadyRepaired += 1;
  } else {
    throw new Error(`${id}: paragraph layout differs from both reviewed states.`);
  }

  const paragraphs = paragraphList(passage.text);
  if (paragraphs.length < 2 || paragraphs.length > 4) {
    throw new Error(`${id}: repaired text must contain 2..4 paragraphs; found ${paragraphs.length}.`);
  }
  if (collapseParagraphs(passage.text) !== sourceText) {
    throw new Error(`${id}: repair changed prose instead of only inserting blank lines.`);
  }

  const sourceWordCount = sourceText.trim().split(/\s+/).length;
  const repairedWordCount = passage.text.trim().split(/\s+/).length;
  const declaredCountIsValid = passage.wordCount == null || passage.wordCount === sourceWordCount;
  if (sourceWordCount !== repairedWordCount || !declaredCountIsValid) {
    throw new Error(
      `${id}: word count invariant failed ` +
      `(declared=${passage.wordCount}, source=${sourceWordCount}, repaired=${repairedWordCount}).`,
    );
  }

  const signals = passage.lesson?.signals;
  if (!Array.isArray(signals)) throw new Error(`${id}: lesson signals must be an array.`);
  for (const signal of signals) {
    const phrase = signal?.phrase;
    if (typeof phrase !== 'string' || !phrase) throw new Error(`${id}: lesson signal phrase is invalid.`);
    const folded = phrase.toLocaleLowerCase('en-US');
    if (!paragraphs.some((paragraph) => paragraph.toLocaleLowerCase('en-US').includes(folded))) {
      throw new Error(`${id}: paragraph break splits or loses lesson signal ${JSON.stringify(phrase)}.`);
    }
  }
}

for (const [id, before] of nonTextBefore) {
  const { text: _text, ...rest } = passagesById.get(id);
  if (JSON.stringify(rest) !== before) {
    throw new Error(`${id}: a non-text field changed during paragraph repair.`);
  }
}

if (!options.dryRun && (changedPassages > 0 || options.output !== options.input)) {
  writeFileSync(options.output, `${JSON.stringify(data, null, 2)}\n`);
}

const verb = options.dryRun ? 'Would repair' : 'Repaired';
console.log(
  `${verb} ${changedPassages} passages with ${insertedBreaks} reviewed blank-line breaks; ` +
  `${alreadyRepaired} passages already matched the reviewed state.`,
);
console.log(
  `Verified ${REVIEWED_BREAKS.size} legacy targets: 2..4 paragraphs, unchanged prose/word counts, ` +
  'and paragraph-contiguous lesson signals.',
);
