# OTA release notes — corpus v12

This release appends the complete 365-reading pack to the 286-reading v11
corpus. The wire artifact is still one complete `ReadingData` document; the app
does not apply passage deltas.

## Expected artifact

- schema: `1`
- version: `12`
- passages: `651` (`286` preserved + `365` new)
- questions: `2,616` (`1,156` preserved + `1,460` new)
- corpus SHA-256: `00ab93a4941acf6d426015b44a1befe81a03e6249abca4b7005c178f18314238`
- new IDs: `og-y26-d001-*` through `og-y26-d365-*`

Every authored item has `releasedAt: "2026-08-12"`. In the current app this is
only a 30-day **New** marker. It is not a publication schedule or access gate.
Publishing v12 therefore makes all 365 readings eligible for selection at once.
If Studio AM wants a daily or weekly drip, it must publish complete higher-
version corpora on that cadence; future-dating items inside one corpus will not
hide them.

## Local release gate

Run from the repository root:

```bash
python3 scripts/validate-year-pack.py
node scripts/merge-year-pack.mjs
node scripts/normalize-legacy-corpus.mjs
node scripts/repair-legacy-lessons.mjs
node scripts/repair-legacy-paragraphs.mjs
node scripts/repair-legacy-facts.mjs
node scripts/repair-legacy-history.mjs
python3 scripts/audit-corpus.py
swift scripts/validate-swift-decode.swift data/passages.json
node scripts/build-manifest.mjs
git diff --exit-code -- data/manifest.json # after the generated manifest is committed
```

Any additional reviewed legacy repair scripts listed in the repository must run
before the final audit and manifest build. Do not use
`normalize-legacy-corpus.mjs --balance-answers` without a question-by-question
editorial review; the v12 content release intentionally preserves legacy choice
order.

## Publication behavior

The current app checks the small manifest at launch and shows an update badge
only when the remote version is higher. It downloads the full corpus after the
reader taps **Get latest readings**, verifies the SHA-256, and atomically caches
the decoded file. The download enters the Library, workouts, and Fluency Lab;
Daily Challenge IDs remain binary-defined.

GitHub Pages serves `main` from the repository root. Commit `data/passages.json`
and its generated `data/manifest.json` in the same revision. The validation
workflow rejects a stale manifest and never bot-commits a second deployment.
After merge, verify both live files and their SHA-256 after the Pages/CDN cache
settles.

Version numbers are monotonic. If v12 needs correction after publication, ship
the corrected full corpus as v13; lowering the version or reusing v12 will not
replace an installed v12 cache.
