# A Year of Readings (2026)

This pack contains the **365 original English readings** first published in
corpus v12. The batch records mirror those same records in the current OTA
corpus. `data/passages.json` remains the single file downloaded by the app.

## Fixed distribution

- 365 new passages: IDs `og-y26-d001-*` through `og-y26-d365-*`.
- 73 passages at each level (1 through 5).
- The existing 12 genres are retained. The cycle is fiction, history, nature,
  nonfiction, science, biography, economics, essay, fable, philosophy,
  psychology, technology. Genre for day `d` is item `(d - 1) % 12` in that
  cycle. Fiction, history, nature, nonfiction, and science therefore receive 31
  passages each; the remaining seven genres receive 30 each.
- Level for day `d` is `((d - 1) % 5) + 1`, yielding exactly 73 per level.
- Every passage has four questions, one each for `main-idea`, `inference`,
  `vocabulary`, and `detail`, in that order.
- Answer positions rotate by day and question. For day `d` and zero-based
  question index `q`, the correct answer index is `(d - 1 + q) % 4`. This gives
  every passage one answer in each position and prevents position bias.

## Level bands

`wordCount` uses the app's whitespace-token rule and must exactly match `text`.

| Level | Words | Writing target |
|---|---:|---|
| 1 | 115–145 | Concrete sequence, common vocabulary, short sentences |
| 2 | 140–175 | Clear cause/effect, one or two useful unfamiliar words |
| 3 | 165–200 | Multiple connected ideas, moderate inference |
| 4 | 190–225 | Denser explanation or narrative reversal |
| 5 | 215–255 | Nuance, competing interpretations, or layered causality |

Each text uses two to four short paragraphs. Difficulty should come from the
reasoning and language, not obscurity for its own sake.

Five published v15 records sit one or two whitespace tokens above these
authoring targets after a punctuation-only normalization. The validator names
those exact IDs and counts as narrow exceptions. New or differently sized
records must stay inside the table.

## App-facing fields

Every item follows schema 1 and uses these fixed original-work fields:

```json
{
  "sourceType": "original",
  "source": "Written for Fluency",
  "attribution": "Original passage © Studio AM, written for Fluency.",
  "releasedAt": "2026-08-12"
}
```

The lesson contains a passage-specific strategy, exactly three verbatim signal
phrases, exactly three vocabulary entries grounded in the passage, and one tip
for each of the four comprehension skills. Signal phrases and vocabulary words
must occur verbatim in `text`.

## Editorial contract

- All prose and questions are original. Do not imitate or adapt a living
  author's recognizable style, and do not copy source text.
- Nonfiction uses durable, well-established facts. Avoid current statistics,
  medical/legal/financial advice, disputed claims, invented quotations, and
  precise claims that cannot be confidently verified.
- Content is suitable for a general 4+ storefront rating while still serving
  adult English learners. No graphic harm, sexual content, profanity, partisan
  persuasion, stereotypes, or humiliating distractors.
- Every question has one unambiguous answer supported by the passage. A
  vocabulary answer is the meaning in this exact context. Explanations state
  the textual reason, not merely that an option is correct.
- A misconception tag belongs to one exact distractor, not to the question's
  skill as a whole. Add it only through the fingerprinted
  `distractor-reviews-v1.json` sidecar with a written rationale. Leave an
  uncertain option null; partial or zero coverage is valid.
- The correct `main-idea` choice is a self-contained, one-sentence gist. The
  app reuses that exact choice as the reference answer in its recall step.
- Fiction varies settings, names, relationships, and outcomes. Across all
  genres, avoid tokenized identity details and keep human experiences broad.
- Titles, premises, sentences, and lesson language must not duplicate the v11
  corpus or another item in this pack.

## Files and current release flow

Batch files are JSON objects with a `passages` array and are named
`batch-01.json` or, when parallel authoring splits a batch, `batch-01a.json`,
`batch-01b.json`, and so on. A change to a year-pack passage must update its
batch record and its matching object in `data/passages.json`. CI compares the
complete objects and rejects any difference.

For a current corpus release, run:

```bash
python3 scripts/validate-year-pack.py
python3 scripts/year_pack_parity.py
python3 scripts/audit-readability.py
python3 scripts/materialize-distractor-reviews.py --write-target data/passages.json
python3 scripts/materialize-distractor-reviews.py
python3 scripts/audit-corpus.py --strict
swift scripts/validate-swift-decode.swift data/passages.json
node scripts/build-manifest.mjs
```

The readability scan produces review candidates and does not fail a release
because a phrase or long sentence needs judgment. Use `--json` for a complete,
stable report. Verbatim public-domain source text is exempt, but the questions
and lessons written for the app are still scanned. Optional `distractorTags`
have no coverage minimum and are not a release floor.

`merge-year-pack.mjs`, `normalize-legacy-corpus.mjs`, and the
`repair-legacy-*.mjs` scripts are historical v12 assembly tools. Their narrow
version and hash checks are intentional. They are not part of a current v16
release and must not be used to rewrite the live corpus.

See [OTA-RELEASE.md](OTA-RELEASE.md) for the historical v12 release record and
the root [README](../../README.md) for current publication behavior.
