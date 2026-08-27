#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from distractor_review_artifact import build_snapshot
from distractor_taxonomy import load_registry, validate_question_tags


ROOT = Path(__file__).resolve().parent.parent
MATERIALIZER = ROOT / "scripts" / "materialize-distractor-reviews.py"
SNAPSHOT_BUILDER = ROOT / "scripts" / "build-distractor-snapshot.py"
NORMALIZER = ROOT / "scripts" / "normalize-legacy-corpus.mjs"
FACT_REPAIR = ROOT / "scripts" / "repair-legacy-facts.mjs"
HISTORY_REPAIR = ROOT / "scripts" / "repair-legacy-history.mjs"
YEAR_PACK_ID = re.compile(r"^og-y26-d\d{3}-")
# Each one-time repair tool pins the legacy passage count of the v11/v12 corpus
# it was reviewed against. Read the pin out of the tool rather than restating it
# here, so the fixture below cannot drift away from the guard it has to satisfy.
LEGACY_COUNT_PINS = (
    re.compile(r"legacyPassages\.length !== (\d+)"),
    re.compile(r"EXPECTED_LEGACY_COUNT = (\d+)"),
)


def pinned_legacy_count(script: Path) -> int:
    source = script.read_text(encoding="utf-8")
    for pattern in LEGACY_COUNT_PINS:
        found = pattern.search(source)
        if found:
            return int(found.group(1))
    raise AssertionError(f"{script.name}: no pinned legacy passage count found")


def legacy_source_state(corpus: dict, script: Path, keep_id: str) -> dict:
    """Reduce the current OTA corpus to the legacy shape a repair tool accepts.

    These tools deliberately refuse any corpus whose legacy (non year-pack)
    passage count differs from the v11/v12 state they were reviewed against, so
    every content pack published since then has to come back out of the fixture
    before the run can reach the distractor-evidence guard under test. Surplus
    passages are dropped from the tail and the repair target is never dropped.
    The tools' own pins stay untouched: raising one would let a v12-era rewriter
    loose on content it was never reviewed for.
    """
    legacy = [
        passage for passage in corpus["passages"] if not YEAR_PACK_ID.match(passage["id"])
    ]
    surplus = len(legacy) - pinned_legacy_count(script)
    if surplus <= 0:
        return corpus
    dropped: set[str] = set()
    for passage in reversed(legacy):
        if len(dropped) == surplus:
            break
        if passage["id"] != keep_id:
            dropped.add(passage["id"])
    corpus["passages"] = [
        passage for passage in corpus["passages"] if passage["id"] not in dropped
    ]
    return corpus


class DistractorTaxonomyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry, errors = load_registry()
        if errors:
            raise AssertionError(errors)

    def test_partial_review_is_valid_and_correct_slot_must_stay_null(self) -> None:
        question = {
            "skill": "inference",
            "choices": ["right", "literal", "uncertain"],
            "answer": 0,
            "distractorTags": [None, "literal-detail-for-inference", None],
        }
        issues, coverage = validate_question_tags(question, self.registry)
        self.assertEqual(issues, [])
        self.assertTrue(coverage.authored)
        self.assertEqual(coverage.tagged_slots, 1)
        self.assertEqual(coverage.distractor_slots, 2)

        question["distractorTags"][0] = "unsupported-inference"
        issues, _coverage = validate_question_tags(question, self.registry)
        self.assertIn("distractor-tag-correct-choice", {code for code, _ in issues})

    def test_absent_and_all_null_optional_tags_have_no_coverage_floor(self) -> None:
        question = {
            "skill": "detail",
            "choices": ["right", "nearby", "uncertain"],
            "answer": 0,
        }
        issues, coverage = validate_question_tags(question, self.registry)
        self.assertEqual(issues, [])
        self.assertFalse(coverage.authored)
        self.assertEqual(coverage.tagged_slots, 0)
        self.assertEqual(coverage.distractor_slots, 2)

        question["distractorTags"] = [None, None, None]
        issues, coverage = validate_question_tags(question, self.registry)
        self.assertEqual(issues, [])
        self.assertTrue(coverage.authored)
        self.assertEqual(coverage.tagged_slots, 0)
        self.assertEqual(coverage.distractor_slots, 2)

    def test_unknown_and_wrong_skill_tags_fail_closed(self) -> None:
        unknown = {
            "skill": "detail",
            "choices": ["right", "wrong"],
            "answer": 0,
            "distractorTags": [None, "future-tag"],
        }
        issues, _coverage = validate_question_tags(unknown, self.registry)
        self.assertIn("distractor-tag-unknown", {code for code, _ in issues})

        mismatch = {
            **unknown,
            "distractorTags": [None, "unsupported-inference"],
        }
        issues, _coverage = validate_question_tags(mismatch, self.registry)
        self.assertIn("distractor-tag-skill", {code for code, _ in issues})


class DistractorReviewMaterializerTests(unittest.TestCase):
    def run_script(self, *arguments: str, expect: int = 0) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(MATERIALIZER), *arguments],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            expect,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        return result

    def test_review_requires_rationale_materializes_and_invalidates_on_edit(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            corpus_path = temp_path / "passages.json"
            reviews_path = temp_path / "reviews.json"
            corpus = {
                "schema": 1,
                "version": 99,
                "passages": [{
                    "id": "p",
                    "text": "A complete passage whose evidence gives the options meaning.",
                    "questions": [{
                        "id": "q1",
                        "skill": "inference",
                        "stem": "What follows from the passage?",
                        "choices": ["right", "literal", "uncertain"],
                        "answer": 0,
                        "explanation": "The first choice follows from the evidence.",
                    }],
                }],
            }
            corpus_path.write_text(json.dumps(corpus), encoding="utf-8")
            reviews_path.write_text(
                json.dumps({"schema": 1, "taxonomyVersion": 1, "reviews": []}),
                encoding="utf-8",
            )

            scaffold = self.run_script(
                "--corpus", str(corpus_path),
                "--reviews", str(reviews_path),
                "--scaffold", "99:p:q1",
            )
            review = json.loads(scaffold.stdout)
            review["options"][1] = {
                "tag": "literal-detail-for-inference",
                "rationale": "This option repeats a stated detail without the requested inference.",
            }
            reviews_path.write_text(
                json.dumps({"schema": 1, "taxonomyVersion": 1, "reviews": [review]}),
                encoding="utf-8",
            )

            self.run_script(
                "--corpus", str(corpus_path), "--reviews", str(reviews_path), expect=1
            )
            self.run_script(
                "--corpus", str(corpus_path), "--reviews", str(reviews_path),
                "--write-target", str(corpus_path),
            )
            materialized = json.loads(corpus_path.read_text(encoding="utf-8"))
            tags = materialized["passages"][0]["questions"][0]["distractorTags"]
            self.assertEqual(tags, [None, "literal-detail-for-inference", None])
            self.run_script("--corpus", str(corpus_path), "--reviews", str(reviews_path))

            materialized["passages"][0]["questions"][0]["choices"][1] = "revised literal"
            corpus_path.write_text(json.dumps(materialized), encoding="utf-8")
            changed = self.run_script(
                "--corpus", str(corpus_path), "--reviews", str(reviews_path), expect=1
            )
            self.assertIn("authored content changed", changed.stderr)

    def test_non_null_review_without_specific_rationale_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            corpus_path = temp_path / "passages.json"
            reviews_path = temp_path / "reviews.json"
            corpus_path.write_text(json.dumps({
                "schema": 1,
                "version": 1,
                "passages": [{
                    "id": "p",
                    "text": "Text.",
                    "questions": [{
                        "id": "q",
                        "skill": "detail",
                        "stem": "Which detail?",
                        "choices": ["right", "nearby"],
                        "answer": 0,
                        "explanation": "The first one.",
                    }],
                }],
            }), encoding="utf-8")
            scaffold = self.run_script(
                "--corpus", str(corpus_path),
                "--reviews", str(reviews_path),
                "--scaffold", "1:p:q",
            )
            # Scaffolding does not read the review file, so a missing file is OK.
            review = json.loads(scaffold.stdout)
            review["options"][1] = {"tag": "nearby-detail", "rationale": "vague"}
            reviews_path.write_text(json.dumps({
                "schema": 1, "taxonomyVersion": 1, "reviews": [review]
            }), encoding="utf-8")
            result = self.run_script(
                "--corpus", str(corpus_path), "--reviews", str(reviews_path), expect=1
            )
            self.assertIn("specific explanation", result.stderr)

    def test_two_version_reviews_survive_and_only_explicit_target_is_written(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            v11_path = temp_path / "bundled-v11.json"
            v12_path = temp_path / "ota-v12.json"
            snapshot_path = temp_path / "bundled-v11-snapshot.json"
            reviews_path = temp_path / "reviews.json"

            def corpus(version: int, text: str, wrong: str) -> dict:
                return {
                    "schema": 1,
                    "version": version,
                    "passages": [{
                        "id": "shared-passage",
                        "text": text,
                        "questions": [{
                            "id": "q1",
                            "skill": "inference",
                            "stem": "What follows from this version?",
                            "choices": ["supported", wrong],
                            "answer": 0,
                            "explanation": "The first option follows from this exact text.",
                        }],
                    }],
                }

            v11 = corpus(11, "The released bundled wording supports one inference.", "literal")
            v11["passages"][0]["questions"][0]["distractorTags"] = [
                None, "literal-detail-for-inference"
            ]
            v12 = corpus(12, "The OTA wording supports a changed inference.", "unsupported")
            v11_path.write_text(json.dumps(v11), encoding="utf-8")
            v12_path.write_text(json.dumps(v12), encoding="utf-8")
            snapshot, errors = build_snapshot(
                v11_path,
                v11,
                source_commit="a" * 40,
                source_path="app/Resources/passages.json",
            )
            self.assertEqual(errors, [])
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

            shared_arguments = [
                "--corpus", str(v11_path),
                "--corpus", str(v12_path),
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
            ]
            scaffold11 = json.loads(self.run_script(
                *shared_arguments, "--scaffold", "11:shared-passage:q1"
            ).stdout)
            scaffold12 = json.loads(self.run_script(
                *shared_arguments, "--scaffold", "12:shared-passage:q1"
            ).stdout)
            self.assertNotEqual(
                scaffold11["questionFingerprint"], scaffold12["questionFingerprint"]
            )
            scaffold11["options"][1] = {
                "tag": "literal-detail-for-inference",
                "rationale": "The bundled option only restates a literal released detail.",
            }
            scaffold12["options"][1] = {
                "tag": "unsupported-inference",
                "rationale": "The OTA option adds an assumption absent from its changed text.",
            }
            reviews_path.write_text(json.dumps({
                "schema": 1,
                "taxonomyVersion": 1,
                "reviews": [scaffold11, scaffold12],
            }), encoding="utf-8")

            v11_before = v11_path.read_bytes()
            snapshot_before = snapshot_path.read_bytes()
            self.run_script(
                *shared_arguments, "--write-target", str(v12_path)
            )
            self.assertEqual(v11_path.read_bytes(), v11_before)
            self.assertEqual(snapshot_path.read_bytes(), snapshot_before)
            materialized_v12 = json.loads(v12_path.read_text(encoding="utf-8"))
            self.assertEqual(
                materialized_v12["passages"][0]["questions"][0]["distractorTags"],
                [None, "unsupported-inference"],
            )
            self.run_script(*shared_arguments)

            # The normal v12 + immutable v11 snapshot path validates reviews for
            # both versions without pretending the snapshot is a runtime target.
            self.run_script(
                "--corpus", str(v12_path),
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
            )

    def test_snapshot_rejects_semantic_drift_and_builder_check_is_exact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            source_repository = temp_path / "source-repository"
            corpus_path = source_repository / "app" / "Resources" / "passages.json"
            snapshot_path = temp_path / "v11-snapshot.json"
            reviews_path = temp_path / "reviews.json"
            corpus = {
                "schema": 1,
                "version": 11,
                "passages": [{
                    "id": "p",
                    "text": "Pinned release semantics.",
                    "questions": [{
                        "id": "q1",
                        "skill": "detail",
                        "stem": "Which detail is stated?",
                        "choices": ["right", "nearby"],
                        "answer": 0,
                        "explanation": "The first detail is stated.",
                    }],
                }],
            }
            corpus_path.parent.mkdir(parents=True)
            corpus_path.write_text(json.dumps(corpus), encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(source_repository)], check=True)
            subprocess.run(
                ["git", "-C", str(source_repository), "add", "app/Resources/passages.json"],
                check=True,
            )
            subprocess.run(
                [
                    "git", "-C", str(source_repository),
                    "-c", "user.name=Evidence Test",
                    "-c", "user.email=evidence@example.invalid",
                    "commit", "-q", "-m", "pin v11",
                ],
                check=True,
            )
            first_commit = subprocess.run(
                ["git", "-C", str(source_repository), "rev-parse", "HEAD"],
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            reviews_path.write_text(json.dumps({
                "schema": 1, "taxonomyVersion": 1, "reviews": []
            }), encoding="utf-8")
            build = subprocess.run(
                [
                    sys.executable, str(SNAPSHOT_BUILDER),
                    "--corpus", str(corpus_path),
                    "--output", str(snapshot_path),
                    "--source-commit", first_commit,
                    "--source-path", "app/Resources/passages.json",
                    "--source-repository", str(source_repository),
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(build.returncode, 0, msg=build.stderr)
            check = subprocess.run(
                [
                    sys.executable, str(SNAPSHOT_BUILDER),
                    "--corpus", str(corpus_path),
                    "--output", str(snapshot_path),
                    "--source-commit", first_commit,
                    "--source-path", "app/Resources/passages.json",
                    "--source-repository", str(source_repository),
                    "--check",
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(check.returncode, 0, msg=check.stderr)

            fake_commit = subprocess.run(
                [
                    sys.executable, str(SNAPSHOT_BUILDER),
                    "--corpus", str(corpus_path),
                    "--output", str(snapshot_path),
                    "--source-commit", "f" * 40,
                    "--source-path", "app/Resources/passages.json",
                    "--source-repository", str(source_repository),
                    "--check",
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(fake_commit.returncode, 0)
            self.assertIn("pinned source blob", fake_commit.stderr)

            _snapshot, traversal_errors = build_snapshot(
                corpus_path,
                corpus,
                source_commit=first_commit,
                source_path="../../not-a-repository-file.json",
            )
            self.assertTrue(any("repository-relative" in item for item in traversal_errors))

            corpus["passages"][0]["questions"][0]["stem"] = "Which changed detail?"
            corpus_path.write_text(json.dumps(corpus), encoding="utf-8")
            result = self.run_script(
                "--corpus", str(corpus_path),
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
                expect=1,
            )
            self.assertIn("semantics differ from runtime", result.stderr)
            subprocess.run(
                ["git", "-C", str(source_repository), "add", "app/Resources/passages.json"],
                check=True,
            )
            subprocess.run(
                [
                    "git", "-C", str(source_repository),
                    "-c", "user.name=Evidence Test",
                    "-c", "user.email=evidence@example.invalid",
                    "commit", "-q", "-m", "change semantics",
                ],
                check=True,
            )
            second_commit = subprocess.run(
                ["git", "-C", str(source_repository), "rev-parse", "HEAD"],
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            stale = subprocess.run(
                [
                    sys.executable, str(SNAPSHOT_BUILDER),
                    "--corpus", str(corpus_path),
                    "--output", str(snapshot_path),
                    "--source-commit", second_commit,
                    "--source-path", "app/Resources/passages.json",
                    "--source-repository", str(source_repository),
                    "--check",
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(stale.returncode, 0)
            self.assertIn("stale", stale.stderr)

    def test_snapshot_only_review_fails_until_bundled_tag_state_is_refreshed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            corpus_path = temp_path / "bundled-v11.json"
            snapshot_path = temp_path / "bundled-v11-snapshot.json"
            reviews_path = temp_path / "reviews.json"
            corpus = {
                "schema": 1,
                "version": 11,
                "passages": [{
                    "id": "p",
                    "text": "A named detail appears in this exact released passage.",
                    "questions": [{
                        "id": "q1",
                        "skill": "detail",
                        "stem": "Which detail is stated?",
                        "choices": ["right", "nearby"],
                        "answer": 0,
                        "explanation": "Only the first choice answers the locator.",
                    }],
                }],
            }
            corpus_path.write_text(json.dumps(corpus), encoding="utf-8")
            snapshot, errors = build_snapshot(
                corpus_path,
                corpus,
                source_commit="c" * 40,
                source_path="app/Resources/passages.json",
            )
            self.assertEqual(errors, [])
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")
            scaffold = json.loads(self.run_script(
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
                "--scaffold", "11:p:q1",
            ).stdout)
            scaffold["options"][1] = {
                "tag": "nearby-detail",
                "rationale": "This is a real nearby detail but answers a different locator.",
            }
            reviews_path.write_text(json.dumps({
                "schema": 1, "taxonomyVersion": 1, "reviews": [scaffold]
            }), encoding="utf-8")

            missing = self.run_script(
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
                expect=1,
            )
            self.assertIn("bundled materialization snapshot differs", missing.stderr)

            forged = json.loads(snapshot_path.read_text(encoding="utf-8"))
            forged["questions"][0]["distractorTagsPresent"] = True
            forged["questions"][0]["distractorTags"] = [None, "nearby-detail"]
            snapshot_path.write_text(json.dumps(forged), encoding="utf-8")
            tampered = self.run_script(
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
                expect=1,
            )
            self.assertIn("materializationSHA256 does not match", tampered.stderr)
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

            self.run_script(
                "--corpus", str(corpus_path),
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
                "--write-target", str(corpus_path),
            )
            still_stale = self.run_script(
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
                expect=1,
            )
            self.assertIn("bundled materialization snapshot differs", still_stale.stderr)

            materialized = json.loads(corpus_path.read_text(encoding="utf-8"))
            refreshed, errors = build_snapshot(
                corpus_path,
                materialized,
                source_commit="d" * 40,
                source_path="app/Resources/passages.json",
            )
            self.assertEqual(errors, [])
            snapshot_path.write_text(json.dumps(refreshed), encoding="utf-8")
            self.run_script(
                "--snapshot", str(snapshot_path),
                "--reviews", str(reviews_path),
            )


class ChoiceReorderTests(unittest.TestCase):
    def test_normalizer_moves_choice_and_tag_as_one_pair(self) -> None:
        passages = []
        for index in range(286):
            passages.append({
                "id": f"legacy-{index:03d}",
                "text": "one word",
                "wordCount": 2,
                "questions": [{
                    "id": "q1",
                    "skill": "detail",
                    "stem": "?",
                    "choices": ["zero", "one", "two", "three"],
                    "answer": 3,
                    "explanation": ".",
                    "distractorTags": ["tag-zero", "tag-one", "tag-two", None],
                }],
            })
        corpus = {"schema": 1, "version": 12, "passages": passages}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "passages.json"
            path.write_text(json.dumps(corpus), encoding="utf-8")
            result = subprocess.run(
                ["node", str(NORMALIZER), "--balance-answers", "--input", str(path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            normalized = json.loads(path.read_text(encoding="utf-8"))
            question = normalized["passages"][0]["questions"][0]
            self.assertEqual(question["answer"], 0)
            self.assertEqual(question["choices"][0], "three")
            self.assertIsNone(question["distractorTags"][0])
            self.assertEqual(
                dict(zip(question["choices"], question["distractorTags"])),
                {"three": None, "one": "tag-one", "two": "tag-two", "zero": "tag-zero"},
            )

    def test_complete_question_repair_scripts_refuse_existing_semantic_tags(self) -> None:
        source = json.loads((ROOT / "data" / "passages.json").read_text(encoding="utf-8"))
        scenarios = [
            (FACT_REPAIR, "og-sci-why-ice-floats", "factual repairs before semantic tagging"),
            (HISTORY_REPAIR, "og-his2-the-potato-in-europe", "historical repairs before semantic tagging"),
        ]
        for script, passage_id, expected_message in scenarios:
            with self.subTest(script=script.name), tempfile.TemporaryDirectory() as temp:
                corpus = json.loads(json.dumps(source))
                # These one-time repair tools intentionally accept only their
                # v11/v12 source states. Use that supported version and that
                # legacy passage count so this test reaches the
                # distractor-evidence guard on the current OTA corpus.
                corpus["version"] = 12
                corpus = legacy_source_state(corpus, script, passage_id)
                passage = next(item for item in corpus["passages"] if item["id"] == passage_id)
                question = passage["questions"][0]
                question["distractorTags"] = [None for _choice in question["choices"]]
                path = Path(temp) / "passages.json"
                path.write_text(json.dumps(corpus), encoding="utf-8")
                result = subprocess.run(
                    ["node", str(script), "--dry-run", "--input", str(path)],
                    cwd=ROOT,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(expected_message, result.stderr)


if __name__ == "__main__":
    unittest.main()
