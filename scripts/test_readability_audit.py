#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCANNER = ROOT / "scripts" / "audit-readability.py"
REPEATED = (
    "This is not just a result but a broad interpretive claim that repeats the answer "
    "while adding enough extra words to make the teaching sentence need editorial review, "
    "even though the same point could be stated with fewer ordinary words and one clear action."
)


def question(question_id: str, explanation: str, correct: str = "The answer") -> dict:
    return {
        "id": question_id,
        "skill": "detail",
        "stem": "Which answer follows from the passage?",
        "choices": [correct, "No", "Maybe", "Elsewhere"],
        "answer": 0,
        "explanation": explanation,
    }


def original_passage() -> dict:
    return {
        "id": "og-test",
        "title": "Test",
        "sourceType": "original",
        "source": "Written for Fluency",
        "attribution": "Original passage © Studio AM, written for Fluency.",
        "text": "The door was not red but blue. It opened after a direct pull.",
        "questions": [
            question(
                "q1",
                REPEATED,
                "A long correct answer that states the complete supported result in many words",
            ),
            question("q2", REPEATED),
        ],
        "lesson": {
            "strategy": "Read each sentence and state its action.",
            "signals": [],
            "vocab": [],
            "skillTips": {},
        },
    }


def public_domain_passage() -> dict:
    return {
        "id": "pd-test",
        "title": "Old Text",
        "sourceType": "public-domain",
        "source": "Old Work",
        "attribution": "Author, Old Work (1900). Public domain.",
        "text": "It was not merely a road but a testament to the age.",
        "questions": [question("q1", "The old sentence supplies the stated detail.")],
        "lesson": {
            "strategy": "Read the old wording once, then restate its fact in current English.",
            "signals": [],
            "vocab": [],
            "skillTips": {},
        },
    }


class ReadabilityAuditTests(unittest.TestCase):
    def run_scanner(self, path: Path, expected: int = 0) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(SCANNER), str(path), "--json"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            expected,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        return result

    def test_findings_are_stable_reports_not_release_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "passages.json"
            path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "version": 16,
                        "passages": [original_passage(), public_domain_passage()],
                    }
                ),
                encoding="utf-8",
            )
            first = self.run_scanner(path)
            second = self.run_scanner(path)
            self.assertEqual(first.stdout, second.stdout)

            report = json.loads(first.stdout)
            self.assertFalse(report["policy"]["findingsAreReleaseErrors"])
            self.assertFalse(report["policy"]["optionalDistractorTagsRequiredForRelease"])
            self.assertEqual(report["policy"]["optionalDistractorTagCoverageMinimum"], 0)
            self.assertGreaterEqual(report["summary"]["candidatePhraseCount"], 1)
            self.assertGreaterEqual(report["summary"]["longTeachingSentenceCount"], 1)
            self.assertGreaterEqual(report["summary"]["answerLengthCueCount"], 1)
            self.assertEqual(report["summary"]["repeatedExplanationGroupCount"], 1)

    def test_public_domain_text_is_exempt_but_app_written_copy_is_scanned(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "passages.json"
            path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "version": 16,
                        "passages": [original_passage(), public_domain_passage()],
                    }
                ),
                encoding="utf-8",
            )
            report = json.loads(self.run_scanner(path).stdout)
            self.assertEqual(
                [item["passage"] for item in report["publicDomainExemptions"]], ["pd-test"]
            )
            self.assertFalse(
                any(
                    item["passage"] == "pd-test" and item["field"] == "text"
                    for item in report["candidatePhrases"]
                )
            )
            self.assertFalse(
                any(
                    item["passage"] == "og-test"
                    and item["field"] == "text"
                    and item["phrase"] == "not red but"
                    for item in report["candidatePhrases"]
                )
            )

    def test_answer_outlier_contains_machine_readable_ratio(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "passages.json"
            path.write_text(
                json.dumps({"schema": 1, "version": 16, "passages": [original_passage()]}),
                encoding="utf-8",
            )
            report = json.loads(self.run_scanner(path).stdout)
            outlier = next(item for item in report["answerLengthCues"] if item["question"] == "q1")
            self.assertEqual(outlier["passage"], "og-test")
            self.assertGreaterEqual(outlier["ratio"], 1.5)
            self.assertIn("meanDistractorWords", outlier)
            self.assertIn("correctWords", outlier)

    def test_id_prefix_produces_a_stable_cohort_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "passages.json"
            path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "version": 16,
                        "passages": [original_passage(), public_domain_passage()],
                    }
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCANNER),
                    str(path),
                    "--id-prefix",
                    "og-",
                    "--json",
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["corpusPassageCount"], 2)
            self.assertEqual(report["passageCount"], 1)
            self.assertEqual(report["filters"]["passageIdPrefix"], "og-")
            self.assertEqual(report["publicDomainExemptions"], [])

    def test_invalid_json_fails_instead_of_returning_an_empty_scan(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "passages.json"
            path.write_text("{", encoding="utf-8")
            report = json.loads(self.run_scanner(path, expected=1).stdout)
            self.assertTrue(report["errors"])


if __name__ == "__main__":
    unittest.main()
