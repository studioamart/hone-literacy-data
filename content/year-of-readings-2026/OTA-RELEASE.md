# Historical OTA release notes — corpus v12

This file records the v12 publication. It is not the current release checklist.
Use the [year-pack README](README.md) and the repository [README](../../README.md)
for current validation and publication commands.

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

## Historical assembly

The v12 release used `merge-year-pack.mjs`, `normalize-legacy-corpus.mjs`, and
the `repair-legacy-*.mjs` scripts. Those scripts accept only the source states
and reviewed hashes used for that release. They remain for provenance and are
retired from the current release process.

Optional distractor reviews were not required for v12 and are not a release
floor now. The materializer still requires a fingerprinted option-level
rationale for any tag that is added. An uncertain distractor stays null.

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

Version numbers are monotonic. Correct a published corpus by shipping the full
corpus under a higher version. Lowering or reusing a version will not replace an
installed cache.
