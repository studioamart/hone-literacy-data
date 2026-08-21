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
