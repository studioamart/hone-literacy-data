#!/usr/bin/env python3
"""Read-only structural/editorial audit for Fluency's complete OTA corpus.

Unlike build-manifest.mjs, this checks the Swift Codable contract and the fields
that drive WPM, workout selection, recall coaching, and guided rereads. Errors
can break or mis-score the app. Warnings are editorial debt worth reviewing but
do not make a schema-1 corpus unplayable.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

from distractor_taxonomy import load_registry, validate_question_tags


ROOT = Path(__file__).resolve().parent.parent
DEFAULT = ROOT / "data" / "passages.json"
GENRES = {
    "biography", "economics", "essay", "fable", "fiction", "history",
    "nature", "nonfiction", "philosophy", "psychology", "science", "technology",
}
SKILLS = {"main-idea", "inference", "vocabulary", "detail"}
PLACEHOLDER = re.compile(r"\b(?:todo|tbd|placeholder|lorem ipsum|as an ai)\b", re.I)
WORD = re.compile(r"[a-z0-9]+(?:[’'-][a-z0-9]+)*", re.I)
STANDARD_ORIGINAL_ATTRIBUTION = "Original passage © Studio AM, written for Fluency."
# This stable legacy ID now contains a Studio AM rewrite of Aesop's premise,
# not a verbatim public-domain excerpt. Require explicit adaptation provenance
# while keeping the app's accepted `original` sourceType and Fluency source.
ORIGINAL_ATTRIBUTION_EXCEPTIONS = {
    "pd-aesop-ant-grasshopper": (
        "Original modern adaptation of Aesop’s public-domain fable © Studio AM, "
        "written for Fluency."
    ),
}


def norm(value: str) -> str:
    return " ".join(WORD.findall(value.casefold()))


def add(bucket: list[dict], code: str, passage: str, message: str, question: str | None = None):
    item = {"code": code, "passage": passage, "message": message}
    if question is not None:
        item["question"] = question
    bucket.append(item)


def audit(path: Path) -> dict:
    errors: list[dict] = []
    warnings: list[dict] = []
    registry, registry_errors = load_registry()
    for message in registry_errors:
        add(errors, "distractor-taxonomy-registry", "?", message)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "path": str(path),
            "errors": [{"code": "invalid-json", "passage": "?", "message": str(exc)}],
            "warnings": [],
        }

    if not isinstance(doc, dict):
        return {
            "path": str(path),
            "errors": [{"code": "root-type", "passage": "?", "message": "root must be an object"}],
            "warnings": [],
        }
    if doc.get("schema") != 1:
        add(errors, "schema", "?", f"schema must be integer 1, found {doc.get('schema')!r}")
    if not isinstance(doc.get("version"), int) or isinstance(doc.get("version"), bool) or doc["version"] < 1:
        add(errors, "version", "?", f"version must be a positive integer, found {doc.get('version')!r}")
    passages = doc.get("passages")
    if not isinstance(passages, list) or not passages:
        add(errors, "passages", "?", "passages must be a non-empty array")
        passages = []

    ids: collections.defaultdict[str, list[int]] = collections.defaultdict(list)
    titles: collections.defaultdict[str, list[str]] = collections.defaultdict(list)
    answer_positions: collections.Counter[int] = collections.Counter()
    genre_counts: collections.Counter[str] = collections.Counter()
    level_counts: collections.Counter[int] = collections.Counter()
    skill_counts: collections.Counter[str] = collections.Counter()
    total_questions = 0
    total_distractors = 0
    authored_tag_questions = 0
    tagged_questions = 0
    tagged_distractors = 0
    exact_texts: collections.defaultdict[str, list[str]] = collections.defaultdict(list)

    for index, p in enumerate(passages):
        if not isinstance(p, dict):
            add(errors, "passage-type", f"index:{index}", "passage must be an object")
            continue
        pid = p.get("id") if isinstance(p.get("id"), str) else f"index:{index}"
        if not isinstance(p.get("id"), str) or not p["id"].strip():
            add(errors, "id", pid, "id must be a non-empty string")
        else:
            ids[p["id"]].append(index)
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", p["id"]):
                add(warnings, "id-style", pid, "id is not a stable lowercase ASCII slug")

        title = p.get("title")
        if not isinstance(title, str) or not title.strip():
            add(errors, "title", pid, "title must be a non-empty string")
        else:
            titles[norm(title)].append(pid)
            if len(title) > 80:
                add(warnings, "title-length", pid, f"title is {len(title)} characters")

        for field in ("sourceType", "source", "attribution", "genre", "text"):
            if not isinstance(p.get(field), str) or not p[field].strip():
                add(errors, f"missing-{field}", pid, f"{field} must be a non-empty string")

        source_type = p.get("sourceType")
        if source_type not in {"original", "public-domain"}:
            add(errors, "source-type", pid, f"unsupported sourceType {source_type!r}")
        expected_original_attribution = ORIGINAL_ATTRIBUTION_EXCEPTIONS.get(
            pid, STANDARD_ORIGINAL_ATTRIBUTION
        )
        if source_type == "original" and (
            p.get("source") != "Written for Fluency"
            or p.get("attribution") != expected_original_attribution
        ):
            add(warnings, "original-branding", pid, "original source/attribution differs from current Fluency branding")

        genre = p.get("genre")
        if genre not in GENRES:
            add(errors, "genre", pid, f"unsupported genre {genre!r}")
        else:
            genre_counts[genre] += 1
        level = p.get("level")
        if not isinstance(level, int) or isinstance(level, bool) or level not in range(1, 6):
            add(errors, "level", pid, f"level must be integer 1..5, found {level!r}")
        else:
            level_counts[level] += 1

        text = p.get("text") if isinstance(p.get("text"), str) else ""
        if norm(text):
            exact_texts[norm(text)].append(pid)
        words = text.strip().split()
        declared = p.get("wordCount")
        if declared is None:
            add(warnings, "word-count-missing", pid, f"wordCount absent; runtime fallback is {len(words)}")
        elif not isinstance(declared, int) or isinstance(declared, bool):
            add(errors, "word-count-type", pid, f"wordCount must be an integer, found {declared!r}")
        elif declared != len(words):
            add(errors, "word-count-mismatch", pid, f"declared {declared}, whitespace count {len(words)}")
        if len(words) < 80 or len(words) > 300:
            add(warnings, "passage-length", pid, f"passage has {len(words)} words")
        if text and len([x for x in re.split(r"\n\s*\n", text) if x.strip()]) < 2:
            add(warnings, "paragraphs", pid, "passage has fewer than two paragraphs")
        if PLACEHOLDER.search(json.dumps(p, ensure_ascii=False)):
            add(errors, "placeholder", pid, "passage contains placeholder language")

        questions = p.get("questions")
        if not isinstance(questions, list) or not questions:
            add(errors, "questions", pid, "questions must be a non-empty array")
            questions = []
        qids: set[str] = set()
        passage_skills: collections.Counter[str] = collections.Counter()
        for qi, q in enumerate(questions):
            total_questions += 1
            if not isinstance(q, dict):
                add(errors, "question-type", pid, "question must be an object", str(qi))
                continue
            qid = q.get("id") if isinstance(q.get("id"), str) else f"index:{qi}"
            if not isinstance(q.get("id"), str) or not q["id"].strip():
                add(errors, "question-id", pid, "question id must be a non-empty string", qid)
            elif q["id"] in qids:
                add(errors, "question-id-duplicate", pid, "question id is duplicated within passage", qid)
            else:
                qids.add(q["id"])
            skill = q.get("skill")
            if skill not in SKILLS:
                add(errors, "question-skill", pid, f"unknown skill {skill!r}", qid)
            else:
                passage_skills[skill] += 1
                skill_counts[skill] += 1
            for field in ("stem", "explanation"):
                if not isinstance(q.get(field), str) or not q[field].strip():
                    add(errors, f"question-{field}", pid, f"{field} must be non-empty", qid)
            choices = q.get("choices")
            if not isinstance(choices, list) or len(choices) != 4:
                add(errors, "question-choices", pid, "question must have exactly four choices", qid)
                choices = choices if isinstance(choices, list) else []
            elif any(not isinstance(choice, str) or not choice.strip() for choice in choices):
                add(errors, "question-choice-empty", pid, "every choice must be non-empty", qid)
            elif len({norm(choice) for choice in choices}) != 4:
                add(errors, "question-choice-duplicate", pid, "choices are not unique", qid)
            answer = q.get("answer")
            if not isinstance(answer, int) or isinstance(answer, bool) or answer not in range(len(choices)):
                add(errors, "question-answer", pid, f"answer {answer!r} is outside choices", qid)
            else:
                answer_positions[answer] += 1
            tag_issues, coverage = validate_question_tags(q, registry)
            total_distractors += coverage.distractor_slots
            if coverage.authored:
                authored_tag_questions += 1
            if coverage.tagged_slots > 0:
                tagged_questions += 1
                tagged_distractors += coverage.tagged_slots
            for code, message in tag_issues:
                add(errors, code, pid, message, qid)
            if isinstance(q.get("stem"), str) and len(q["stem"]) > 180:
                add(warnings, "question-stem-length", pid, f"stem is {len(q['stem'])} characters", qid)
            if isinstance(q.get("explanation"), str) and len(q["explanation"]) > 400:
                add(warnings, "question-explanation-length", pid, f"explanation is {len(q['explanation'])} characters", qid)
        missing_skills = SKILLS - set(passage_skills)
        if missing_skills:
            add(errors, "question-skill-missing", pid, f"missing skills: {sorted(missing_skills)}")

        lesson = p.get("lesson")
        if not isinstance(lesson, dict):
            add(errors, "lesson", pid, "lesson must be an object")
            continue
        strategy = lesson.get("strategy")
        if not isinstance(strategy, str) or not strategy.strip():
            add(errors, "lesson-strategy", pid, "strategy must be non-empty")
        elif len(strategy) > 320:
            add(warnings, "lesson-strategy-length", pid, f"strategy is {len(strategy)} characters; maximum 320")
        text_lower = text.casefold()
        paragraphs_lower = [x.casefold() for x in re.split(r"\n\s*\n", text)]
        signals = lesson.get("signals")
        if not isinstance(signals, list) or not 2 <= len(signals) <= 4:
            add(warnings, "lesson-signal-count", pid, f"signals should contain 2..4 items, found {len(signals) if isinstance(signals, list) else '?'}")
            signals = signals if isinstance(signals, list) else []
        signal_keys: set[str] = set()
        for si, signal in enumerate(signals):
            if not isinstance(signal, dict):
                add(errors, "lesson-signal-type", pid, "signal must be an object")
                continue
            phrase, means = signal.get("phrase"), signal.get("means")
            if not isinstance(phrase, str) or not phrase.strip():
                add(errors, "lesson-signal-phrase", pid, "signal phrase must be non-empty")
            else:
                key = phrase.casefold()
                if key in signal_keys:
                    add(errors, "lesson-signal-duplicate", pid, f"duplicate signal {phrase!r}")
                signal_keys.add(key)
                if key not in text_lower:
                    add(errors, "lesson-signal-grounding", pid, f"signal is not exact passage text: {phrase!r}")
                elif not any(key in paragraph for paragraph in paragraphs_lower):
                    add(errors, "lesson-signal-paragraph", pid, f"signal crosses a paragraph boundary: {phrase!r}")
                if len(phrase) > 60:
                    add(warnings, "lesson-signal-length", pid, f"signal phrase is {len(phrase)} characters")
            if not isinstance(means, str) or not means.strip():
                add(errors, "lesson-signal-means", pid, "signal explanation must be non-empty")
            elif len(means) > 120:
                add(warnings, "lesson-signal-means-length", pid, f"signal explanation is {len(means)} characters")

        vocab = lesson.get("vocab")
        if not isinstance(vocab, list) or not 2 <= len(vocab) <= 3:
            add(warnings, "lesson-vocab-count", pid, f"vocab should contain 2..3 items, found {len(vocab) if isinstance(vocab, list) else '?'}")
            vocab = vocab if isinstance(vocab, list) else []
        vocab_keys: set[str] = set()
        for item in vocab:
            if not isinstance(item, dict):
                add(errors, "lesson-vocab-type", pid, "vocab item must be an object")
                continue
            word, context = item.get("word"), item.get("inContext")
            if not isinstance(word, str) or not word.strip():
                add(errors, "lesson-vocab-word", pid, "vocabulary word must be non-empty")
            else:
                key = word.casefold()
                if key in vocab_keys:
                    add(errors, "lesson-vocab-duplicate", pid, f"duplicate vocabulary word {word!r}")
                vocab_keys.add(key)
                if key not in text_lower:
                    add(errors, "lesson-vocab-grounding", pid, f"vocabulary word is not exact passage text: {word!r}")
            if not isinstance(context, str) or not context.strip():
                add(errors, "lesson-vocab-context", pid, "vocabulary context must be non-empty")
            elif len(context) > 100:
                add(warnings, "lesson-vocab-context-length", pid, f"vocabulary context is {len(context)} characters")

        tips = lesson.get("skillTips")
        if not isinstance(tips, dict) or set(tips) != SKILLS:
            add(errors, "lesson-skill-tips", pid, f"skillTips keys must be exactly {sorted(SKILLS)}")
        else:
            for skill, tip in tips.items():
                if not isinstance(tip, str) or not tip.strip():
                    add(errors, "lesson-skill-tip-empty", pid, f"skill tip {skill!r} must be non-empty")
                elif len(tip) > 200:
                    add(warnings, "lesson-skill-tip-length", pid, f"skill tip {skill!r} is {len(tip)} characters")

    for pid, indexes in ids.items():
        if len(indexes) > 1:
            add(errors, "id-duplicate", pid, f"id appears at indexes {indexes}")
    for title, pids in titles.items():
        if len(pids) > 1:
            for pid in pids:
                add(warnings, "title-duplicate", pid, f"title is shared by {pids}")
    for text_key, pids in exact_texts.items():
        if len(pids) > 1:
            for pid in pids:
                add(errors, "text-duplicate", pid, f"text is shared by {pids}")

    return {
        "path": str(path),
        "schema": doc.get("schema"),
        "version": doc.get("version"),
        "passageCount": len(passages),
        "questionCount": total_questions,
        "levelCounts": dict(sorted(level_counts.items())),
        "genreCounts": dict(sorted(genre_counts.items())),
        "skillCounts": dict(sorted(skill_counts.items())),
        "answerPositions": dict(sorted(answer_positions.items())),
        "distractorCoverage": {
            "authoredQuestionCount": authored_tag_questions,
            "taggedQuestionCount": tagged_questions,
            "questionCount": total_questions,
            "taggedDistractorCount": tagged_distractors,
            "distractorCount": total_distractors,
        },
        "errors": errors,
        "warnings": warnings,
        "issueCounts": {
            "errors": dict(sorted(collections.Counter(x["code"] for x in errors).items())),
            "warnings": dict(sorted(collections.Counter(x["code"] for x in warnings).items())),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT)
    parser.add_argument("--json", action="store_true", help="print full machine-readable report")
    parser.add_argument("--strict", action="store_true", help="also fail when warnings exist")
    args = parser.parse_args()
    path = args.path if args.path.is_absolute() else Path.cwd() / args.path
    report = audit(path)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(
            f"Corpus v{report.get('version', '?')}: {report.get('passageCount', 0)} passages, "
            f"{report.get('questionCount', 0)} questions"
        )
        print(f"Errors: {len(report['errors'])}; warnings: {len(report['warnings'])}")
        coverage = report.get("distractorCoverage", {})
        print(
            "Distractor evidence: "
            f"{coverage.get('taggedQuestionCount', 0)}/{coverage.get('questionCount', 0)} "
            "questions; "
            f"{coverage.get('taggedDistractorCount', 0)}/{coverage.get('distractorCount', 0)} "
            "distractor slots; "
            f"{coverage.get('authoredQuestionCount', 0)} optional tag arrays present "
            "(partial nil coverage is allowed)"
        )
        for severity in ("errors", "warnings"):
            counts = report.get("issueCounts", {}).get(severity, {})
            if counts:
                print(f"{severity.title()} by code:")
                for code, count in counts.items():
                    print(f"  {code}: {count}")
    return 1 if report["errors"] or (args.strict and report["warnings"]) else 0


if __name__ == "__main__":
    sys.exit(main())
