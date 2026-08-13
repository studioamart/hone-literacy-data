# Legacy corpus audit — August 2026

Scope: the 286 readings in OTA corpus v11, before the 365-reading year pack is
merged. Stable passage IDs and question IDs are treated as public data keys and
must not change.

## Baseline

The corpus is runtime-playable: 286 unique IDs, 1,156 questions, all four
comprehension skills present on every passage, four distinct choices per
question, in-range answer keys, and no missing required Codable field.

The stricter baseline audit found no decode/playability errors and 290
improvement items. The v12 release treatment is recorded below:

| Finding | Count | Release treatment |
|---|---:|---|
| Missing explicit `wordCount` | 51 | Filled from the app's whitespace-token rule |
| Single-paragraph reading | 60 | Added 122 human-reviewed sentence-boundary breaks without changing prose |
| Four vocabulary coaching items | 105 | Kept the three most useful context words |
| Five signal phrases | 20 | Kept four cues that best expose the text's structure |
| Signal phrase over 60 characters | 41 | Shortened to an exact, paragraph-local phrase |
| Strategy over 320 characters | 8 | Tightened while preserving passage-specific guidance |
| Vocabulary context over 100 characters | 1 | Tightened the definition |
| Duplicate title | 2 title pairs / 4 readings | Retitled the later reading; preserved IDs |

Single-block text is valid app content, but the guided reread benefits from
short paragraphs. Every inserted break was therefore reviewed for rhetorical
shape, and collapsing the added blank lines restores the original prose exactly.

The answer key is also position-biased: positions 0–3 currently occur 291,
467, 226, and 172 times. The normalization tool can rebalance this by moving
choices without changing their text or which answer is correct, producing 289
answers in each position. That option remains opt-in until an editorial review
confirms each question still reads naturally after reordering.

The release did **not** use that option. Stable choice order and answer indexes
remain unchanged except inside explicitly rewritten, human-reviewed passages.

## Material content repairs

The risk-focused audit also led to 27 explicit passage rewrites:

- 16 science, health, technology, and quantitative corrections, including ice
  density, microwave heating, password guidance, ice-core age, fungal-network
  certainty, net-zero framing, placebo trials, tides, and A-series paper;
- 11 history and suitability repairs, including the Irish Famine, Great Wall,
  Library of Alexandria, coffeehouses, Roman roads, Jenner, Humboldt,
  Sequoyah, Sarajevo, and two all-ages replacements; and
- coherent updates to each affected question, explanation, lesson signal,
  vocabulary entry, and skill tip.

Each repair is encoded in an ID-keyed, source-documented, fail-closed migration
script. All other legacy objects are preserved. The scripts are idempotent and
reject unreviewed source or repaired states.

## Editorial review

The corpus-wide audit and targeted editorial review checked for:

- one unambiguous, passage-grounded correct answer;
- plausible distractors that are wrong for a textual reason, not a trick;
- a main-idea answer that works as the app's recall-reference gist;
- durable, accurately framed factual claims and careful qualifications;
- level-appropriate syntax and vocabulary;
- lesson cues that are exact substrings in one paragraph;
- respectful, broadly suitable subject matter and varied human settings; and
- accidental duplication within the legacy set and against the year pack.

The final v12 corpus passes `python3 scripts/audit-corpus.py --strict` with zero
errors and zero warnings and decodes through the app-compatible Swift model as
651 playable passages and 2,616 questions. See
[editorial-audit-2026-08.md](editorial-audit-2026-08.md) for the risk findings
and [year-of-readings-2026/FACT-CHECK-NOTES.md](year-of-readings-2026/FACT-CHECK-NOTES.md)
for the year-pack fact-check record.
