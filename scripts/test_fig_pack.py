#!/usr/bin/env python3
"""Tests for scripts/validate-fig-pack.py.

The pack ships no batch file, so this checker is the only thing standing between
a hand edit and a bad release. Each test injects one real defect shape into a
copy of the live corpus and requires the checker to name it, so the checker
itself cannot quietly stop working.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CHECKER = ROOT / "scripts" / "validate-fig-pack.py"
CORPUS = ROOT / "data" / "passages.json"


def load() -> dict:
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def record(doc: dict, passage_id: str) -> dict:
    for p in doc["passages"]:
        if p.get("id") == passage_id:
            return p
    raise AssertionError(f"{passage_id} is missing from the corpus")


class FigPackValidatorTests(unittest.TestCase):
    def run_checker(self, doc: dict | None = None) -> dict:
        if doc is None:
            return self._run(CORPUS)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "passages.json"
            path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
            return self._run(path)

    def _run(self, path: Path) -> dict:
        result = subprocess.run(
            [sys.executable, str(CHECKER), str(path), "--json"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.stderr, "", result.stderr)
        return json.loads(result.stdout)

    def assertFlags(self, doc: dict, fragment: str) -> None:
        report = self.run_checker(doc)
        joined = "\n".join(report["errors"])
        self.assertIn(fragment, joined, f"expected {fragment!r} in:\n{joined}")

    # --- the published corpus ------------------------------------------------

    def test_live_corpus_pack_is_valid(self):
        report = self.run_checker()
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["summary"]["passages"], 30)
        self.assertEqual(report["summary"]["questions"], 150)
        self.assertEqual(report["summary"]["genres"], {"biography": 10, "essay": 10, "fiction": 10})
        self.assertEqual(report["summary"]["levels"], {"3": 10, "4": 10, "5": 10})
        self.assertEqual(report["summary"]["fifthItems"], {"inference": 15, "vocabulary": 15})

    # --- injected defects ----------------------------------------------------

    def test_detects_skill_tip_naming_a_word_absent_from_the_text(self):
        doc = load()
        p = record(doc, "og-fig-percy-julian-and-the-fifty-three-years")
        p["lesson"]["skillTips"]["vocabulary"] = (
            "Route, synthesis, and recital carry exact senses here. "
            "Read the sentence around each one."
        )
        self.assertFlags(doc, "vocabulary skill tip names 'recital'")

    def test_detects_word_count_drift_after_a_text_edit(self):
        doc = load()
        p = record(doc, "og-fig-a-borrowed-word")
        p["text"] = p["text"] + " One more sentence was appended by hand."
        self.assertFlags(doc, "does not match whitespace count")

    def test_detects_a_passage_outside_its_level_word_band(self):
        doc = load()
        p = record(doc, "og-fig-what-a-recipe-keeps-quiet")
        p["text"] = p["text"] + ("\n\n" + " ".join(["word"] * 120))
        p["wordCount"] = len(p["text"].strip().split())
        self.assertFlags(doc, "is outside level-3 band")

    def test_detects_a_gendered_pronoun_applied_to_an_unnamed_narrator(self):
        doc = load()
        p = record(doc, "og-fig-the-eleven-forty")
        p["lesson"]["skillTips"]["main-idea"] = (
            "The narrator states an opposing view before his own. "
            "A gist that says the bus is lonely has taken the view the story rejects."
        )
        self.assertFlags(doc, "gendered pronoun applied to the writer or narrator")

    def test_detects_a_figurative_target_missing_from_lesson_vocab(self):
        doc = load()
        p = record(doc, "og-fig-what-a-recipe-keeps-quiet")
        for item in p["lesson"]["vocab"]:
            if item["word"] == "goes silent":
                item["word"] = "silent"
        self.assertFlags(doc, "is not seeded into lesson.vocab")

    def test_detects_a_figurative_target_absent_from_the_passage_text(self):
        doc = load()
        p = record(doc, "og-fig-good-bones")
        p["questions"][4]["stem"] = "What does 'buttress' mean in this passage?"
        self.assertFlags(doc, "does not occur in the passage text")

    def test_detects_a_broken_answer_rotation(self):
        doc = load()
        p = record(doc, "og-fig-a-borrowed-word")
        q = p["questions"][0]
        q["choices"] = [q["choices"][1], q["choices"][0]] + q["choices"][2:]
        q["answer"] = 1 if q["answer"] == 0 else 0
        self.assertFlags(doc, "under the pack rotation")

    def test_detects_a_lesson_signal_that_is_not_verbatim(self):
        doc = load()
        p = record(doc, "og-fig-good-bones")
        p["lesson"]["signals"][0]["phrase"] = "a phrase nobody wrote in this passage"
        self.assertFlags(doc, "does not occur verbatim in the text")

    def test_detects_an_em_dash_in_authored_copy(self):
        doc = load()
        p = record(doc, "og-fig-the-dough-remembers")
        p["lesson"]["strategy"] = "A teaching story — with the lesson in its first line."
        self.assertFlags(doc, "non-ASCII dash U+2014")

    def test_detects_an_overlong_teaching_sentence(self):
        doc = load()
        p = record(doc, "og-fig-the-inbox-that-never-sleeps")
        p["lesson"]["skillTips"]["detail"] = " ".join(["word"] * 31) + "."
        self.assertFlags(doc, "exceeds 30")

    def test_detects_a_missing_passage(self):
        doc = load()
        doc["passages"] = [p for p in doc["passages"] if p.get("id") != "og-fig-good-bones"]
        self.assertFlags(doc, "pack must contain exactly 30 passages")

    def test_detects_a_fourth_question_replacing_the_fifth(self):
        doc = load()
        p = record(doc, "og-fig-good-bones")
        p["questions"] = p["questions"][:4]
        self.assertFlags(doc, "questions must contain exactly five items")


if __name__ == "__main__":
    unittest.main()
