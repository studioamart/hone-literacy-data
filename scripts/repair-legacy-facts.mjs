#!/usr/bin/env node
/**
 * Apply reviewed factual repairs to legacy Fluency passages.
 *
 * The repair set is deliberately explicit. Each target is selected by stable
 * passage ID and replaces reviewed title/text/questions/lesson content as one
 * unit. SHA-256 guards accept only the known v11 source, the known v12
 * editorial-lesson state, or this script's own repaired state. Anything else
 * fails closed instead of overwriting a newer editorial change.
 *
 * This script accepts a source v11 corpus or an assembled v12 candidate. It
 * never changes IDs, levels, source metadata, release metadata, or non-target
 * passages. By default it targets data/passages.json; use --dry-run for a
 * read-only preview and --input/--output for copy-based verification.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = join(ROOT, 'data', 'passages.json');
const YEAR_PACK_ID = /^og-y26-d\d{3}-/;
const SKILLS = new Set(['main-idea', 'inference', 'vocabulary', 'detail']);

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: null, dryRun: false };
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
      console.log('Usage: node scripts/repair-legacy-facts.mjs [--dry-run] [--input PATH] [--output PATH]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.output === null) options.output = options.input;
  return options;
}

function question(id, skill, stem, choices, answer, explanation) {
  return { id, skill, stem, choices, answer, explanation };
}

function lesson(strategy, signals, vocab, skillTips) {
  return {
    strategy,
    signals: signals.map(([phrase, means]) => ({ phrase, means })),
    vocab: vocab.map(([word, inContext]) => ({ word, inContext })),
    skillTips,
  };
}

const SOURCE_HASHES = new Map(Object.entries({
  'og-sci-why-ice-floats': ['1811319a255fbdac52a300533577ba3b53194819ea4dc808a69edf01d458aa4f'],
  'og-sci2-why-ice-floats': ['61a19602301f85f9a8279b4626cab949a3fbac93d66355e15427430c00de6354', '1165b44f202b5ad18f9272daf0470dc81859e03e3114f57568cd038fafe8af48'],
  'og-l2-why-the-plate-stays-cool': ['bfeb81a9d00c7d68b78e7c0118c45f85fd08a007fb55156ca4be3ba9a22a02a1'],
  'og-l2-why-passwords-got-longer': ['ca09e28ea3e2048bb415593d756c46dc5aa5dbb2d0cd5ed082b8a3626aa5b2a8'],
  'og-sci2-air-from-another-age': ['17ef6569ccbc0f92d0a671ef395dbbe24f92372a269cc47050a4dd536540164a', '8bfedaf17b0d6b6a97f152a21dcece79e447514e79c4d300fba17e9180e28321'],
  'og-sci-forest-fungal-network': ['556ada9ee6feead0f3a52693459e9736a6b39188827441052764efc1bff878e8'],
  'og-sci-greenhouse-effect': ['3fab8c77752c35a49223a7b28fcfbc15f972a88356363e67e405cc0a1badaa3a', 'b3d42c099f683b6ada0810aaf7e46a23b44046913ec87038deabfdc5d50a6c31'],
  'og-non-placebo-effect': ['b5850c6338916a8b9996e51498e6e8786cabb432678f780726d5619ac8cb15ef', '34b1948912cafbf4663fabcd9ca09bffa5ed93caebb4b91e08681c60929b92e9'],
  'og-non-decision-fatigue': ['bd5dc15c3979ccbb66fc729ed424809191aa854c696bed483f158daff2b5e078'],
  'og-his-printing-press': ['e44c1d688994fe07074b47766bc6ae12d4d13cfca7c929495623bf3192500586'],
  'og-sci-coral-reef': ['4c3e7087dd36c502c12a5eb8cefc1a84006390e02ada087aba541e03ca8fe595', '1024c644f5dc10553af01446d045672a1523f2ced3b8336c81993f957dd3958d'],
  'og-sci-moon-tides': ['b32749d87ab7cf7facc85fdac1cdcd3e2ccf459ca4d7ba34d94eb6c7ffd75851', '94f1832a966f4b54ea96f13aa174c609d73898688cf475d4a68d592e8357744c'],
  'og-non-path-dependence': ['2d449de2aa9f6a3da24871e3dea5b5c8fd5d6788cc30f18bffc1059c8cc3e98c'],
  'og-l3-a-sheet-that-keeps-its-shape': ['d1b1a701a35ec3a215728f13ee9e69cf659ef3c5145f9266ba88178d1916a913'],
  'og-eco2-sharing-the-risk': ['800ca52d8ac7900c52aaf5ea015205d82030138d5d27a415ddfb3d76666f9d3b', 'a50497a384191bc852f92ac19d2f1b02b8863535fee3be54c92dfd5cbd04eb28'],
  'og-l1-why-we-shiver': ['b7c3b01a2f07d844e67c2ccffd540915d985b2a6170a783650bd9406a27da12a', '8bc69f64dca407d0c40a3b0fa078d759fa2648acc614f7a44308e66aeba6e925'],
}));

// Reference URLs are retained beside the reviewed copy so a future editor can
// recheck claims. They are not added to the runtime corpus schema.
const REPAIRS = new Map();

REPAIRS.set('og-sci-why-ice-floats', {
  references: ['https://www.usgs.gov/special-topics/water-science-school/science/water-density'],
  title: 'Why Ice Floats',
  text: `Density describes how much mass fits into a given volume. Many materials become denser as they cool because their particles pack more closely. Water follows that pattern only down to about four degrees Celsius. Below that temperature, its behavior begins to change.

As water freezes, its molecules lock into an open crystal pattern. The pattern holds them farther apart than they were in liquid water. The same mass now occupies more volume, so ice is less dense than liquid water. That difference, not a change in weight, lets a piece of ice float.

The unusual pattern shapes a lake in winter. Water near four degrees is denser than colder water and sinks. Colder water stays nearer the surface, where it can freeze. The floating ice forms a lid that slows heat loss from the water below.

The lid does not make every lake safe or equally warm. Shallow water can freeze deeply, and oxygen may still become scarce. Yet in many lakes, liquid water remains below the ice, giving fish and other organisms a place to survive until spring. A molecular arrangement too small to see helps organize an entire winter habitat.`,
  questions: [
    question('q1', 'main-idea', 'The passage mainly explains', [
      'how lakes collect water during spring storms',
      'why all solid materials float in their liquids',
      'why ice is less dense than water and how that shapes winter lakes',
      'how fish make oxygen beneath a frozen surface',
    ], 2, 'The passage connects the open crystal pattern in ice with floating surface ice and liquid habitat below.'),
    question('q2', 'detail', 'Why is ice less dense than liquid water?', [
      'Its molecules form an open pattern that occupies more volume',
      'It changes into a different chemical substance',
      'Its molecules lose all of their mass',
      'It always traps large bubbles of air',
    ], 0, 'Freezing arranges water molecules in an open pattern, so the same mass takes up more space.'),
    question('q3', 'inference', 'Why does water near four degrees Celsius tend to sink below colder water?', [
      'It contains more salt than the colder water',
      'It is denser than the colder water',
      'It has already turned into solid ice',
      'It receives more sunlight from the shore',
    ], 1, 'The passage states that water near four degrees is denser, and denser water sinks beneath less dense water.'),
    question('q4', 'vocabulary', 'In this passage, “volume” means', [
      'the loudness of a sound',
      'the weight shown on a scale',
      'the amount of space something occupies',
      'the temperature at which water freezes',
    ], 2, 'The same mass of ice occupies more volume, meaning it takes up more space.'),
  ],
  lesson: lesson(
    'Follow the scale changes. The passage starts with density, moves to a molecular pattern, and then shows the result across a lake. Keep mass, volume, and density separate: the mass stays the same while the occupied volume grows.',
    [
      ['only down to about four degrees Celsius', 'Marks the point where water stops following the simple cooling pattern.'],
      ['not a change in weight', 'Corrects the tempting mistake that freezing makes the same water weigh less.'],
      ['The unusual pattern shapes a lake', 'Moves from the molecular cause to its ecosystem consequence.'],
    ],
    [
      ['density', 'how much mass is packed into a given volume'],
      ['volume', 'the amount of space occupied by the water or ice'],
      ['crystal', 'an ordered solid pattern formed by molecules'],
    ],
    {
      'main-idea': 'Join the molecular cause to the lake effect. An answer about floating alone leaves out why the passage continues.',
      'inference': 'Use the stated density comparison to predict which water sinks and which remains near the surface.',
      'vocabulary': 'The phrase “same mass now occupies more volume” defines volume through a direct comparison.',
      'detail': 'Return to paragraph two for the exact cause: an open crystal pattern spaces molecules farther apart.',
    },
  ),
});

REPAIRS.set('og-sci2-why-ice-floats', {
  references: ['https://www.usgs.gov/special-topics/water-science-school/science/ice-snow-and-glaciers-and-water-cycle'],
  title: 'The Lake’s Winter Lid',
  text: `Drop a stone into water and it sinks. Place an ice cube in water and it floats. The reason is density: ice has less mass packed into each bit of space than liquid water does.

As water freezes, its molecules join in an open pattern with small gaps. The same amount of water takes up more room as ice. Because it is less dense than the liquid around it, the ice stays on top.

This matters in a lake. On a cold day, ice forms at the surface instead of dropping to the bottom. The floating sheet acts like a lid and slows the loss of heat. Water can remain liquid beneath it, giving fish, frogs, and other organisms a winter habitat.

If ice were denser than liquid water, new ice would sink. More water at the surface could then freeze and sink too. A lake might freeze much more deeply. The floating lid does not protect every lake in every condition, but its position at the top often leaves living space below.`,
  questions: [
    question('q1', 'main-idea', 'What is the passage mainly about?', [
      'How stones change when they enter cold water',
      'Why ice floats and often leaves liquid habitat beneath a lake’s surface',
      'How frogs make a lake freeze during winter',
      'Why every lake keeps the same temperature',
    ], 1, 'The passage explains the density of ice, then shows how floating ice can protect liquid water below.'),
    question('q2', 'detail', 'What does a floating sheet of ice do?', [
      'It pulls every fish toward the surface',
      'It makes the lake water turn salty',
      'It slows heat loss from the water below',
      'It causes new ice to sink to the bottom',
    ], 2, 'The third paragraph says the sheet acts like a lid and slows the loss of heat.'),
    question('q3', 'inference', 'What would happen first if ice were denser than liquid water?', [
      'New ice would sink after it formed',
      'The lake would become warmer than summer air',
      'Water molecules would lose their mass',
      'All organisms would immediately leave the lake',
    ], 0, 'Something denser than the liquid around it sinks, so newly formed ice would drop.'),
    question('q4', 'vocabulary', 'In this passage, “density” describes', [
      'how cold something feels to a hand',
      'how quickly something changes shape',
      'how clear a liquid appears',
      'how much mass is packed into an amount of space',
    ], 3, 'The first paragraph defines density as how much mass is packed into each bit of space.'),
  ],
  lesson: lesson(
    'Read this as cause, position, and consequence. The open pattern makes ice less dense; lower density keeps it on top; the surface lid slows heat loss. Check that each answer follows that chain.',
    [
      ['The reason is density', 'Names the idea that explains the opening contrast.'],
      ['Because it is less dense', 'Connects the molecular pattern to floating.'],
      ['This matters in a lake', 'Moves from the explanation to its effect on a habitat.'],
      ['If ice were denser', 'Introduces a counterfactual that tests the density rule.'],
    ],
    [
      ['density', 'how much mass is packed into a given amount of space'],
      ['molecules', 'the tiny units of water that form an open pattern in ice'],
      ['habitat', 'a place where organisms can live'],
    ],
    {
      'main-idea': 'The passage needs both halves: why ice floats and what a floating lid changes in a lake.',
      'inference': 'Apply the density rule to the imagined case. If solid ice were denser, it would sink.',
      'vocabulary': 'Use the definition after the colon in paragraph one rather than guessing from “heavy.”',
      'detail': 'The third paragraph directly names the lid’s job: it slows the loss of heat.',
    },
  ),
});

REPAIRS.set('og-l2-why-the-plate-stays-cool', {
  references: ['https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/cooking-microwave-ovens'],
  title: 'How a Microwave Heats Food',
  text: `A microwave oven does not heat every material in the same way. Its magnetron produces electromagnetic waves. Inside food, the changing electric field makes polar molecules, especially water molecules, turn back and forth. Moving ions also respond. Their motion transfers energy through the food and produces heat.

Water is important, but it is not the only part of food that absorbs microwave energy. Fats and sugars can absorb some too. That is why a fairly dry food may still become hot. The amount of heating depends on the food, its shape, and how long it is exposed.

Many microwave-safe glass or ceramic plates absorb less energy than the food. Such a plate may stay cooler at first, then warm as heat moves into it from the meal. Some dishes absorb more energy and become hot on their own, so the material and safety label matter.

Waves overlap inside the oven, creating stronger and weaker spots. A turntable moves food through those spots. It cannot guarantee perfectly even cooking, which is why stirring and checking temperature can still be important.`,
  questions: [
    question('q1', 'main-idea', 'What is the passage mainly about?', [
      'Why every dry object remains cold in a microwave',
      'How microwave energy heats food unevenly and why dishes may heat differently',
      'Why a magnetron makes food safe without a temperature check',
      'Why ceramic is the only material allowed in an oven',
    ], 1, 'The passage explains energy absorption by food, differences among dishes, and the turntable’s role.'),
    question('q2', 'inference', 'Why can a fairly dry food still become hot?', [
      'Its shape blocks all waves from leaving the oven',
      'Only its plate can absorb microwave energy',
      'Fats and sugars can absorb some microwave energy too',
      'Dry food always contains more water than soup',
    ], 2, 'The second paragraph says fats and sugars, not only water, can absorb some microwave energy.'),
    question('q3', 'vocabulary', 'In this passage, “polar” describes a molecule that has', [
      'an uneven electrical charge across it',
      'a perfectly round and balanced shape',
      'no response to an electric field',
      'a layer of frozen water around it',
    ], 0, 'A changing electric field can turn a polar molecule because its electrical charge is unevenly arranged.'),
    question('q4', 'detail', 'What does the turntable do?', [
      'It moves food through stronger and weaker wave spots',
      'It changes fats and sugars into water',
      'It prevents every dish from becoming hot',
      'It measures the food’s internal temperature',
    ], 0, 'The final paragraph says the turntable carries food through stronger and weaker spots.'),
  ],
  lesson: lesson(
    'Separate absorption from heat transfer. Food can absorb microwave energy through water and other components; a dish can absorb energy or warm later from the food. The last paragraph adds why motion helps without promising perfect heating.',
    [
      ['not the only part of food', 'Corrects the idea that microwave heating acts on water alone.'],
      ['depends on the food', 'Warns that one prediction does not fit every material.'],
      ['then warm as heat moves into it', 'Distinguishes direct absorption from heat transferred by food.'],
      ['cannot guarantee perfectly even cooking', 'Limits what the turntable can accomplish.'],
    ],
    [
      ['magnetron', 'the device that produces electromagnetic waves in the oven'],
      ['polar', 'having an uneven electrical charge that responds to the field'],
      ['absorb', 'to take in energy from the microwave field'],
    ],
    {
      'main-idea': 'Choose an answer broad enough to include food, dishes, and uneven heating.',
      'inference': 'Use paragraph two to reject the simple dry-means-cold rule.',
      'vocabulary': 'Read “polar” through the next action: the changing electric field turns the molecule.',
      'detail': 'The turntable changes where the food sits; it does not measure temperature or change ingredients.',
    },
  ),
});

REPAIRS.set('og-l2-why-passwords-got-longer', {
  references: ['https://www.nist.gov/cybersecurity-and-privacy/how-do-i-create-good-password'],
  title: 'Why Password Advice Changed',
  text: `Password advice has changed. Many sites once demanded a short string with a capital letter, a number, and a symbol. Current guidance puts more weight on length, uniqueness, and tools that reduce what a person must remember.

Length matters because every unpredictable character can multiply the possible strings. Symbols can enlarge that set too, but forced rules often lead people to predictable swaps, such as replacing a letter with a similar-looking number. No chart can promise one cracking time for every password. The rate depends on the password, the way a site protects it, the attacker’s equipment, and whether guesses happen online or against stolen data.

Reuse creates a different danger. If one service is breached, attackers may try the same email and password elsewhere. A unique password for each account limits that chain.

A password manager can create and store long, random passwords. Multi-factor authentication adds another check, and passkeys can avoid a shared password altogether. When a person must remember a password, a long and unusual passphrase may be easier than a short jumble. The goal is not one magic recipe. It is to make guessing difficult and one stolen secret less useful.`,
  questions: [
    question('q1', 'main-idea', 'What is the passage mainly about?', [
      'Why every password can be cracked in the same number of hours',
      'How current password advice combines length, uniqueness, and safer tools',
      'Why symbols make a password weaker in every situation',
      'How websites prevent all attacks on stored data',
    ], 1, 'The passage explains length, attack conditions, unique passwords, managers, MFA, and passkeys.'),
    question('q2', 'detail', 'Why can no chart promise one cracking time for every password?', [
      'Every attacker must type guesses by hand',
      'All websites use exactly the same protection',
      'The rate depends on the password, protection, equipment, and kind of attack',
      'Long passwords contain no characters that a machine can test',
    ], 2, 'The second paragraph directly lists the conditions that change a guessing rate.'),
    question('q3', 'vocabulary', 'In this passage, “unique” means', [
      'used for only one account',
      'made entirely from symbols',
      'changed at the end of every day',
      'shared with a trusted friend',
    ], 0, 'A unique password is different for each account, so one breach does not open the others.'),
    question('q4', 'inference', 'Why does password reuse make one breach more damaging?', [
      'A reused password becomes shorter each time',
      'Attackers can try the same credentials on other accounts',
      'A password manager publishes every stored password',
      'Multi-factor authentication stops working on all sites',
    ], 1, 'The third paragraph explains that attackers may test the stolen email and password elsewhere.'),
  ],
  lesson: lesson(
    'Organize the passage into three risks and responses: guessability, reuse, and memory burden. Notice the limits in paragraph two; attack conditions prevent a universal cracking-time claim.',
    [
      ['puts more weight on length', 'Introduces the shift from composition rules to broader guidance.'],
      ['No chart can promise', 'Signals an important limit on fixed cracking-time claims.'],
      ['Reuse creates a different danger', 'Moves from guessing strength to damage across accounts.'],
      ['not one magic recipe', 'Summarizes why several protections work together.'],
    ],
    [
      ['breached', 'broken into so that protected account data may be exposed'],
      ['unique', 'different for each account rather than reused'],
      ['passphrase', 'a longer password made from an unusual sequence of words'],
    ],
    {
      'main-idea': 'The answer should include both stronger secrets and tools that limit memory and reuse.',
      'inference': 'Trace the stolen credential from one breached service to attempts at other services.',
      'vocabulary': 'The phrase “for each account” gives the local meaning of unique.',
      'detail': 'For cracking time, return to the four conditions listed in paragraph two.',
    },
  ),
});

REPAIRS.set('og-sci2-air-from-another-age', {
  references: ['https://www.beyondepica.eu/en/news-events/press-releases/'],
  title: 'Air From Another Age',
  text: `Snow that falls on central Antarctica may remain instead of melting. Later snow buries it, pressure turns it into ice, and closing pores trap samples of the surrounding air. A bubble is not labeled with a year, but it preserves gases from an atmosphere far older than any instrument record.

Drilling brings the layers up in order, with younger ice above older ice. Earlier Antarctic cores produced a continuous climate record reaching about eight hundred thousand years. A newer core from Little Dome C reaches at least 1.2 million years, although researchers must still analyze and date its deepest sections carefully. “Oldest” therefore describes both an achievement and an active measurement problem.

Two kinds of evidence come from a core. Air bubbles let researchers measure gases such as carbon dioxide and methane. The ice itself holds indirect temperature clues. Ratios of heavier and lighter forms of oxygen and hydrogen vary with the conditions in which snow formed.

The gas record and the temperature clues do not share exactly the same age at a given depth: air is sealed only after snow has already begun becoming ice. Scientists model that age difference and compare several dating clues. An ice core is a powerful archive not because every layer speaks plainly, but because many physical records can be tested in one ordered column.`,
  questions: [
    question('q1', 'main-idea', 'What is the main idea of the passage?', [
      'Antarctic ice gives one perfectly labeled measurement for each year',
      'Deep ice preserves ancient gases and climate clues that require careful dating and comparison',
      'Only air bubbles can reveal anything about past climate',
      'The newest core has already answered every question about ancient air',
    ], 1, 'The passage describes the two records, the new reach, and the dating work required to compare them.'),
    question('q2', 'detail', 'How far back does the newer Little Dome C core reach?', [
      'At least 12,000 years',
      'About 120,000 years',
      'About 800,000 years only',
      'At least 1.2 million years',
    ], 3, 'The second paragraph says the newer core reaches at least 1.2 million years.'),
    question('q3', 'inference', 'Why might trapped air and nearby ice have slightly different ages?', [
      'Air is sealed after the snow has already begun turning into ice',
      'Methane makes every bubble younger than the ice',
      'Drilling changes old ice into new snow',
      'Oxygen cannot remain inside an ice sheet',
    ], 0, 'The final paragraph says air closes into bubbles only after snow has begun becoming ice.'),
    question('q4', 'vocabulary', 'In the last paragraph, “archive” means', [
      'a machine that predicts future weather',
      'an ordered store of records for later study',
      'a shelter used by a drilling team',
      'a single bubble with a printed date',
    ], 1, 'The core stores several records in an ordered column, like an archive kept for study.'),
  ],
  lesson: lesson(
    'Track what is directly measured, what is inferred, and what must be dated. The new 1.2-million-year reach updates the scale, while the final paragraph prevents “archive” from sounding automatic or perfectly labeled.',
    [
      ['far older than any instrument record', 'Explains why trapped air is valuable evidence.'],
      ['at least 1.2 million years', 'Updates the former eight-hundred-thousand-year record.'],
      ['Two kinds of evidence', 'Signals the parallel gas and temperature explanations.'],
      ['do not share exactly the same age', 'Introduces the dating complication readers must retain.'],
    ],
    [
      ['pores', 'small spaces in compacting snow where air can be trapped'],
      ['ratios', 'comparisons between amounts of heavier and lighter forms'],
      ['archive', 'an ordered store of records preserved for later study'],
    ],
    {
      'main-idea': 'Include both the preserved evidence and the interpretation work; neither alone captures the passage.',
      'inference': 'Follow the sequence from fallen snow to sealed pore to explain the age difference.',
      'vocabulary': 'The phrase “many physical records” explains why the core is called an archive.',
      'detail': 'Keep the old and new records separate: about 800,000 years versus at least 1.2 million.',
    },
  ),
});

REPAIRS.set('og-sci-forest-fungal-network', {
  references: ['https://www.nature.com/articles/s41559-023-01986-1'],
  title: 'What Connects Beneath a Forest',
  text: `Many tree roots form partnerships with fungi. Fine fungal threads reach through soil and can help a tree obtain water and minerals. In return, the fungus receives carbon-rich compounds made by the tree. This exchange between a plant and its fungal partner is well established.

One fungus may connect with more than one plant, creating what researchers call a common mycorrhizal network. Experiments have detected carbon or chemical changes associated with connected plants. Those findings show that movement can occur. They do not settle how common each route is in a forest, who benefits overall, or whether the fungus, the plants, or both control the exchange.

Testing the network is difficult. Roots may touch, substances may move through soil, and experimental barriers can change water and microbes as well as fungal links. A labeled atom found in a neighbor shows that it traveled, but not automatically that one tree deliberately fed another.

The phrase “wood wide web” is memorable, but it can make a forest sound like a human communication system. Evidence for helpful sharing and warning messages varies by species and experiment. A careful account keeps two ideas together: underground fungal connections are real, and their ecological meaning remains an active question.`,
  questions: [
    question('q1', 'main-idea', 'What is the passage mainly about?', [
      'Fungal partnerships and connections are real, but broad claims about tree sharing remain unsettled',
      'Every tree deliberately sends spare food to its weakest neighbor',
      'Fungi take carbon from trees without giving anything in return',
      'Scientists can observe forest networks without disturbing soil',
    ], 0, 'The passage separates established fungal partnerships and movement from unsettled claims about benefit and intent.'),
    question('q2', 'detail', 'What can fungal threads help a tree obtain?', [
      'Water and minerals from soil',
      'Sunlight from shaded leaves',
      'Seeds made by nearby plants',
      'Carbon dioxide stored in rocks',
    ], 0, 'The opening paragraph says fungal threads can help a tree obtain water and minerals.'),
    question('q3', 'inference', 'Why does finding a labeled atom in a neighboring tree not prove deliberate sharing?', [
      'The atom proves that no connection existed',
      'Movement alone does not show the route, benefit, control, or intent',
      'All labeled atoms are too large to pass through soil',
      'A neighboring tree cannot contain carbon compounds',
    ], 1, 'The passage repeatedly separates evidence of movement from claims about route, benefit, control, and intent.'),
    question('q4', 'vocabulary', 'In this passage, “network” means', [
      'a single root growing in a straight line',
      'a group of connected living partners or pathways',
      'an empty layer of soil beneath a forest',
      'a machine that measures sunlight',
    ], 1, 'A common mycorrhizal network can connect one fungus with more than one plant.'),
  ],
  lesson: lesson(
    'Read for levels of certainty. Paragraph one states an established partnership; paragraph two separates movement from its meaning; paragraphs three and four explain why a vivid network metaphor needs limits.',
    [
      ['is well established', 'Marks the strongest, least disputed claim in the passage.'],
      ['They do not settle', 'Separates observed movement from broader conclusions.'],
      ['Testing the network is difficult', 'Introduces alternative routes and experimental limits.'],
      ['keeps two ideas together', 'States the balanced conclusion: connection is real; meaning is unsettled.'],
    ],
    [
      ['mycorrhizal', 'describing a partnership or connection between plant roots and fungi'],
      ['barriers', 'experimental dividers that may change more than one soil condition'],
      ['network', 'a group of connected partners or pathways'],
    ],
    {
      'main-idea': 'Prefer the answer that preserves both certainty and uncertainty instead of choosing an extreme.',
      'inference': 'Evidence that something moved is not by itself evidence about intent or who gained.',
      'vocabulary': 'Use the example of one fungus connected with several plants to define network.',
      'detail': 'The direct fungus-to-tree trade is water and minerals in exchange for carbon-rich compounds.',
    },
  ),
});

REPAIRS.set('og-sci-greenhouse-effect', {
  references: ['https://www.ipcc.ch/report/ar6/wg3/downloads/faqs/IPCC_AR6_WGIII_FAQ_Chapter_03.pdf'],
  title: 'The Blanket of Air',
  text: `Earth stays warm enough for life partly because of gases in its atmosphere. Energy arrives from the Sun mostly as visible light and warms the surface. The surface sends energy upward as infrared radiation. Greenhouse gases, including carbon dioxide, methane, and water vapor, absorb and re-radiate some infrared energy, slowing its escape to space. Without this natural greenhouse effect, Earth would be much colder.

Human activities have strengthened the effect. Burning fossil fuels raises atmospheric carbon dioxide, while other activities add methane and nitrous oxide. More heat-trapping gas changes the planet’s energy balance. Oceans absorb most of the excess heat, and land, air, ice, and living systems respond at different speeds.

“Stopping emissions” needs a precise meaning. Cutting annual carbon dioxide emissions slows the rate at which more carbon accumulates, but temperatures do not stabilize while net emissions remain above zero. At sustained global net-zero carbon dioxide—when human removals balance remaining human emissions—carbon-dioxide-caused warming is expected to approximately stabilize, not climb forever. The result also depends on other greenhouse gases and aerosols.

Stabilized temperature does not mean a return to the former climate. Carbon dioxide and stored ocean heat persist, ice sheets respond slowly, and sea level can keep changing for centuries. Reaching net zero therefore prevents additional carbon-dioxide-driven warming while leaving a long task of adaptation. The important lag is not a reason to think action has no prompt effect; it is a reason to distinguish halting further warming from reversing changes already made.`,
  questions: [
    question('q1', 'inference', 'Why would sustained global net-zero carbon dioxide not restore the former climate immediately?', [
      'The Sun would suddenly produce more visible light',
      'Stored heat, long-lived carbon dioxide, ice, and sea level respond over long periods',
      'Net zero means human emissions continue rising each year',
      'Greenhouse gases stop interacting with infrared radiation',
    ], 1, 'The final paragraph distinguishes stabilizing additional CO2 warming from reversing persistent changes.'),
    question('q2', 'vocabulary', 'In this passage, “net zero” carbon dioxide means', [
      'all natural carbon dioxide disappears from the atmosphere',
      'every machine in the world stops at the same moment',
      'human removals balance the remaining human carbon dioxide emissions',
      'the oceans release all of their stored heat',
    ], 2, 'Paragraph three defines net zero as human removals balancing remaining human emissions.'),
    question('q3', 'main-idea', 'The passage is mainly concerned with', [
      'how the greenhouse effect works and what emissions cuts and net zero do to warming',
      'why the Sun has become hotter during the last century',
      'how oceans remove every greenhouse gas from the air',
      'why climate changes reverse as soon as one factory closes',
    ], 0, 'The passage explains the mechanism, human intensification, stabilization at net zero, and persistent effects.'),
    question('q4', 'detail', 'What role do oceans play as the climate warms?', [
      'They absorb most of the excess heat',
      'They prevent infrared radiation from reaching the air',
      'They eliminate the need to reduce emissions',
      'They return sea level to its earlier position',
    ], 0, 'The second paragraph states that oceans absorb most of the excess heat.'),
  ],
  lesson: lesson(
    'Keep three states separate: positive net emissions add warming, net-zero CO2 approximately stabilizes CO2-driven warming, and net-negative CO2 can help reverse it. The final paragraph separates temperature stabilization from slower impacts.',
    [
      ['Human activities have strengthened the effect', 'Turns from the natural process to the added human influence.'],
      ['needs a precise meaning', 'Warns that “stopping” can refer to very different emissions paths.'],
      ['approximately stabilize, not climb forever', 'States the expected CO2-warming response at sustained net zero.'],
      ['does not mean a return', 'Separates stabilization from immediate reversal.'],
    ],
    [
      ['infrared', 'the form of energy emitted upward by the warmed surface'],
      ['aerosols', 'small airborne particles that also affect the planet’s energy balance'],
      ['adaptation', 'adjusting to climate effects that already exist or persist'],
    ],
    {
      'main-idea': 'Follow the mechanism into the policy distinction; the passage is not only a definition of greenhouse gases.',
      'inference': 'Use the final paragraph to distinguish “no more warming” from “back to the old climate.”',
      'vocabulary': 'Net zero is defined between dashes in paragraph three; use that definition exactly.',
      'detail': 'Do not confuse heat storage with gas removal: the passage says oceans absorb excess heat.',
    },
  ),
});

REPAIRS.set('og-non-placebo-effect', {
  references: ['https://www.cochrane.org/evidence/CD003974_placebo-interventions-all-clinical-conditions'],
  title: 'The Puzzle of the Placebo Group',
  text: `In a medical trial, some participants may receive a real treatment while others receive a convincing imitation with no active drug. The imitation is called a placebo. If people in the placebo group improve, that change is often called the placebo response. It is not produced by one cause.

Expectation can change attention, pain, nausea, and other symptoms people report. The routine of care may matter too. But symptoms also rise and fall naturally. People often enter a trial when they feel especially ill, so some would improve anyway. Other care, measurement error, and the way people report changes can also affect the result.

Random assignment helps make these influences similar across groups. Blinding keeps participants and, when possible, evaluators from knowing who received which treatment. Researchers then compare the groups. If the treatment group improves more, the difference estimates the added effect of the treatment under the trial conditions.

This is why improvement after taking a pill does not by itself prove either a drug effect or a power of belief. A placebo group gathers several influences into a fair comparison. Trials also report uncertainty and possible harms, because one comparison never answers every medical question.`,
  questions: [
    question('q1', 'main-idea', 'What is the passage mainly about?', [
      'Why every improvement in a placebo group comes from belief',
      'How placebo groups help separate a treatment’s added effect from several shared influences',
      'Why people in trials never improve without an active drug',
      'How the shape of a pill determines its chemical effect',
    ], 1, 'The passage lists several causes of change and explains how random comparison estimates an added treatment effect.'),
    question('q2', 'detail', 'What is a placebo?', [
      'A convincing imitation with no active drug',
      'A medicine that has already passed every test',
      'A measurement of uncertainty in a trial',
      'An unwanted effect caused by a treatment',
    ], 0, 'The opening paragraph defines a placebo as a convincing imitation with no active drug.'),
    question('q3', 'inference', 'If the groups improve by the same average amount, what would that result suggest?', [
      'Belief alone caused every change in both groups',
      'The trial found no added benefit from the treatment under the tested conditions',
      'The placebo contained the same active drug',
      'Every participant would have worsened outside the trial',
    ], 1, 'Equal average improvement would not provide evidence of an added treatment benefit; the passage notes that uncertainty remains.'),
    question('q4', 'vocabulary', 'In this passage, “blinding” means', [
      'keeping people from knowing which treatment was assigned',
      'turning off the lights during an examination',
      'removing every measurement from the study',
      'preventing participants from reporting symptoms',
    ], 0, 'The passage defines blinding as keeping participants and evaluators from knowing assignments.'),
  ],
  lesson: lesson(
    'Do not treat placebo response as one mechanism. Sort the causes in paragraph two, then see how random assignment and blinding make the group difference—not improvement alone—the useful result.',
    [
      ['It is not produced by one cause', 'Rejects the shortcut that every placebo-group change is belief.'],
      ['But symptoms also rise and fall naturally', 'Adds natural history to expectation and care.'],
      ['Researchers then compare the groups', 'Marks the step that estimates an added treatment effect.'],
      ['does not by itself prove', 'States the limit on interpreting improvement after a pill.'],
    ],
    [
      ['placebo', 'a convincing imitation used without an active drug'],
      ['blinding', 'keeping treatment assignment unknown to reduce expectation and judgment effects'],
      ['uncertainty', 'the range of doubt that remains around a trial result'],
    ],
    {
      'main-idea': 'The core is comparison: several influences affect both groups, and the difference estimates added effect.',
      'inference': 'Equal group outcomes mean no demonstrated added benefit; they do not identify one cause for all change.',
      'vocabulary': 'The sentence after “Blinding” directly states who is kept from knowing what.',
      'detail': 'Paragraph two lists expectation alongside natural change, care, error, and reporting.',
    },
  ),
});

REPAIRS.set('og-non-decision-fatigue', {
  references: ['https://www.nature.com/articles/s44271-025-00207-8'],
  title: 'Does Choosing Wear Us Down?',
  text: `After many difficult choices, people sometimes feel tired or reach for an easy option. One explanation is called decision fatigue: the hypothesis that making repeated decisions reduces the quality of later choices.

Some studies have found patterns that fit the hypothesis. A person may accept a default, delay a decision, or use a shortcut later in a sequence. Yet a pattern over time has other possible causes. The later cases may be harder. People may become hungry, bored, rushed, or more experienced. Researchers may also choose one of many ways to define a “worse” decision.

Stronger tests try to separate these explanations. In one large preregistered study of healthcare calls, researchers predicted specific changes as workers handled repeated cases. They did not find the predicted decision-fatigue effects in that setting. This result does not prove that repeated choices never matter. It does challenge the idea of one general effect that reliably drains a fixed store of mental energy.

Reducing needless choices can still be useful. A routine may save time, lower stress, or prevent distraction. Those benefits do not prove a fuel-tank theory of the mind. The careful conclusion is narrower: mental work can feel tiring, but when and how repeated decisions alter judgment remains an active research question.`,
  questions: [
    question('q1', 'main-idea', 'The passage mainly argues that', [
      'decision fatigue is a debated hypothesis whose effects and mechanism are not settled',
      'every repeated choice empties the same fixed mental fuel tank',
      'routines are harmful because they remove all useful choices',
      'healthcare workers never feel tired during repeated work',
    ], 0, 'The passage presents the hypothesis, alternative explanations, a null result, and a cautious conclusion.'),
    question('q2', 'inference', 'Why does using a routine not prove that the mind has a fixed fuel tank?', [
      'A routine can help for reasons such as time, stress, or distraction',
      'A routine always creates more decisions than it removes',
      'People cannot feel tired while following a routine',
      'Researchers define every routine in the same way',
    ], 0, 'The final paragraph gives several benefits that do not require the fixed-energy explanation.'),
    question('q3', 'vocabulary', 'In this passage, a “hypothesis” is', [
      'a possible explanation that can be tested',
      'a result that no evidence could ever change',
      'a shortcut used to avoid every decision',
      'a list of cases in the order they arrived',
    ], 0, 'Decision fatigue is introduced as an explanation to test, not as an established fact.'),
    question('q4', 'detail', 'What did the large preregistered healthcare study find?', [
      'The predicted decision-fatigue effects did not appear in that setting',
      'Every later call received the same answer',
      'Workers stopped making decisions after one hour',
      'Hunger explained every change in judgment',
    ], 0, 'The third paragraph says the researchers did not find the predicted effects in that setting.'),
  ],
  lesson: lesson(
    'Track claim, alternatives, test, and conclusion. The passage does not replace “decision fatigue is true” with “fatigue never exists.” It narrows what the evidence supports and separates a useful routine from proof of a mechanism.',
    [
      ['the hypothesis that', 'Marks decision fatigue as a testable explanation, not a settled fact.'],
      ['other possible causes', 'Introduces rival explanations for the same pattern.'],
      ['did not find the predicted', 'Reports the preregistered study’s result with its setting attached.'],
      ['The careful conclusion is narrower', 'Signals the qualified final claim.'],
    ],
    [
      ['hypothesis', 'a possible explanation that researchers can test'],
      ['preregistered', 'planned and recorded before researchers saw the results'],
      ['default', 'an option selected when a person makes no active change'],
    ],
    {
      'main-idea': 'Keep the uncertainty: neither an absolute fuel theory nor “choices never matter” matches the passage.',
      'inference': 'A helpful routine can have several explanations, so usefulness alone does not identify a mechanism.',
      'vocabulary': 'The colon after “decision fatigue” introduces the hypothesis in plain language.',
      'detail': 'Attach the null result to its healthcare-call setting; do not turn one study into a universal proof.',
    },
  ),
});

REPAIRS.set('og-his-printing-press', {
  references: [
    'https://en.unesco.org/silkroad/content/did-you-know-invention-and-transfusion-printing-technology-east-asia-and-its-implications',
    'https://www.unesco.org/en/articles/200-years-gutenberg-master-printers-koryo-0',
  ],
  title: 'Printing Before and After Gutenberg',
  text: `Printing did not begin with Johannes Gutenberg. In East Asia, people printed from carved woodblocks centuries before his lifetime. Movable type appeared in China, and Korean printers used movable metal type before Gutenberg worked in Europe.

Around the 1440s in Mainz, Gutenberg developed a successful European system that combined reusable metal letters, suitable ink, and a press. Workers could arrange the letters for a page, print many copies, and then use the letters again. His system fit alphabetic writing, which needs a relatively small set of characters.

Printing spread quickly across Europe. Printers produced books, pamphlets, and other texts in larger numbers than hand copying allowed. Prices generally fell, although books did not become cheap or available to everyone at once. Reading, publishing, religion, government, and scholarship changed over time as more copies circulated.

The fuller history has several centers of invention. East Asian printers developed woodblock and movable-type methods earlier. Gutenberg’s achievement was not creating all printing from nothing; it was building a durable system that transformed book production in Europe.`,
  questions: [
    question('q1', 'main-idea', 'What is the passage mainly about?', [
      'Printing developed in several places, and Gutenberg’s system transformed European book production',
      'Every book in the world was copied by hand until the 1440s',
      'Gutenberg invented paper, ink, and written language together',
      'Movable metal type first appeared in Europe and then reached Korea',
    ], 0, 'The passage places Gutenberg’s European achievement within earlier East Asian printing history.'),
    question('q2', 'detail', 'Where were woodblock and movable-type printing used before Gutenberg?', [
      'East Asia',
      'South America',
      'Australia',
      'Antarctica',
    ], 0, 'The opening paragraph describes earlier woodblock and movable-type printing in East Asia.'),
    question('q3', 'inference', 'Why could reusable letters make many European copies faster than hand copying?', [
      'Workers could arrange, print, and reuse the same pieces',
      'Each reader carved a complete book from stone',
      'The press removed the need for ink',
      'Every language used only one written character',
    ], 0, 'The second paragraph describes arranging metal letters, printing copies, and using the letters again.'),
    question('q4', 'vocabulary', 'In the passage, “circulated” means', [
      'moved among more readers and places',
      'were hidden from the public',
      'were destroyed after one use',
      'were copied only by hand',
    ], 0, 'More copies circulated when they moved through society to more readers and places.'),
  ],
  lesson: lesson(
    'Use a both-and timeline. Earlier East Asian methods matter, and Gutenberg still made a major European system. Watch for scope words such as “in Europe” so an important regional change does not become a false worldwide first.',
    [
      ['did not begin with Johannes Gutenberg', 'Corrects the single-inventor opening before adding his real achievement.'],
      ['before Gutenberg worked in Europe', 'Establishes the earlier East Asian chronology.'],
      ['spread quickly across Europe', 'Keeps the claimed transformation in its historical region.'],
      ['several centers of invention', 'States the global frame of the revised history.'],
    ],
    [
      ['woodblocks', 'carved blocks used to print a page or design'],
      ['reusable', 'able to be arranged and used again for another page'],
      ['circulated', 'moved among readers and places'],
    ],
    {
      'main-idea': 'Choose the answer that preserves both earlier Asian printing and Gutenberg’s European transformation.',
      'inference': 'The repeated use of arranged letters explains the production advantage over copying every page by hand.',
      'vocabulary': 'Use the surrounding idea of more copies reaching society to define circulated.',
      'detail': 'The first paragraph names woodblock printing, Chinese movable type, and Korean metal type before Gutenberg.',
    },
  ),
});

REPAIRS.set('og-sci-coral-reef', {
  references: ['https://www.fisheries.noaa.gov/national/habitat-conservation/deep-sea-coral-habitat'],
  title: 'Cities Beneath the Waves',
  text: `A shallow tropical coral reef looks like a colorful rocky garden, but living animals build it. A coral colony contains tiny soft-bodied polyps. Many reef-building polyps make hard calcium-carbonate skeletons. As generations grow on older skeletons, the reef structure rises.

Inside many shallow reef-building corals live microscopic algae. The algae use sunlight to make food and share some products with the coral. In return, they receive shelter and materials they need. This partnership helps explain why these corals thrive in clear, sunlit water.

Not all corals live this way. Deep-sea corals grow far beyond sunlight and lack the same photosynthetic algae. They capture food carried by currents. Some form large habitats, although their shapes and growth differ from familiar tropical reefs.

When shallow tropical water stays too warm, a coral may expel its algae and turn pale, an event called bleaching. A bleached coral is alive, but it has lost an important energy source and may starve if stressful conditions continue. By naming which corals depend on sunlight, scientists avoid turning one important partnership into a rule for every coral in the sea.`,
  questions: [
    question('q1', 'main-idea', 'The passage is mainly about', [
      'how shallow reef-building corals depend on algae while deep-sea corals live differently',
      'why every coral in the ocean requires bright sunlight',
      'how tropical fish construct calcium-carbonate skeletons',
      'why bleaching means a coral is already dead',
    ], 0, 'The passage explains the shallow partnership, contrasts deep-sea corals, and returns to bleaching.'),
    question('q2', 'detail', 'What do algae provide to many shallow reef-building corals?', [
      'Products of food made using sunlight',
      'Deep-sea currents',
      'A hard shell made from steel',
      'Colder water during bleaching',
    ], 0, 'The algae use sunlight to make food and share some of those products with the coral.'),
    question('q3', 'inference', 'Why can deep-sea corals live without sunlight?', [
      'They capture food carried by currents instead of relying on photosynthetic algae',
      'They produce sunlight inside their skeletons',
      'They rise to the surface every day to feed',
      'They are not living animals',
    ], 0, 'The third paragraph contrasts their current-borne food with the shallow algae partnership.'),
    question('q4', 'vocabulary', 'In this passage, “expel” means', [
      'push out',
      'feed',
      'copy',
      'cool',
    ], 0, 'During bleaching a shallow coral expels, or pushes out, its algae.'),
  ],
  lesson: lesson(
    'Watch the scope. Paragraphs one and two concern many shallow tropical reef builders; paragraph three gives the deep-sea contrast. The final paragraph uses that distinction to explain bleaching without claiming all corals need sunlight.',
    [
      ['shallow tropical coral reef', 'Sets the scope before the algae partnership is explained.'],
      ['Not all corals live this way', 'Introduces the counterexample that limits the sunlight rule.'],
      ['far beyond sunlight', 'Shows that deep-sea corals use a different feeding strategy.'],
      ['which corals depend on sunlight', 'Restates why a precise category matters.'],
    ],
    [
      ['polyps', 'tiny soft-bodied animals that make up a coral colony'],
      ['photosynthetic', 'using light to make food'],
      ['bleaching', 'the pale state after a coral loses its algae'],
    ],
    {
      'main-idea': 'A correct summary includes both the shallow partnership and the deep-sea exception.',
      'inference': 'Use the feeding contrast: current-borne food lets deep-sea corals live without photosynthetic algae.',
      'vocabulary': 'The bleaching sentence shows that expel means push the algae out.',
      'detail': 'Keep builders and partners separate: polyps build skeletons; algae make food products using light.',
    },
  ),
});

REPAIRS.set('og-sci-moon-tides', {
  references: ['https://oceanservice.noaa.gov/facts/high-tide.html'],
  title: 'Why the Sea Rises and Falls',
  text: `At many coasts, the sea rises and falls twice during a tidal day. At some places it rises and falls once, and at others the two daily tides have different heights. These patterns are tides, caused mainly by the Moon’s gravity and also by the Sun.

The Moon’s pull is stronger on the side of Earth nearer the Moon than on the far side. In a simple picture, this difference produces two broad tidal bulges. As Earth turns, a coast moves through the pattern.

Real oceans do not cover a smooth, round Earth. Continents block the water, and the shapes of coasts and the seafloor change how it moves. That is why local tides may be semidiurnal, with two similar highs; diurnal, with one; or mixed, with two unequal highs.

The Sun changes tidal range too. Near new and full moons, the Sun, Moon, and Earth line up, so their effects combine to make larger spring tides. Near quarter moons, their directions differ and the range is usually smaller. A tide table uses local measurements and predictions because the Moon supplies the main rhythm, but each coast reshapes it.`,
  questions: [
    question('q1', 'main-idea', 'What is this passage mainly about?', [
      'How the Moon and Sun create a tidal rhythm that local geography reshapes',
      'Why every coast has two tides of exactly equal height',
      'How fish cause the sea to rise near the shore',
      'Why continents move around Earth each day',
    ], 0, 'The passage combines astronomical causes with the local effects of continents, coasts, and seafloor.'),
    question('q2', 'detail', 'Which local features can change a coast’s tidal pattern?', [
      'The shapes of continents, coasts, and the seafloor',
      'The color of clouds above the beach',
      'The number of fish near the surface',
      'The kind of sand in a child’s bucket',
    ], 0, 'The third paragraph names continents, coast shape, and seafloor shape.'),
    question('q3', 'vocabulary', 'A “diurnal” tidal pattern has', [
      'one high and one low tide during a tidal day',
      'two equal high tides every hour',
      'no change in water level',
      'only a full-moon tide',
    ], 0, 'The passage defines diurnal as a pattern with one daily high, paired with one low.'),
    question('q4', 'inference', 'When are tidal ranges usually smaller than at new or full moon?', [
      'Near quarter moons, when the Sun and Moon pull in different directions',
      'Whenever a coast has a tide table',
      'Only when Earth stops turning',
      'Whenever the Moon is visible during the day',
    ], 0, 'The final paragraph contrasts the combined alignment with the different directions near quarter moons.'),
  ],
  lesson: lesson(
    'Read the simple model, then its correction. The Moon and Sun provide the broad rhythm; continents and basin shape change what a coast experiences. Do not turn a useful two-bulge picture into a promise of two equal tides everywhere.',
    [
      ['At many coasts', 'Scopes the opening pattern instead of claiming it for every place.'],
      ['In a simple picture', 'Marks the two-bulge model as a first explanation.'],
      ['Real oceans do not cover a smooth, round Earth', 'Introduces the geography that changes local tides.'],
      ['because the Moon supplies the main rhythm', 'Balances the astronomical cause with local reshaping.'],
    ],
    [
      ['tides', 'repeated rises and falls of sea level'],
      ['diurnal', 'having one high and one low tide in a tidal day'],
      ['range', 'the vertical difference between high and low water'],
    ],
    {
      'main-idea': 'Join the source of the rhythm to the local geography that changes it.',
      'inference': 'Compare the line-up at new/full moon with the different directions near quarter moon.',
      'vocabulary': 'The passage defines each tidal pattern immediately after naming it.',
      'detail': 'Local variation comes from physical geography, not from whether the Moon is visible.',
    },
  ),
});

REPAIRS.set('og-non-path-dependence', {
  references: ['https://www.britannica.com/topic/path-dependence'],
  title: 'The Road Built on a Footpath',
  text: `Imagine a town whose first footpath bends around a wet field. Carts begin using it, so workers add gravel. Shops face the busier route. Later the town lays water pipes beneath it, builds houses beside it, and finally covers it with pavement. By then the field has been drained. A straight road might serve new traffic better, but moving the old road would also mean moving pipes, entrances, and businesses.

This is path dependence: earlier choices change the cost and range of later choices. The original bend may have been sensible when the field was wet. After the reason disappears, the route can remain because people have built around it.

Path dependence does not mean that change is impossible or that the first choice always wins. A town may build a bypass when congestion becomes costly enough. A software community may replace an old format when conversion tools improve. The idea is that history changes the comparison. A design is judged not against a blank world, but against the expense of leaving the system already in use.

This matters when making early standards. A choice that is cheap to revise today can gather users, training, tools, and physical structures. Each new layer makes revision harder. Builders should therefore ask two questions: what works now, and what will other people have to rebuild if this choice later changes?`,
  questions: [
    question('q1', 'main-idea', 'What is the main idea of the passage?', [
      'Early choices can persist because later investments make changing course costly',
      'Every curved road should be replaced by a straight road',
      'The first design always defeats every alternative',
      'Path dependence means history has no effect on present choices',
    ], 0, 'The road and other examples show how later investment changes the cost of revising an early choice.'),
    question('q2', 'detail', 'What makes moving the old road expensive?', [
      'Pipes, entrances, houses, and businesses have been built around it',
      'The wet field becomes larger every year',
      'No one in the town knows how to build a road',
      'Gravel cannot be removed after it is placed',
    ], 0, 'The opening paragraph lists the later structures that now depend on the route.'),
    question('q3', 'inference', 'Why might a town still build a bypass?', [
      'The cost of congestion may eventually exceed the cost of changing the route',
      'Path dependence makes all change automatic',
      'A bypass removes every earlier investment',
      'The first footpath was never useful in any condition',
    ], 0, 'The third paragraph says change can occur when the problem becomes costly enough.'),
    question('q4', 'vocabulary', 'In this passage, “revision” means', [
      'a change to something already built or chosen',
      'a history of the town’s first residents',
      'a layer of gravel beneath pavement',
      'a fee charged to businesses near a road',
    ], 0, 'Revision refers to changing an existing design or standard.'),
  ],
  lesson: lesson(
    'Treat the footpath as a model, not just a road story. Follow each added layer and ask how it changes the next decision. Then notice the limits: dependence raises the cost of change but does not make change impossible.',
    [
      ['By then the field has been drained', 'Shows that the original reason can vanish while the route remains.'],
      ['earlier choices change the cost', 'Defines path dependence without claiming the first choice was best.'],
      ['does not mean that change is impossible', 'Blocks an overly absolute reading of the concept.'],
      ['Each new layer makes revision harder', 'Restates how dependence accumulates over time.'],
    ],
    [
      ['dependence', 'a condition in which later options are shaped by an earlier path'],
      ['bypass', 'a new route built around a crowded or difficult older route'],
      ['revision', 'a change to something already chosen or built'],
    ],
    {
      'main-idea': 'Generalize from the road to the principle: later investment makes an early path costly to leave.',
      'inference': 'Path dependence changes costs; it does not forbid a bypass when the balance of costs changes.',
      'vocabulary': 'The nearby phrase “makes revision harder” frames revision as changing the existing system.',
      'detail': 'Paragraph one names the concrete dependencies: pipes, entrances, houses, and businesses.',
    },
  ),
});

REPAIRS.set('og-l3-a-sheet-that-keeps-its-shape', {
  references: ['https://www.iso.org/obp/ui/#iso:std:iso:216:ed-2:v1:en'],
  title: 'A Sheet That Nearly Keeps Its Shape',
  text: `Fold an A4 sheet in half across its long side and the smaller rectangle is nearly the same shape as the whole. The A-series is based on an ideal ratio: the long side divided by the short side equals the square root of two, about 1.414. This is the one rectangular proportion that returns after exact halving.

The ideal rule creates a family of related sizes. A design can shrink from a poster to a flyer without changing proportions, and a copier can use one scale factor between neighboring sizes. The theoretical starting sheet, A0, has an area of one square meter. Each later size has half the preceding area.

Physical paper uses whole-millimeter dimensions and manufacturing tolerances. An A4 sheet is listed as 210 by 297 millimeters, so its measured ratio is close to, not exactly, the mathematical value. A physical A0 sheet is likewise nominally one square meter rather than a perfect geometric object.

The distinction does not weaken the standard. It explains how standards connect an exact idea with objects that must be cut and measured in the real world. North American letter paper uses a different proportion, so halving it does not preserve even the ideal shape. A small mathematical choice can simplify a large system of paper, printing, and machines.`,
  questions: [
    question('q1', 'main-idea', 'Which sentence best states the main idea?', [
      'A-series paper applies an exact geometric ratio through rounded real-world dimensions',
      'All paper sheets have exactly the same measured proportions',
      'A0 paper is always cut without any manufacturing tolerance',
      'North American letter paper uses the square-root-of-two ratio',
    ], 0, 'The passage distinguishes the exact ideal from the close, practical dimensions used for real sheets.'),
    question('q2', 'inference', 'Why can a copier use one scale factor between neighboring A sizes?', [
      'The ideal proportions repeat when the sheet is halved',
      'Every A-series sheet has the same area',
      'Physical sheets have no measurement tolerances',
      'A copier changes the shape of every image',
    ], 0, 'Because the ideal shape repeats, scaling changes size without changing proportions.'),
    question('q3', 'vocabulary', 'In this passage, “nominally” means', [
      'by its stated standard or name, though a physical measurement may vary slightly',
      'secretly larger than every listed dimension',
      'made without using any mathematical idea',
      'available only in North America',
    ], 0, 'The text contrasts the nominal one-square-meter standard with a physical object and tolerances.'),
    question('q4', 'detail', 'What is the theoretical area of an A0 sheet?', [
      'One square meter',
      'Two square meters',
      'One square millimeter',
      'Exactly 210 by 297 meters',
    ], 0, 'The second paragraph gives one square meter as the theoretical A0 starting area.'),
  ],
  lesson: lesson(
    'Keep ideal geometry and manufactured paper in separate columns. The square-root-of-two rule is exact in the model; millimeter dimensions and tolerances make real sheets close approximations.',
    [
      ['based on an ideal ratio', 'Marks the exact mathematical model behind the size family.'],
      ['The theoretical starting sheet', 'Keeps the one-square-meter claim in the ideal definition.'],
      ['close to, not exactly', 'States the effect of rounded millimeter dimensions.'],
      ['does not weaken the standard', 'Explains why approximation is compatible with useful standardization.'],
    ],
    [
      ['ratio', 'a comparison between the long and short side lengths'],
      ['tolerances', 'allowed small differences in manufactured dimensions'],
      ['nominally', 'by the stated standard, while actual measurement may vary slightly'],
    ],
    {
      'main-idea': 'Preserve the contrast between an exact model and approximate physical implementation.',
      'inference': 'Repeated ideal proportions explain why one scale factor works between sizes.',
      'vocabulary': 'Use the contrast with “perfect geometric object” to understand nominally.',
      'detail': 'Theoretical A0 area and physical millimeter dimensions are different kinds of facts.',
    },
  ),
});

REPAIRS.set('og-eco2-sharing-the-risk', {
  references: ['https://content.naic.org/consumer/insurance.htm'],
  title: 'Sharing The Risk',
  text: `Imagine a simple model with one thousand similar houses. An insurer estimates that about one covered house fire will occur during the year, although no one knows which house it will be. This is an illustration, not a universal fire rate. Real risk changes with place, building, weather, coverage, and time.

Insurance exists because many owners would rather face a smaller, predictable cost than a rare, ruinous loss. Each household pays a premium into a common pool. When a covered loss occurs, the pool pays according to the policy. One household’s event is hard to predict; patterns across many similar risks can be estimated more reliably.

Two problems can follow. If coverage removes too much consequence, an owner may take less care because the pool will pay. Economists call this moral hazard. If people with the highest risks are much more likely to buy coverage, claims may exceed what the original price assumed.

Insurers respond with deductibles, inspections, coverage rules, and prices based on relevant risk. These tools are imperfect and can raise questions about access and fairness. The aim is to spread severe losses while keeping the pool able to pay and preserving reasons to reduce preventable harm.`,
  questions: [
    question('q1', 'main-idea', 'Which sentence best states the main idea?', [
      'Insurance pools uncertain individual losses and uses rules to keep that sharing workable',
      'One house in every thousand burns everywhere each year',
      'Insurance removes every reason to prevent damage',
      'A premium guarantees that every possible loss is covered',
    ], 0, 'The passage explains pooling, prediction, problems, and the tools used to manage them.'),
    question('q2', 'detail', 'What does each household pay into the common pool?', [
      'A premium',
      'A fire rate',
      'A weather report',
      'A building permit',
    ], 0, 'The second paragraph states that each household pays a premium.'),
    question('q3', 'inference', 'Why is the one-in-a-thousand figure labeled an illustration?', [
      'Actual fire risk varies with place, building, weather, coverage, and time',
      'Insurers never use estimates for groups of houses',
      'Every house has exactly the same chance of damage',
      'The model predicts which named house will burn',
    ], 0, 'The opening explicitly lists conditions that make a real rate vary.'),
    question('q4', 'vocabulary', 'In this passage, “moral hazard” refers to', [
      'taking less care because another party will bear much of the loss',
      'charging the same price for every possible risk',
      'predicting exactly which household will file a claim',
      'refusing to pay a premium into a shared pool',
    ], 0, 'The passage names moral hazard after describing reduced care when the pool will pay.'),
  ],
  lesson: lesson(
    'Separate the hypothetical model from a measured rate. Then follow the economic structure: pool, group estimate, two problems, and responses. The final paragraph adds the tradeoff between solvency, incentives, access, and fairness.',
    [
      ['This is an illustration', 'Prevents a teaching number from becoming a universal factual rate.'],
      ['a common pool', 'Names the shared fund at the center of insurance.'],
      ['Two problems can follow', 'Signals the move from mechanism to side effects.'],
      ['These tools are imperfect', 'Adds limits and fairness concerns to the proposed responses.'],
    ],
    [
      ['premium', 'the payment made for insurance coverage'],
      ['pool', 'money collected from many policyholders to pay covered losses'],
      ['deductibles', 'amounts policyholders pay before insurance pays a covered claim'],
    ],
    {
      'main-idea': 'Include both risk sharing and the rules needed to keep the pool workable.',
      'inference': 'A hypothetical rate illustrates pooling; the listed real-world variables prevent universal use.',
      'vocabulary': 'Technical terms are defined immediately through an example or action.',
      'detail': 'A premium enters the pool; a deductible is paid when a covered claim occurs.',
    },
  ),
});

REPAIRS.set('og-l1-why-we-shiver', {
  references: [
    'https://medlineplus.gov/ency/article/001982.htm',
    'https://www.ncbi.nlm.nih.gov/books/NBK538294/',
  ],
  title: 'Why We Shiver',
  text: `Your body keeps its core temperature within a narrow range. It is often near 37 degrees Celsius, but the exact number changes with the person, time of day, activity, and place of measurement. When cold air pulls heat from your body, your temperature can begin to fall.

The brain watches for that change. A control center acts a little like a thermostat in a room. It sends signals that tighten and release your muscles many times. The quick, repeated motion is a shiver.

Moving muscles produce heat. A runner warms up for the same reason. Shivering uses muscle motion without waiting for you to choose it. The heat helps defend your core temperature.

Shivering also uses energy, so it can be tiring. It is one response to cold, not a promise that the body can handle any temperature. Strong or lasting shivering can be a sign to get warm and seek help when needed.`,
  questions: [
    question('q1', 'main-idea', 'What is the passage mainly about?', [
      'How repeated muscle motion makes heat when the body gets cold',
      'Why every person has exactly the same temperature all day',
      'How running stops the brain from sensing cold',
      'Why shivering uses no energy',
    ], 0, 'The passage follows a drop in temperature to brain signals, muscle motion, and heat.'),
    question('q2', 'vocabulary', 'A “thermostat” is something that', [
      'watches temperature and responds when it changes',
      'measures how fast a runner moves',
      'stores food for the muscles',
      'keeps every person at one exact number',
    ], 0, 'The brain’s control center is compared with a room thermostat that responds to temperature.'),
    question('q3', 'detail', 'What do the brain’s signals make muscles do?', [
      'Tighten and release many times',
      'Stop using energy',
      'Cool the body from inside',
      'Remain still for several hours',
    ], 0, 'The second paragraph says the muscles tighten and release repeatedly.'),
    question('q4', 'inference', 'Why can shivering make a person tired?', [
      'Repeated muscle motion uses energy',
      'The body stops producing all heat',
      'The exact temperature never changes',
      'A thermostat becomes heavier in cold air',
    ], 0, 'The final paragraph connects the energy used by muscle motion with tiredness.'),
  ],
  lesson: lesson(
    'Follow the cause-and-effect chain: heat loss, brain signal, repeated muscle motion, heat. Keep “near 37” as a typical reference, not one number held perfectly by every person all day.',
    [
      ['within a narrow range', 'Replaces the false idea of one exact temperature at all times.'],
      ['acts a little like a thermostat', 'Introduces the control-system comparison.'],
      ['The quick, repeated motion is a shiver', 'Names shivering after describing the muscle action.'],
      ['one response to cold', 'Limits what shivering can do in severe or lasting cold.'],
    ],
    [
      ['core', 'the central parts of the body whose temperature is regulated'],
      ['thermostat', 'a control that senses temperature and responds to change'],
      ['shiver', 'quick repeated muscle tightening and releasing that makes heat'],
    ],
    {
      'main-idea': 'The passage explains a process: cold triggers muscle motion, which produces heat.',
      'inference': 'Muscles need energy to move, so repeated motion can cause tiredness.',
      'vocabulary': 'Use the room-control comparison to understand thermostat.',
      'detail': 'The exact muscle action is stated in paragraph two: tighten and release many times.',
    },
  ),
});

function contentFingerprint(passage) {
  const content = {
    title: passage.title,
    text: passage.text,
    questions: passage.questions,
    lesson: passage.lesson,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function desiredFingerprint(repair) {
  return contentFingerprint(repair);
}

// The reviewed prose/questions above name their correct choice before layout.
// Rotate presentation positions across the 16 × 4 repaired assessments so the
// rewrite does not introduce a conspicuous all-first-choice answer cue. Retain
// the pre-rotation reviewed fingerprint as an accepted intermediate state for
// release-candidate iterations made with an earlier version of this script.
for (const [passageIndex, [id, repair]] of [...REPAIRS.entries()].entries()) {
  const sources = SOURCE_HASHES.get(id);
  if (!sources) throw new Error(`${id}: missing source fingerprint list.`);
  sources.push(desiredFingerprint(repair));
  repair.questions.forEach((item, questionIndex) => {
    const target = (passageIndex + questionIndex) % 4;
    if (item.answer === target) return;
    const correct = item.choices[item.answer];
    const distractors = item.choices.filter((_choice, index) => index !== item.answer);
    distractors.splice(target, 0, correct);
    item.choices = distractors;
    item.answer = target;
  });
}

function validateRepair(id, repair) {
  if (!Array.isArray(repair.references) || repair.references.length === 0) {
    throw new Error(`${id}: repair must retain at least one review source.`);
  }
  if (typeof repair.title !== 'string' || !repair.title.trim()) throw new Error(`${id}: invalid title.`);
  if (typeof repair.text !== 'string' || !repair.text.trim()) throw new Error(`${id}: invalid text.`);
  const words = repair.text.trim().split(/\s+/);
  if (words.length < 80 || words.length > 300) {
    throw new Error(`${id}: repaired text has ${words.length} words; expected 80..300.`);
  }
  if (!Array.isArray(repair.questions) || repair.questions.length !== 4) {
    throw new Error(`${id}: repaired questions must contain exactly four items.`);
  }
  const qids = new Set();
  const skills = new Set();
  for (const q of repair.questions) {
    if (qids.has(q.id)) throw new Error(`${id}: duplicate question ID ${q.id}.`);
    qids.add(q.id);
    skills.add(q.skill);
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || new Set(q.choices).size !== 4) {
      throw new Error(`${id}/${q.id}: choices must be four unique strings.`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      throw new Error(`${id}/${q.id}: answer is outside choices.`);
    }
    for (const field of ['stem', 'explanation']) {
      if (typeof q[field] !== 'string' || !q[field].trim()) throw new Error(`${id}/${q.id}: ${field} is empty.`);
    }
  }
  if (skills.size !== SKILLS.size || [...SKILLS].some((skill) => !skills.has(skill))) {
    throw new Error(`${id}: questions must cover each required skill exactly once.`);
  }
  const value = repair.lesson;
  if (!value || typeof value.strategy !== 'string' || !value.strategy.trim() || value.strategy.length > 320) {
    throw new Error(`${id}: invalid lesson strategy.`);
  }
  if (!Array.isArray(value.signals) || value.signals.length < 2 || value.signals.length > 4) {
    throw new Error(`${id}: lesson must contain 2..4 signals.`);
  }
  const foldedText = repair.text.toLocaleLowerCase();
  for (const signal of value.signals) {
    if (signal.phrase.length > 60 || !foldedText.includes(signal.phrase.toLocaleLowerCase())) {
      throw new Error(`${id}: signal is too long or not exact passage text: ${JSON.stringify(signal.phrase)}.`);
    }
    if (!signal.means.trim() || signal.means.length > 120) throw new Error(`${id}: invalid signal explanation.`);
  }
  if (!Array.isArray(value.vocab) || value.vocab.length < 2 || value.vocab.length > 3) {
    throw new Error(`${id}: lesson must contain 2..3 vocab items.`);
  }
  for (const item of value.vocab) {
    if (!foldedText.includes(item.word.toLocaleLowerCase()) || item.inContext.length > 100) {
      throw new Error(`${id}: vocab is ungrounded or context is too long: ${JSON.stringify(item.word)}.`);
    }
  }
  if (!value.skillTips || new Set(Object.keys(value.skillTips)).size !== SKILLS.size
      || [...SKILLS].some((skill) => !(skill in value.skillTips))) {
    throw new Error(`${id}: lesson skillTips must cover all four skills.`);
  }
  for (const [skill, tip] of Object.entries(value.skillTips)) {
    if (!tip.trim() || tip.length > 200) throw new Error(`${id}: invalid ${skill} skill tip.`);
  }
}

const options = parseArgs(process.argv.slice(2));
const data = JSON.parse(readFileSync(options.input, 'utf8'));
if (data.schema !== 1 || ![11, 12].includes(data.version) || !Array.isArray(data.passages)) {
  throw new Error(`Expected schema=1 and version=11/12; found schema=${data.schema}, version=${data.version}.`);
}

const legacyPassages = data.passages.filter((passage) => !YEAR_PACK_ID.test(passage.id));
if (legacyPassages.length !== 286) throw new Error(`Expected exactly 286 legacy passages, found ${legacyPassages.length}.`);
const passagesById = new Map(data.passages.map((passage) => [passage.id, passage]));
if (passagesById.size !== data.passages.length) throw new Error('Passage IDs must be unique.');

const beforePassageIds = data.passages.map((passage) => passage.id);
const beforeLevels = new Map(data.passages.map((passage) => [passage.id, passage.level]));
const targetIds = new Set(REPAIRS.keys());
const beforeNonTargets = new Map(data.passages
  .filter((passage) => !targetIds.has(passage.id))
  .map((passage) => [passage.id, JSON.stringify(passage)]));
const beforeQuestionIds = new Map(data.passages.map((passage) => [
  passage.id,
  passage.questions.map((q) => q.id),
]));
const changes = [];
const unchanged = [];

for (const [id, repair] of REPAIRS) {
  validateRepair(id, repair);
  const passage = passagesById.get(id);
  if (!passage) throw new Error(`Required passage is missing: ${id}.`);
  if (YEAR_PACK_ID.test(id)) throw new Error(`${id}: target must be a legacy passage.`);
  const existingIds = passage.questions.map((q) => q.id);
  const desiredIds = repair.questions.map((q) => q.id);
  if (JSON.stringify(existingIds) !== JSON.stringify(desiredIds)) {
    throw new Error(`${id}: question IDs/order differ; expected ${JSON.stringify(desiredIds)}, found ${JSON.stringify(existingIds)}.`);
  }
  const existingSkills = passage.questions.map((q) => q.skill);
  const desiredSkills = repair.questions.map((q) => q.skill);
  if (JSON.stringify(existingSkills) !== JSON.stringify(desiredSkills)) {
    if (new Set(existingSkills).size !== SKILLS.size
        || [...SKILLS].some((skill) => !existingSkills.includes(skill))) {
      throw new Error(`${id}: source questions do not cover the four recognized skills exactly once.`);
    }
  }

  const beforeHash = contentFingerprint(passage);
  const afterHash = desiredFingerprint(repair);
  if (beforeHash === afterHash) {
    unchanged.push(id);
    continue;
  }
  if (!(SOURCE_HASHES.get(id) ?? []).includes(beforeHash)) {
    throw new Error(`${id}: source fingerprint ${beforeHash} is neither a reviewed source state nor repaired state.`);
  }

  passage.title = repair.title;
  passage.text = repair.text;
  passage.wordCount = repair.text.trim().split(/\s+/).length;
  passage.questions = structuredClone(repair.questions);
  passage.lesson = structuredClone(repair.lesson);
  changes.push(id);
}

const afterPassageIds = data.passages.map((passage) => passage.id);
if (JSON.stringify(beforePassageIds) !== JSON.stringify(afterPassageIds)) {
  throw new Error('Passage ID/order invariant failed.');
}
for (const passage of data.passages) {
  if (passage.level !== beforeLevels.get(passage.id)) {
    throw new Error(`${passage.id}: level invariant failed.`);
  }
  if (JSON.stringify(beforeQuestionIds.get(passage.id)) !== JSON.stringify(passage.questions.map((q) => q.id))) {
    throw new Error(`${passage.id}: question ID/order invariant failed.`);
  }
  if (!targetIds.has(passage.id) && JSON.stringify(passage) !== beforeNonTargets.get(passage.id)) {
    throw new Error(`${passage.id}: non-target passage changed.`);
  }
}

for (const [id, repair] of REPAIRS) {
  const passage = passagesById.get(id);
  if (contentFingerprint(passage) !== desiredFingerprint(repair)) {
    throw new Error(`${id}: post-repair content fingerprint mismatch.`);
  }
  if (passage.wordCount !== passage.text.trim().split(/\s+/).length) {
    throw new Error(`${id}: repaired wordCount mismatch.`);
  }
}

if (!options.dryRun) writeFileSync(options.output, `${JSON.stringify(data, null, 2)}\n`);
const result = {
  mode: options.dryRun ? 'dry-run' : 'write',
  schema: data.schema,
  version: data.version,
  passageCount: data.passages.length,
  legacyPassageCount: legacyPassages.length,
  targetCount: REPAIRS.size,
  changedCount: changes.length,
  unchangedCount: unchanged.length,
  changedIds: changes,
  invariants: {
    passageIdsAndOrderPreserved: true,
    questionIdsAndOrderPreserved: true,
    levelsPreserved: true,
    nonTargetPassagesPreserved: true,
  },
};
console.log(JSON.stringify(result, null, 2));
