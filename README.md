# Fluency reading data

Public OTA dataset for **Fluency** (formerly Hone Literacy), published by Studio
AM: short reading passages with multiple-choice comprehension questions, served
through GitHub Pages so shipped apps can fetch new readings without an App Store
release.

- `data/passages.json` — the dataset (schema 1). Each passage carries text,
  metadata (genre, difficulty `level` 1–5, source), and a set of multiple-choice
  questions tagged by skill: `main-idea`, `inference`, `vocabulary`, `detail`.
- `data/manifest.json` — version + sha256 + counts, generated with
  `scripts/build-manifest.mjs` and verified by CI on every data change.
- `data/free-limits.json` — OPTIONAL legacy compatibility settings, usually
  absent. Current Fluency builds do not use this file to gate reading access.

## How updates reach users

The app ships a corpus **bundled** in the binary. At runtime it reads
`data/manifest.json`; when the user taps **"Get latest readings"** (or on a
throttled background check) and the remote `version` is higher than the cached
one and the `schema` is supported, it downloads `passages.json` and verifies the
`sha256`. A release must bump the root `version`, run
`node scripts/build-manifest.mjs`, and commit the corpus and generated manifest
together. CI validates that exact revision and rejects a stale manifest; it does
not mutate release files. No app release is required.

```
edit + bump passages.json ──▶ build + commit manifest ──▶ merge to main
                                                               │
   app "Get latest readings" ◀── GitHub Pages ◀───────────────┘
```

## Content & IP policy

Two source types, both clean of third-party IP:

| `sourceType`     | What it is | Rule |
|------------------|------------|------|
| `public-domain`  | Excerpts of works in the U.S. public domain (pre-1929 or verified). | Fill `source` + `attribution` precisely (author, work, year). |
| `original`       | Passages written for Fluency (human or AI-assisted, human-reviewed). | No copying; use the Studio AM / Fluency attribution. |

We do **not** scrape paywalled or in-copyright articles. Multiple-choice
questions are generated/edited for these passages and reviewed for a single
unambiguous correct answer. A newly written adaptation of a public-domain
premise remains `original` and names the adapted work in its attribution; it is
not presented as a verbatim public-domain excerpt.

## Schema (v1)

```jsonc
{
  "schema": 1,
  "version": 1,
  "passages": [
    {
      "id": "pd-aesop-ant-grasshopper",
      "title": "The Ant and the Grasshopper",
      "sourceType": "public-domain",        // or "original"
      "source": "Aesop's Fables",
      "attribution": "Aesop, trans. V. S. Vernon Jones (1912). Public domain.",
      "genre": "fable",                      // one of the 12 validated corpus genres
      "level": 1,                            // 1 (easiest) .. 5 (hardest)
      "wordCount": 180,
      "releasedAt": "2026-08-04",            // OPTIONAL, yyyy-MM-dd — see "New tags"
      "text": "In a field one summer's day ...",
      "questions": [
        {
          "id": "q1",
          "skill": "main-idea",             // main-idea|inference|vocabulary|detail
          "stem": "What lesson does the fable teach?",
          "choices": ["...", "...", "...", "..."],
          "answer": 0,                       // index into choices
          "distractorTags": [null, "main-idea-too-broad", null, null], // OPTIONAL
          "explanation": "..."
        }
      ]
    }
  ]
}
```

## Adding passages

```bash
# Scaffold a passage (computes wordCount, appends a question stub):
node scripts/new-passage.mjs --id my-id --title "Title" \
  --source-type original --genre nonfiction --level 3 \
  --text "Full passage text..."

# Fill in its questions in data/passages.json, then rebuild the manifest:
node scripts/build-manifest.mjs
```

`build-manifest.mjs` runs the complete corpus audit, verifies dates and question
structure, computes the checksum, and refuses to publish content under an
unchanged or lower version. The root `version` in `passages.json` is
authoritative and must be bumped by the author. The script also validates
`data/free-limits.json` when that legacy file exists.

## Optional distractor evidence: reviewed, never inferred

`distractorTags` is an optional array aligned position-for-position with
`choices`. The correct choice must be `null`. A distractor may also remain
`null` when its error type is uncertain; there is deliberately no coverage
minimum. Tags come only from the closed vocabulary in
`content/distractor-taxonomy-v1.json`, and each tag is valid only for its
reviewed question skill.

This evidence is a future editorial enhancement, not a corpus-release
requirement. Zero, partial, and complete coverage are all valid. CI validates
the shape and provenance of any tags that do exist, but it does not require an
editor to add tags or convert uncertain `null` slots into labels.

The authoritative authoring record is `content/distractor-reviews-v1.json`.
Every non-null option review must include a specific editorial rationale. Its
fingerprint includes the passage text, stem, choices, answer, explanation, and
skill, so changing any evidence-bearing content forces a fresh review instead
of silently moving an old label.

Reviews are versioned by `(corpusVersion, passageId, questionId)`. The current
OTA corpus and the immutable compact v11 snapshot are both indexed by the
default command, so two released variants with the same IDs cannot be
conflated. The snapshot pins the original app-repository commit, path, file
SHA-256, every compound question ID, and an aggregate semantic SHA-256. It is
not a runtime corpus and never a materialization target. It also mirrors
absent-versus-present aligned tag state, allowing CI to reject a v11 review
until the separately stored app bundle is actually materialized and the pinned
compact snapshot is refreshed from that committed runtime source. A separate
full-state SHA-256 binds those mirror fields so a partial/manual edit fails.

```bash
# Print an all-null review record; paste it into the sidecar and fill only
# categories an editorial reviewer can support from this exact passage and option.
# Replace 15 when the OTA corpus version advances.
python3 scripts/materialize-distractor-reviews.py \
  --scaffold 15:PASSAGE_ID:QUESTION_ID

# Apply sidecar reviews after every prose/question repair, then verify parity.
# The target is explicit even though bundled v11 and current OTA variants are read.
python3 scripts/materialize-distractor-reviews.py \
  --write-target data/passages.json
python3 scripts/materialize-distractor-reviews.py
```

To materialize a bundled v11 review, supply the app's runtime corpus alongside
the current corpus and pinned snapshot, and name only the app file as the write
target. The materializer first requires its evidence-bearing semantics to match
the immutable snapshot; it never writes the snapshot or the other corpus.
Semantic edits require a new corpus version and snapshot, not an overwritten
v11 provenance artifact.

```bash
python3 scripts/materialize-distractor-reviews.py \
  --corpus ../hone-literacy/app/Resources/passages.json \
  --corpus data/passages.json \
  --snapshot content/corpus-snapshots/bundled-v11-question-semantics.json \
  --write-target ../hone-literacy/app/Resources/passages.json
```

After reviewing that diff, commit the app corpus first. Refresh the compact
snapshot with that exact source commit (omit `--check` in the command below),
then commit the data-repository sidecar and snapshot together. The builder
reads the Git blob and refuses a fake commit, mismatched working file, or path
outside the source repository. Once a bundled review is added, its parity
check remains red between those steps, which prevents the review from claiming
materialization prematurely.

The committed v11 snapshot was generated from app commit
`8c7fd5e739f21214636f7b8e22a2a063f7ead9be` and exact source SHA-256
`5c001800dd97a580475d92811965dbab1bff567d8369c8ac8a30f3579e6b0f67`.
When that pinned source is available, its deterministic bytes can be checked
without rewriting the snapshot:

```bash
python3 scripts/build-distractor-snapshot.py \
  --corpus ../hone-literacy/app/Resources/passages.json \
  --output content/corpus-snapshots/bundled-v11-question-semantics.json \
  --source-commit 8c7fd5e739f21214636f7b8e22a2a063f7ead9be \
  --source-path app/Resources/passages.json \
  --source-repository ../hone-literacy \
  --check
```

Choice-reordering tools move `choices` and `distractorTags` as one pair. Scripts
that replace whole questions refuse to run after tags exist, so repairs happen
before materialization. The corpus audit also fails on a wrong-length array, a
tagged correct option, an unknown ID, or a tag used with the wrong skill.

The committed review sidecar is currently empty, and neither the bundled v11
snapshot nor the current OTA v15 corpus materializes optional tag arrays. That
zero-coverage state is valid and does not block a release. Future reviews can
be added incrementally; the tooling does not invent labels from question skill
or option position, and an uncertain choice remains `null`.

## New tags (`releasedAt`)

In the current Fluency app, `releasedAt` is display metadata only. A passage
dated within the last 30 days receives a **New** tag:

```
published ──▶ New tag for 30 days ──▶ remains in the corpus without the tag
```

- `new-passage.mjs` stamps `releasedAt` with today's local date automatically.
  `--released-at YYYY-MM-DD` sets another real publication date;
  `--released-at none` omits the tag metadata.
- It does **not** schedule, hide, or delay a passage. Future-dated content is
  selectable immediately and can remain marked New until 30 days after that
  date. To drip content across a year, publish actual OTA batches with strictly
  increasing corpus versions.
- Older schema-1 app builds may still interpret the field as a 30-day Pro-first
  gate. Keep dates truthful for backward compatibility.
- Keep the 30-day window in sync with `PassageStore.newWindowDays` in the app.

## Legacy free-tier limits (`freeLimits`)

This optional manifest field is retained for older builds that supported a free
tier. The current Fluency app treats readers as subscribers and does not use
these values to gate passage access. If compatibility testing requires them,
write `data/free-limits.json` (both keys optional):

```json
{ "workoutPerDay": 1, "freePoolSize": 25 }
```

`build-manifest.mjs` validates it and copies it into the manifest:

```jsonc
{
  "schema": 1, "version": 9, "url": "...", "sha256": "...",
  "passageCount": 231, "questionCount": 861,
  "freeLimits": { "workoutPerDay": 1, "freePoolSize": 25 },  // OPTIONAL
  "generatedAt": "..."
}
```

| Key | Meaning in compatible older builds | Floor | Legacy default |
|---|---|---|---|
| `workoutPerDay` | Ceiling on the passages in a **free** reader's daily workout (and therefore on their streak target). Only ever shrinks the reader's own goal — someone set to 1/day stays at 1. | 1 | no ceiling |
| `freePoolSize` | How many passages the free daily workout draws from. | 20 | 40 |

- **Absent = the app build's bundled defaults.** No file, or a key left out,
  means the app behaves exactly as it shipped. Current builds are unaffected.
- **Rollback is deleting the key**, not pushing the old number back: the app
  treats each fetched manifest as authoritative and clears what it no longer
  carries.
- The app **clamps to the same floors and ignores anything malformed**, so a bad
  push can shrink the free tier but never zero it. This script is stricter on
  purpose — it **hard-fails** on a non-integer, a value under the floor, an
  unknown key, or unparseable JSON, because the app's forgiveness would
  otherwise turn a typo into a silent no-op that looks like a null result.
- **Optional and additive — it does not bump `schema`.** Builds shipped before
  this existed decode straight past it.
- A limits-only change rewrites the manifest **without** touching `version` or
  `sha256` (no passage bytes changed), so readers pick it up on their next
  once-a-day manifest check without re-downloading the corpus.
- Mirrors `FreeLimits` in the app (`minWorkoutPerDay` / `minFreePoolSize`); the
  app is the authority, this repo only refuses to publish nonsense.

## Honesty contract

Passages are for reading practice. Public-domain excerpts are reproduced with
attribution; original passages are clearly marked. Corrections (a wrong answer
key, an ambiguous question) are welcome via issues.

## Consumers

- The Fluency iOS app (formerly Hone Literacy), whose OTA reader uses
  `data/manifest.json`.

Sibling repos: [carstory-data](https://github.com/studioamart/garage-story-data),
[kittystory-data](https://github.com/studioamart/pet-story-data).

## Disclaimer

This dataset is provided for **general informational purposes only**. The
intervals, schedules, and cost figures are **typical-case estimates** — many are
derived from generic, rule-based heuristics rather than manufacturer or expert
data, and some descriptions are produced with the help of automated (AI) tools.

It is **not** professional, medical, veterinary, or manufacturer advice. Always
verify against a teacher or qualified educator where it matters before acting. The data is provided "as is", without
warranty of any kind, and you use it at your own risk. Studio AM is not affiliated
with any manufacturer or brand referenced.

Full terms: https://studioam.art/terms
