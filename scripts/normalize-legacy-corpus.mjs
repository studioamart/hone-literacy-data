#!/usr/bin/env node
/**
 * Apply only semantics-preserving repairs to the 286 legacy passages:
 *   - fill missing wordCount values using the app's whitespace rule;
 *   - remove answer-position bias by moving, never changing, choices.
 *
 * Passage IDs, question IDs, prose words, choices, correct meanings, and lesson
 * content are preserved. Editorial lesson/title repairs are intentionally left
 * to human review. The script accepts either the source v11 corpus or an
 * assembled v12 candidate and only visits the 286 non-year-pack passages.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = join(ROOT, 'data', 'passages.json');
const YEAR_PACK_ID = /^og-y26-d\d{3}-/;

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: null, dryRun: false, balanceAnswers: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--balance-answers') {
      options.balanceAnswers = true;
    } else if (argument === '--input' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      options[argument.slice(2)] = isAbsolute(value) ? value : resolve(process.cwd(), value);
      index += 1;
    } else if (argument === '--help') {
      console.log(
        'Usage: node scripts/normalize-legacy-corpus.mjs ' +
        '[--dry-run] [--balance-answers] [--input PATH] [--output PATH]'
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.output === null) options.output = options.input;
  return options;
}

const options = parseArgs(process.argv.slice(2));

const data = JSON.parse(readFileSync(options.input, 'utf8'));
if (data.schema !== 1 || ![11, 12].includes(data.version) || !Array.isArray(data.passages)) {
  throw new Error(`Expected the schema-1, version-11/12 corpus; found schema=${data.schema}, version=${data.version}.`);
}
const legacyPassages = data.passages.filter((passage) => !YEAR_PACK_ID.test(passage.id));
if (legacyPassages.length !== 286) throw new Error(`Expected 286 legacy passages, found ${legacyPassages.length}.`);

let filledCounts = 0;
let movedAnswers = 0;
let questionIndex = 0;

for (const passage of legacyPassages) {
  const count = passage.text.trim().split(/\s+/).length;
  if (passage.wordCount === undefined || passage.wordCount === null) {
    passage.wordCount = count;
    filledCounts += 1;
  } else if (passage.wordCount !== count) {
    throw new Error(`${passage.id}: declared wordCount ${passage.wordCount} does not match ${count}.`);
  }

  for (const question of passage.questions) {
    if (!Array.isArray(question.choices) || question.choices.length !== 4
        || !Number.isInteger(question.answer)
        || question.answer < 0 || question.answer >= question.choices.length) {
      throw new Error(`${passage.id}:${question.id}: malformed choices/answer.`);
    }
    if (Object.hasOwn(question, 'distractorTags')) {
      if (!Array.isArray(question.distractorTags)
          || question.distractorTags.length !== question.choices.length
          || question.distractorTags[question.answer] !== null) {
        throw new Error(
          `${passage.id}:${question.id}: distractorTags must align with choices and ` +
          'keep the correct slot null before answer balancing.'
        );
      }
    }
    const target = questionIndex % 4;
    if (options.balanceAnswers && question.answer !== target) {
      const correct = question.answer;
      [question.choices[correct], question.choices[target]] =
        [question.choices[target], question.choices[correct]];
      // Tags describe the option, never its old position. Move the pair as one
      // unit so an answer-layout repair cannot silently rewrite evidence.
      if (Object.hasOwn(question, 'distractorTags')) {
        [question.distractorTags[correct], question.distractorTags[target]] =
          [question.distractorTags[target], question.distractorTags[correct]];
      }
      question.answer = target;
      movedAnswers += 1;
    }
    questionIndex += 1;
  }
}

if (!options.dryRun) writeFileSync(options.output, JSON.stringify(data, null, 2) + '\n');
console.log(
  `${options.dryRun ? 'Would normalize' : 'Normalized'} ${legacyPassages.length} legacy passages: ` +
  `filled ${filledCounts} word counts, ` +
  (options.balanceAnswers
    ? `moved ${movedAnswers}/${questionIndex} answer positions.`
    : 'left answer positions unchanged (pass --balance-answers after editorial review).')
);
