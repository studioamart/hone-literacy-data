#!/usr/bin/env node
/**
 * Apply reviewed editorial repairs to the 286 legacy passages in corpus v11
 * or in the assembled v12 candidate.
 *
 * Every content choice is listed below by stable passage ID. There is no
 * truncation or prose-slicing heuristic: unexpected source data fails closed.
 * By default the script targets data/passages.json. Use --dry-run to inspect
 * the result without writing, or --input/--output to exercise it on a copy.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = join(ROOT, 'data', 'passages.json');

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--input' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      const path = isAbsolute(value) ? value : resolve(process.cwd(), value);
      options[argument.slice(2)] = path;
      index += 1;
    } else if (argument === '--help') {
      console.log('Usage: node scripts/repair-legacy-lessons.mjs [--dry-run] [--input PATH] [--output PATH]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.output === null) options.output = options.input;
  return options;
}

// The removed entry is the least useful of each original four-item list; the
// other three are the reviewed, passage-grounded teaching set.
const VOCAB_DROP_BY_ID = new Map(Object.entries({
  'og-fic2-the-night-baker': 'sweeps',
  'og-fic2-the-bicycle-shop': 'rack',
  'og-fic2-the-rooftop-garden': 'spread',
  'og-fic2-the-last-train': 'folded',
  'og-fic2-the-key-with-no-lock': 'wear',
  'og-fic2-fog-on-the-crossing': 'harbor',
  'og-fic2-room-nine': 'glanced',
  'og-fic2-the-mapmaker-of-valea': 'fiction',
  'og-fic2-two-rules-of-the-workshop': 'convincingly',
  'og-fic2-the-letter-writer': 'trade',
  'og-eco2-why-we-use-money': 'stores',
  'og-eco2-when-prices-rise': 'steady',
  'og-eco2-sharing-the-risk': 'ruinous',
  'og-eco2-the-box-that-moved-trade': 'converted',
  'og-eco2-two-tasks-one-worker': 'abandon',
  'og-eco2-the-seller-knows-more': 'middling',
  'og-eco2-the-price-of-borrowing': 'unguarded',
  'og-eco2-what-a-price-knows': 'mute',
  'og-eco2-the-storm-that-builds': 'dismantles',
  'og-eco2-counting-what-counts': 'cite',
  'og-phi2-the-ship-that-was-rebuilt': 'planks',
  'og-phi2-the-man-who-asked-questions': 'craftsmen',
  'og-phi2-what-is-up-to-you': 'grief',
  'og-phi2-shadows-on-the-wall': 'stumbles',
  'og-phi2-from-is-to-ought': 'cruelty',
  'og-phi2-choosing-behind-a-veil': 'bias',
  'og-phi2-the-butterfly-and-the-sleeper': 'unmistakably',
  'og-phi2-when-a-heap-stops-being-a-heap': 'absurd',
  'og-phi2-the-machine-that-feels-like-life': 'awkward',
  'og-phi2-a-person-through-other-persons': 'verdict',
  'og-his2-the-rosetta-stone': 'incomplete',
  'og-his2-the-first-postage-stamp': 'Clerks',
  'og-his2-the-hanseatic-league': 'decline',
  'og-his2-the-glassmakers-of-murano': 'forbidden',
  'og-his2-the-potato-in-europe': 'curiosity',
  'og-his2-the-broad-street-pump': 'physician',
  'og-his2-railway-time': 'tolerance',
  'og-his2-late-bronze-age-collapse': 'diplomatic',
  'og-his2-the-domesday-book': 'assess',
  'og-psy2-spacing-your-study': 'recover',
  'og-psy2-what-sleep-does-with-learning': 'reliable',
  'og-psy2-the-quiet-crowd': 'overreact',
  'og-psy2-the-honest-placebo': 'nausea',
  'og-psy2-the-gorilla-you-missed': 'strolls',
  'og-psy2-memory-is-rebuilt': 'absorbed',
  'og-psy2-the-cheapest-repair': 'mismatch',
  'og-psy2-paying-for-play': 'certificate',
  'og-psy2-blaming-the-person': 'discipline',
  'og-psy2-when-results-do-not-repeat': 'audit',
  'og-fic2-the-extra-loaf': 'stroller',
  'og-fic2-the-other-suitcase': 'lid',
  'og-fic2-between-two-and-four': 'assumed',
  'og-fic2-the-bowls-she-breaks': 'rim',
  'og-fic2-what-the-room-sounds-like': 'welders',
  'og-fic2-the-village-that-was-not-there': 'convict',
  'og-fic2-the-understudy': 'bitterness',
  'og-fic2-a-faithful-version': 'substituted',
  'og-sci2-why-ice-floats': 'sheet',
  'og-sci2-counting-toward-thunder': 'expands',
  'og-sci2-two-lives-one-body': 'absorbs',
  'og-sci2-what-sleep-does': 'compressed',
  'og-sci2-diary-inside-a-tree': 'overlaps',
  'og-sci2-antibiotics-lose-power': 'trait',
  'og-sci2-the-colour-of-air': 'biased',
  'og-sci2-clock-in-dead-wood': 'complication',
  'og-sci2-the-sugar-pill-problem': 'credited',
  'og-sci2-air-from-another-age': 'core',
  'og-nat2-why-leaves-change-color': 'substance',
  'og-nat2-the-terns-long-year': 'bill',
  'og-nat2-the-cactus-and-the-rain': 'patient',
  'og-nat2-what-beavers-build': 'dam',
  'og-nat2-the-trade-under-the-forest': 'numerous',
  'og-nat2-salmon-find-the-way-home': 'exhaustion',
  'og-nat2-two-lives-in-one': 'loosen',
  'og-nat2-forests-that-need-fire': 'seedlings',
  'og-nat2-what-the-ice-leaves-behind': 'prises',
  'og-nat2-honest-liars': 'credit',
  'og-bio2-wangari-maathai-trees': 'honored',
  'og-bio2-hokusai-and-fuji': 'ordinary',
  'og-bio2-sequoyah-writes-cherokee': 'adopted',
  'og-bio2-rachel-carson-narrow-case': 'pamphlets',
  'og-bio2-hedy-lamarr-workbench': 'manufacturer',
  'og-bio2-ibn-battuta-long-road': 'dismissed',
  'og-bio2-zora-neale-hurston-listens': 'Prominent',
  'og-bio2-humboldt-web-of-nature': 'plantations',
  'og-bio2-fanny-mendelssohn-print': 'circulated',
  'og-bio2-vivian-maier-negatives': 'relentlessly',
  'og-esy2-ten-minutes-of-walking': 'room',
  'og-esy2-the-small-notebook': 'useless',
  'og-esy2-in-praise-of-repair': 'stranger',
  'og-esy2-the-long-rise': 'noble',
  'og-esy2-quiet-rooms': 'rented',
  'og-esy2-the-use-of-boredom': 'endlessly',
  'og-esy2-every-map-is-wrong': 'inflated',
  'og-esy2-the-adult-accent': 'erase',
  'og-esy2-when-the-measure-becomes-the-target': 'corrupt',
  'og-esy2-what-translation-decides': 'evaporates',
  'og-l1-how-soap-cleans': 'drain',
  'og-l1-why-we-shiver': 'signal',
  'og-l1-seven-days-a-week': 'replaced',
  'og-l1-mary-anning-fossils': 'credit',
  'og-l1-why-lists-help': 'plain',
  'og-l1-how-your-phone-knows-where-you-are': 'instant',
  'og-l1-why-ants-follow-a-line': 'wandering',
  'og-l1-why-the-big-box-costs-less': 'compare',
}));

// The removed signal is the least structurally useful of each five-item set.
const SIGNAL_DROP_BY_ID = new Map(Object.entries({
  'og-eco2-why-we-use-money': 'Money also stores value',
  'og-eco2-when-prices-rise': 'Borrowers, oddly, can gain.',
  'og-eco2-sharing-the-risk': 'Economists call this moral hazard.',
  'og-eco2-the-box-that-moved-trade': 'Nobody touched the goods inside.',
  'og-eco2-two-tasks-one-worker': 'Economics says otherwise.',
  'og-eco2-the-seller-knows-more': 'Suppose half the cars offered are sound and half are hiding faults.',
  'og-eco2-the-price-of-borrowing': 'Move too late and inflation settles in.',
  'og-eco2-what-a-price-knows': 'Each of them acts on a single number.',
  'og-eco2-the-storm-that-builds': 'Nor is the adjustment automatic.',
  'og-eco2-counting-what-counts': 'all invisible',
  'og-psy2-when-results-do-not-repeat': 'The response has been unglamorous and largely structural',
  'og-fic2-the-village-that-was-not-there': 'Within a decade',
  'og-fic2-a-faithful-version': 'which is the only evidence available',
  'og-nat2-the-trade-under-the-forest': 'Because the threads of one fungus can touch several trees',
  'og-nat2-two-lives-in-one': 'The old picture was not wrong so much as too small.',
  'og-nat2-forests-that-need-fire': "A disaster, from the seed's point of view, is a delivery.",
  'og-nat2-honest-liars': 'Which is what makes the hoverfly interesting.',
  'og-esy2-the-use-of-boredom': 'Consider what boredom actually is.',
  'og-esy2-every-map-is-wrong': 'The price is area.',
  'og-esy2-what-translation-decides': 'Consider the ordinary difficulties.',
}));

// Every replacement is an exact contiguous substring of the original signal
// and of the passage. The chosen spans retain the signal's structural work.
const SIGNAL_REPLACEMENTS = [
  ['og-fic2-the-letter-writer', 'which she considered a matter of principle rather than of pricing', 'a matter of principle rather than of pricing'],
  ['og-eco2-sharing-the-risk', 'The aim is to spread the loss without erasing the reason to be careful.', 'spread the loss without erasing the reason to be careful.'],
  ['og-eco2-two-tasks-one-worker', 'What matters is not who is better in absolute terms, but what each person gives up.', 'what each person gives up.'],
  ['og-eco2-the-seller-knows-more', 'Suppose half the cars offered are sound and half are hiding faults.', 'half the cars offered are sound'],
  ['og-eco2-the-seller-knows-more', 'Quality can spiral downward until only the worst cars remain.', 'until only the worst cars remain.'],
  ['og-eco2-the-seller-knows-more', 'The remedies all attack the information gap rather than the price.', 'attack the information gap rather than the price.'],
  ['og-eco2-what-a-price-knows', 'This is the argument that a price is not merely a cost but a message.', 'a price is not merely a cost but a message.'],
  ['og-eco2-the-storm-that-builds', 'Growth arrives as demolition and construction at the same address.', 'demolition and construction at the same address.'],
  ['og-eco2-the-storm-that-builds', 'Which suggests the useful question is not whether to permit the storm', 'not whether to permit the storm'],
  ['og-phi2-what-is-up-to-you', 'Trouble begins, he taught, when we treat the second pile as if it were the first.', 'when we treat the second pile as if it were the first.'],
  ['og-phi2-shadows-on-the-wall', "Plato's warning is that education can look like damage to those who lack it.", 'education can look like damage to those who lack it.'],
  ['og-phi2-from-is-to-ought', 'The gap matters because facts and values answer different questions.', 'facts and values answer different questions.'],
  ['og-phi2-choosing-behind-a-veil', 'The device works by removing bias at its source rather than by asking people to resist it.', 'removing bias at its source'],
  ['og-phi2-choosing-behind-a-veil', 'Whether or not you accept his conclusion, the test is portable.', 'the test is portable.'],
  ['og-phi2-the-butterfly-and-the-sleeper', 'Read quickly, this looks like simple doubt about what is real.', 'this looks like simple doubt about what is real.'],
  ['og-phi2-the-butterfly-and-the-sleeper', 'Every position feels like the center when you are standing in it.', 'feels like the center when you are standing in it.'],
  ['og-phi2-the-machine-that-feels-like-life', 'Nozick then asked a question that sounds simple and is not: would you plug in?', 'asked a question that sounds simple and is not'],
  ['og-phi2-the-machine-that-feels-like-life', 'If experience were the whole of the good, refusing would be an error rather than a preference.', 'refusing would be an error rather than a preference.'],
  ['og-phi2-a-person-through-other-persons', 'Translated carelessly, it sounds like a warm reminder to be kind.', 'it sounds like a warm reminder to be kind.'],
  ['og-psy2-the-cheapest-repair', 'The uncomfortable implication is that beliefs often follow behavior rather than lead it', 'beliefs often follow behavior rather than lead it'],
  ['og-psy2-paying-for-play', 'When the payment stops, the reason it replaced does not automatically return', 'the reason it replaced does not automatically return'],
  ['og-fic2-between-two-and-four', 'The station gave him the shift because nothing happens in it.', 'because nothing happens in it.'],
  ['og-fic2-between-two-and-four', 'But he has stopped thinking of the show as talking into the dark.', 'stopped thinking of the show as talking into the dark.'],
  ['og-fic2-the-bowls-she-breaks', 'Her reason is not perfectionism, though everyone assumes it is.', 'not perfectionism, though everyone assumes it is.'],
  ['og-fic2-the-village-that-was-not-there', 'so that any rival who copied the plates would copy the lie as well', 'any rival who copied the plates would copy the lie as well'],
  ['og-fic2-the-understudy', 'in the way a plant kept from light grows tall and pale at the same time', 'a plant kept from light grows tall and pale'],
  ['og-fic2-a-faithful-version', 'The word was chosen carefully by people who had not compared the two halves of his work.', 'people who had not compared the two halves of his work.'],
  ['og-sci2-counting-toward-thunder', 'because the sound reaches you from different parts of the same long channel', 'different parts of the same long channel'],
  ['og-sci2-what-sleep-does', 'This is why an all-night session before an exam is a poor trade.', 'an all-night session before an exam is a poor trade.'],
  ['og-sci2-diary-inside-a-tree', 'That shared pattern lets researchers reach back further than any living tree.', 'reach back further than any living tree.'],
  ['og-sci2-air-from-another-age', 'Every bubble in that ice is a sealed sample of the atmosphere', 'a sealed sample of the atmosphere'],
  ['og-nat2-the-terns-long-year', 'Because it follows summer from one end of the planet to the other', 'it follows summer from one end of the planet to the other'],
  ['og-nat2-what-beavers-build', 'It builds because it cannot stand the sound of running water.', 'because it cannot stand the sound of running water.'],
  ['og-nat2-the-trade-under-the-forest', 'In return, the tree hands over sugar it has made from sunlight.', 'the tree hands over sugar it has made from sunlight.'],
  ['og-nat2-two-lives-in-one', 'Apart, neither would last long on bare rock; together they cover mountains.', 'neither would last long on bare rock; together they cover'],
  ['og-nat2-two-lives-in-one', 'which is why a wall covered in lichen is also a report on the air around it', 'a wall covered in lichen is also a report on the air'],
  ['og-nat2-what-the-ice-leaves-behind', 'Working together, these two actions widen a valley as well as deepen it', 'these two actions widen a valley as well as deepen it'],
  ['og-bio2-fanny-mendelssohn-print', 'not a rediscovery of a forgotten composer but the first real hearing of one', 'forgotten composer but the first real hearing of one'],
  ['og-bio2-vivian-maier-negatives', "What he had bought, it turned out, was the life's work of a woman who had shown it to almost no one.", 'work of a woman who had shown it to almost no one.'],
  ['og-esy2-in-praise-of-repair', 'Because I had never opened one, I assumed the inside was beyond me.', 'I assumed the inside was beyond me.'],
  ['og-esy2-every-map-is-wrong', 'The only real question is which error the mapmaker chooses to accept.', 'which error the mapmaker chooses to accept.'],
];

const STRATEGY_REPLACEMENTS = new Map(Object.entries({
  'og-psy2-the-honest-placebo': 'Track the reversal: an effect once dismissed as an annoyance becomes evidence about meaning. Re-read the contrast between reported symptoms and physical outcomes, then separate the established pattern from the conditional possibility in the final paragraph.',
  'og-psy2-blaming-the-person': 'Compare the stranger and the narrator doing the same act, then track how the passage names and explains the asymmetry. The final paragraph limits the claim; use that qualification to avoid treating a tendency as an absolute rule.',
  'og-psy2-when-results-do-not-repeat': 'Follow the argument from finding, to rejected explanation, to structural explanation, and finally to irony. The fraud-versus-incentives pivot is central. In the last paragraph, connect each reform to the incentive or source of bias it addresses.',
  'og-sci2-the-sugar-pill-problem': 'Track the problem-and-solution structure. Paragraph two lists confounding causes; paragraph three explains the design that separates them; paragraph four adds a limitation. Keep improving after treatment distinct from improving because of treatment.',
  'og-nat2-honest-liars': 'Hold onto the condition stated at the end of paragraph one. The next two paragraphs test a mimic that weakens the warning, while the last presents a strategy that preserves it. Use the short paragraph openings to mark the change between cases.',
  'og-bio2-rachel-carson-narrow-case': 'Trace the causal chain: an early writing job develops a skill, that skill meets new evidence, and careful limits strengthen the resulting book. In paragraph three, note what the book did not claim before reading what it did claim.',
  'og-bio2-fanny-mendelssohn-print': 'Read for the hidden subject: access to print, not talent. The first paragraph closes the door, the second shows work continuing behind it, and the third opens it too late. Preserve the ending’s distinction between rediscovery and a first real hearing.',
  'og-bio2-vivian-maier-negatives': 'Treat the first two paragraphs as report and the third as argument. The invitation to pause is the hinge. After it, locked rooms and a false name support a counter-reading, while the final judgment deliberately leaves luck beside an unanswered question.',
}));

const VOCAB_CONTEXT_REPLACEMENTS = new Map([
  ['og-fic2-the-last-bus-home', {
    word: 'block',
    old: 'the group of streets around one square of buildings; driving around it means going in a circle and coming back',
    new: 'the streets around one square of buildings; circling them brings the bus back',
  }],
]);

const TITLE_REPLACEMENTS = new Map([
  ['og-fic2-the-understudy', { old: 'The Understudy', new: 'The Cost of Perfect Readiness' }],
  ['og-sci2-why-ice-floats', { old: 'Why Ice Floats', new: 'The Lake’s Winter Lid' }],
]);

const options = parseArgs(process.argv.slice(2));
const data = JSON.parse(readFileSync(options.input, 'utf8'));
if (data.schema !== 1 || ![11, 12].includes(data.version) || !Array.isArray(data.passages)) {
  throw new Error(`Expected schema=1, version=11/12 with a passages array; found schema=${data.schema}, version=${data.version}.`);
}

const passagesById = new Map(data.passages.map((passage) => [passage.id, passage]));
if (passagesById.size !== data.passages.length) throw new Error('Passage IDs must be unique.');

function passageFor(id) {
  const passage = passagesById.get(id);
  if (!passage) throw new Error(`Required passage is missing: ${id}`);
  return passage;
}

const changes = { vocab: 0, signalsTrimmed: 0, signalsShortened: 0, strategies: 0, contexts: 0, titles: 0 };

const unexpectedFourVocab = data.passages
  .filter((passage) => passage.lesson?.vocab?.length === 4 && !VOCAB_DROP_BY_ID.has(passage.id))
  .map((passage) => passage.id);
if (unexpectedFourVocab.length) throw new Error(`Unreviewed four-item vocab arrays: ${unexpectedFourVocab.join(', ')}`);
for (const [id, dropWord] of VOCAB_DROP_BY_ID) {
  const vocab = passageFor(id).lesson?.vocab;
  if (!Array.isArray(vocab)) throw new Error(`${id}: missing vocab array.`);
  const matches = vocab.filter((item) => item.word === dropWord).length;
  if (vocab.length === 4 && matches === 1) {
    passageFor(id).lesson.vocab = vocab.filter((item) => item.word !== dropWord);
    changes.vocab += 1;
  } else if (!(vocab.length === 3 && matches === 0)) {
    throw new Error(`${id}: expected four vocab items including ${JSON.stringify(dropWord)}, or its repaired three-item state.`);
  }
}

for (const [id, oldPhrase, newPhrase] of SIGNAL_REPLACEMENTS) {
  if (newPhrase.length > 60 || !oldPhrase.includes(newPhrase)) {
    throw new Error(`${id}: reviewed signal replacement is not a contiguous <=60-character substring.`);
  }
  const passage = passageFor(id);
  if (!passage.text.includes(newPhrase)) throw new Error(`${id}: replacement signal is not exact passage text: ${newPhrase}`);
  const signal = passage.lesson?.signals?.find((item) => item.phrase === oldPhrase || item.phrase === newPhrase);
  if (!signal) {
    const wasReviewedDrop = SIGNAL_DROP_BY_ID.get(id) === oldPhrase
      && passage.lesson?.signals?.length === 4;
    if (wasReviewedDrop) continue;
    throw new Error(`${id}: expected signal is missing: ${oldPhrase}`);
  }
  if (signal.phrase === oldPhrase) {
    signal.phrase = newPhrase;
    changes.signalsShortened += 1;
  }
}

const unexpectedFiveSignals = data.passages
  .filter((passage) => passage.lesson?.signals?.length === 5 && !SIGNAL_DROP_BY_ID.has(passage.id))
  .map((passage) => passage.id);
if (unexpectedFiveSignals.length) throw new Error(`Unreviewed five-signal arrays: ${unexpectedFiveSignals.join(', ')}`);
for (const [id, originalDropPhrase] of SIGNAL_DROP_BY_ID) {
  const passage = passageFor(id);
  const replacement = SIGNAL_REPLACEMENTS.find(([replacementId, oldPhrase]) =>
    replacementId === id && oldPhrase === originalDropPhrase);
  const dropPhrase = replacement ? replacement[2] : originalDropPhrase;
  const signals = passage.lesson?.signals;
  if (!Array.isArray(signals)) throw new Error(`${id}: missing signals array.`);
  const matches = signals.filter((item) => item.phrase === dropPhrase).length;
  if (signals.length === 5 && matches === 1) {
    passage.lesson.signals = signals.filter((item) => item.phrase !== dropPhrase);
    changes.signalsTrimmed += 1;
  } else if (!(signals.length === 4 && matches === 0)) {
    throw new Error(`${id}: expected five signals including ${JSON.stringify(dropPhrase)}, or its repaired four-item state.`);
  }
}

for (const [id, strategy] of STRATEGY_REPLACEMENTS) {
  if (strategy.length > 320) throw new Error(`${id}: reviewed strategy is still over 320 characters.`);
  const passage = passageFor(id);
  if (passage.lesson?.strategy === strategy) continue;
  if (typeof passage.lesson?.strategy !== 'string' || passage.lesson.strategy.length <= 320) {
    throw new Error(`${id}: expected the original overlong strategy or its reviewed replacement.`);
  }
  passage.lesson.strategy = strategy;
  changes.strategies += 1;
}

for (const [id, replacement] of VOCAB_CONTEXT_REPLACEMENTS) {
  if (replacement.new.length > 100) throw new Error(`${id}: reviewed vocab context is still over 100 characters.`);
  const item = passageFor(id).lesson?.vocab?.find((entry) => entry.word === replacement.word);
  if (!item) throw new Error(`${id}: vocab word is missing: ${replacement.word}`);
  if (item.inContext === replacement.old) {
    item.inContext = replacement.new;
    changes.contexts += 1;
  } else if (item.inContext !== replacement.new) {
    throw new Error(`${id}: vocab context differs from both reviewed states.`);
  }
}

for (const [id, replacement] of TITLE_REPLACEMENTS) {
  const passage = passageFor(id);
  if (passage.title === replacement.old) {
    passage.title = replacement.new;
    changes.titles += 1;
  } else if (passage.title !== replacement.new) {
    throw new Error(`${id}: title differs from both reviewed states.`);
  }
}

const remaining = {
  vocab: data.passages.filter((passage) => passage.lesson?.vocab?.length === 4).map((passage) => passage.id),
  signals: data.passages.filter((passage) => passage.lesson?.signals?.length === 5).map((passage) => passage.id),
  longSignals: data.passages.flatMap((passage) =>
    (passage.lesson?.signals ?? []).filter((signal) => signal.phrase.length > 60).map(() => passage.id)),
  strategies: data.passages.filter((passage) => passage.lesson?.strategy?.length > 320).map((passage) => passage.id),
  contexts: data.passages.flatMap((passage) =>
    (passage.lesson?.vocab ?? []).filter((item) => item.inContext.length > 100).map(() => passage.id)),
};
if (Object.values(remaining).some((ids) => ids.length)) {
  throw new Error(`Requested repair set is incomplete: ${JSON.stringify(remaining)}`);
}

if (!options.dryRun) writeFileSync(options.output, `${JSON.stringify(data, null, 2)}\n`);
const total = Object.values(changes).reduce((sum, count) => sum + count, 0);
console.log(`${options.dryRun ? 'Would apply' : 'Applied'} ${total} reviewed repairs to ${data.passages.length} passages.`);
console.log(JSON.stringify(changes));
