# honeliteracy-data

Public dataset for **Hone Literacy** (Team AM): short reading passages with
multiple-choice comprehension questions, served via GitHub Pages so shipped apps
can fetch new readings without an App Store release.

- `data/passages.json` — the dataset (schema 1). Each passage carries text,
  metadata (genre, difficulty `level` 1–5, source), and a set of multiple-choice
  questions tagged by skill: `main-idea`, `inference`, `vocabulary`, `detail`.
- `data/manifest.json` — version + sha256 + counts, rebuilt by CI
  (`scripts/build-manifest.mjs`) on every data change.
- `data/free-limits.json` — OPTIONAL, usually absent: the free tier's tunable
  limits, passed through to the manifest. See "Free-tier limits" below.

## How updates reach users

The app ships this data **bundled** (v1). At runtime it reads
`data/manifest.json`; when the user taps **"Get latest readings"** (or on a
throttled background check) and the remote `version` is higher than the cached
one and the `schema` is supported, it downloads `passages.json` and verifies the
`sha256`. Edit the dataset → push → CI bumps the manifest → users fetch the
latest on next check. No app release required.

```
edit passages.json ──▶ push ──▶ CI build-manifest.mjs ──▶ manifest.version++ + sha256
                                                              │
   app "Get latest readings" ◀── GitHub Pages ◀──────────────┘
```

## Content & IP policy

Two source types, both clean of third-party IP:

| `sourceType`     | What it is | Rule |
|------------------|------------|------|
| `public-domain`  | Excerpts of works in the U.S. public domain (pre-1929 or verified). | Fill `source` + `attribution` precisely (author, work, year). |
| `original`       | Passages written for Hone Literacy (human or AI-assisted, human-reviewed). | No copying; attribution defaults to a Team AM line. |

We do **not** scrape paywalled or in-copyright articles. Multiple-choice
questions are generated/edited for these passages and reviewed for a single
unambiguous correct answer.

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
      "genre": "fable",                      // fable|fiction|science|history|philosophy|essay|nonfiction
      "level": 1,                            // 1 (easiest) .. 5 (hardest)
      "wordCount": 180,
      "releasedAt": "2026-08-04",            // OPTIONAL, yyyy-MM-dd — see "Pro-first drops"
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

`build-manifest.mjs` validates every passage (text present, ≥1 question, each
answer index in range, `releasedAt` well-formed if present) and refuses to
publish a broken dataset. It bumps `version` only when the data actually
changed. It also validates `data/free-limits.json` when that file exists (see
"Free-tier limits").

## Pro-first drops (`releasedAt`)

New passages go to Pro subscribers first, then open up on their own:

```
published ──▶ 30 days Pro-only ──▶ general corpus (free-eligible)
```

- `new-passage.mjs` stamps `releasedAt` with today's local date automatically.
  `--released-at YYYY-MM-DD` backdates a drop; `--released-at none` publishes it
  free-eligible immediately.
- The app keeps a dated passage out of the free daily-workout pool until it is
  `releasedAt + 30 days` old, and marks it **Pro** in the library meanwhile.
  Nothing schedules the roll-over — the gate is a pure function of the date, so
  a passage frees itself.
- **The field is optional and additive.** A passage without it is free-eligible
  from day one, so every corpus published before this existed behaves exactly as
  it always did. Passages bundled inside the app binary are never gated by it.
- Keep the 30-day window in sync with `PassageStore.proWindowDays` in the app if
  it ever changes; the app is the authority, this repo only reports it.

## Free-tier limits (`freeLimits`)

How big the free tier is, tunable from here instead of from an App Store
release. Write `data/free-limits.json` (both keys optional):

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

| Key | Means | Floor | App default |
|---|---|---|---|
| `workoutPerDay` | Ceiling on the passages in a **free** reader's daily workout (and therefore on their streak target). Only ever shrinks the reader's own goal — someone set to 1/day stays at 1. | 1 | no ceiling |
| `freePoolSize` | How many passages the free daily workout draws from. | 20 | 40 |

- **Absent = the app's bundled defaults.** No file, or a key left out, means the
  app behaves exactly as it shipped. **Pro readers are never affected.**
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

- The Hone Literacy iOS app (v1 ships this data bundled; over-the-air updates
  read `data/manifest.json`).

Sibling repos: [carstory-data](https://github.com/support-teamam/carstory-data),
[kittystory-data](https://github.com/support-teamam/kittystory-data).

## Disclaimer

This dataset is provided for **general informational purposes only**. The
intervals, schedules, and cost figures are **typical-case estimates** — many are
derived from generic, rule-based heuristics rather than manufacturer or expert
data, and some descriptions are produced with the help of automated (AI) tools.

It is **not** professional, medical, veterinary, or manufacturer advice. Always
verify against a teacher or qualified educator where it matters before acting. The data is provided "as is", without
warranty of any kind, and you use it at your own risk. Team AM is not affiliated
with any manufacturer or brand referenced.

Full terms: https://teamam.org/terms
