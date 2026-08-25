#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CHECKER = ROOT / "scripts" / "year_pack_parity.py"


def passage(passage_id: str, explanation: str = "The detail supports the answer.") -> dict:
    return {
        "id": passage_id,
        "title": "A Test Passage",
        "sourceType": "original",
        "text": "A short test passage.",
        "questions": [
            {
                "id": "q1",
                "stem": "Which answer is supported?",
                "choices": ["The supported answer", "A distractor"],
                "answer": 0,
                "explanation": explanation,
            }
        ],
    }


class YearPackParityTests(unittest.TestCase):
    def run_checker(
        self, pack_dir: Path, corpus_path: Path, expected: int = 0, expected_count: int = 1
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [
                sys.executable,
                str(CHECKER),
                "--pack-dir",
                str(pack_dir),
                "--corpus",
                str(corpus_path),
                "--expected-count",
                str(expected_count),
                "--json",
            ],
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

    def write_fixture(self, root: Path, batch: list[dict], live: list[dict]) -> tuple[Path, Path]:
        pack_dir = root / "pack"
        pack_dir.mkdir()
        (pack_dir / "batch-01.json").write_text(
            json.dumps({"passages": batch}), encoding="utf-8"
        )
        corpus_path = root / "passages.json"
        corpus_path.write_text(
            json.dumps({"schema": 1, "version": 15, "passages": live}), encoding="utf-8"
        )
        return pack_dir, corpus_path

    def test_exact_objects_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            item = passage("og-y26-d001-test")
            pack_dir, corpus_path = self.write_fixture(Path(temp), [item], [item])
            report = json.loads(self.run_checker(pack_dir, corpus_path).stdout)
            self.assertTrue(report["ok"])
            self.assertEqual(report["mismatches"], [])

    def test_any_object_drift_fails_and_names_the_field(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            batch = passage("og-y26-d001-test")
            live = passage("og-y26-d001-test", "A newer explanation supports the answer.")
            pack_dir, corpus_path = self.write_fixture(Path(temp), [batch], [live])
            report = json.loads(self.run_checker(pack_dir, corpus_path, expected=1).stdout)
            self.assertFalse(report["ok"])
            self.assertEqual(report["mismatches"][0]["passage"], batch["id"])
            self.assertEqual(
                report["mismatches"][0]["difference"], "$/questions/0/explanation"
            )

    def test_missing_record_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            item = passage("og-y26-d001-test")
            pack_dir, corpus_path = self.write_fixture(Path(temp), [], [item])
            report = json.loads(self.run_checker(pack_dir, corpus_path, expected=1).stdout)
            self.assertIn("present in live corpus but missing from batches", " ".join(report["errors"]))

    def test_duplicate_and_malformed_batch_records_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            item = passage("og-y26-d001-test")
            pack_dir, corpus_path = self.write_fixture(root, [item], [item])
            (pack_dir / "batch-02.json").write_text(
                json.dumps({"passages": [item]}), encoding="utf-8"
            )
            report = json.loads(self.run_checker(pack_dir, corpus_path, expected=1).stdout)
            self.assertIn("duplicate batch record", " ".join(report["errors"]))

            (pack_dir / "batch-02.json").write_text("{", encoding="utf-8")
            report = json.loads(self.run_checker(pack_dir, corpus_path, expected=1).stdout)
            self.assertIn("cannot read valid JSON", " ".join(report["errors"]))


if __name__ == "__main__":
    unittest.main()
