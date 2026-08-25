#!/usr/bin/env python3
"""Report conservative English-readability candidates in the Fluency corpus.

This is an editorial scanner, not a release score. A finding asks for review;
it does not prove that the text is wrong. Invalid input still fails so a broken
or unreadable corpus cannot produce an empty-looking report.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import re
import statistics
import sys
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CORPUS = ROOT / "data" / "passages.json"
WORD_RE = re.compile(r"[a-z0-9]+(?:[’'-][a-z0-9]+)*", re.I)
SENTENCE_BREAK = re.compile(r"(?<=[.!?])[\"”’']*\s+")

# These patterns are deliberately narrow. They identify stock contrast,
# abstract emphasis, and reading-instruction language that often benefits from
# a direct rewrite. They do not ban any word or phrase.
CANDIDATE_RULES = (
    (
        "fake-contrast-not-just",
        re.compile(r"\bnot (?:just|simply|merely|only)\b[^.!?\n]{0,120}\bbut\b", re.I),
        False,
    ),
    (
        "fake-contrast-more-than",
        re.compile(r"\bmore than (?:just|simply)\b", re.I),
        False,
    ),
    (
        "stock-importance",
        re.compile(r"\b(?:highlights?|underscores?|showcases?) the importance of\b", re.I),
        False,
    ),
    (
        "stock-abstraction",
        re.compile(r"\b(?:multifaceted|nuanced|interplay|paradigm|actionable)\b", re.I),
        False,
    ),
    (
        "stock-metaphor",
        re.compile(
            r"\b(?:serves|acts|functions) as (?:a|an|the) "
            r"(?:bridge|lens|mirror|window|roadmap|testament)\b",
            re.I,
        ),
        False,
    ),
    (
        "interpretive-jargon",
        re.compile(
            r"\b(?:the passage|the author|the narrator) "
            r"(?:frames|positions|invites|foregrounds|complicates)\b",
            re.I,
        ),
        True,
    ),
    (
        "instructional-metaphor",
        re.compile(
            r"\b(?:track|trace) the (?:argument|contrast|hinge|pivot|reversal|shift|"
            r"causal chain|structure)\b|\b(?:hinge|pivot|lens) of the "
            r"(?:argument|passage|story|explanation)\b",
            re.I,
        ),
        True,
    ),
)


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT.resolve()))
    except ValueError:
        return str(path)


def words(value: str) -> list[str]:
    return WORD_RE.findall(value)


def normalize(value: str) -> str:
    return " ".join(word.casefold() for word in words(value))


def sentences(value: str) -> list[str]:
    return [part.strip() for part in SENTENCE_BREAK.split(value.strip()) if part.strip()]


def sentence_for_offset(value: str, offset: int) -> str:
    start = 0
    for sentence in sentences(value):
        found = value.find(sentence, start)
        if found < 0:
            continue
        end = found + len(sentence)
        if found <= offset < end:
            return " ".join(sentence.split())
        start = end
    return " ".join(value.split())


def teaching_fields(passage: dict) -> Iterable[tuple[str, str]]:
    questions = passage.get("questions")
    if isinstance(questions, list):
        for index, question in enumerate(questions):
            if not isinstance(question, dict):
                continue
            question_id = question.get("id") if isinstance(question.get("id"), str) else str(index)
            explanation = question.get("explanation")
            if isinstance(explanation, str):
                yield f"questions/{question_id}/explanation", explanation

    lesson = passage.get("lesson")
    if not isinstance(lesson, dict):
        return
    strategy = lesson.get("strategy")
    if isinstance(strategy, str):
        yield "lesson/strategy", strategy
    signals = lesson.get("signals")
    if isinstance(signals, list):
        for index, signal in enumerate(signals):
            if isinstance(signal, dict) and isinstance(signal.get("means"), str):
                yield f"lesson/signals/{index}/means", signal["means"]
    vocab = lesson.get("vocab")
    if isinstance(vocab, list):
        for index, item in enumerate(vocab):
            if isinstance(item, dict) and isinstance(item.get("inContext"), str):
                yield f"lesson/vocab/{index}/inContext", item["inContext"]
    tips = lesson.get("skillTips")
    if isinstance(tips, dict):
        for skill in sorted(tips):
            if isinstance(tips[skill], str):
                yield f"lesson/skillTips/{skill}", tips[skill]


def assessment_fields(passage: dict) -> Iterable[tuple[str, str]]:
    questions = passage.get("questions")
    if not isinstance(questions, list):
        return
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            continue
        question_id = question.get("id") if isinstance(question.get("id"), str) else str(index)
        stem = question.get("stem")
        if isinstance(stem, str):
            yield f"questions/{question_id}/stem", stem
        choices = question.get("choices")
        if isinstance(choices, list):
            for choice_index, choice in enumerate(choices):
                if isinstance(choice, str):
                    yield f"questions/{question_id}/choices/{choice_index}", choice


def nearest_rank(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def empty_report(path: Path, error: str, passage_id_prefix: str | None = None) -> dict:
    return {
        "schema": 1,
        "path": display_path(path),
        "corpusVersion": None,
        "corpusPassageCount": 0,
        "passageCount": 0,
        "filters": {"passageIdPrefix": passage_id_prefix},
        "policy": {
            "findingsAreReleaseErrors": False,
            "optionalDistractorTagsRequiredForRelease": False,
            "optionalDistractorTagCoverageMinimum": 0,
            "publicDomainSourceTextIsExempt": True,
        },
        "thresholds": {},
        "summary": {},
        "answerLengthSummary": {},
        "candidatePhrases": [],
        "longTeachingSentences": [],
        "answerLengthCues": [],
        "repeatedExplanations": [],
        "publicDomainExemptions": [],
        "errors": [error],
    }


def audit(
    path: Path,
    long_sentence_words: int = 30,
    answer_ratio: float = 2.0,
    answer_min_gap: int = 4,
    passage_id_prefix: str | None = None,
) -> dict:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return empty_report(path, f"cannot read valid JSON: {exc}", passage_id_prefix)
    if not isinstance(document, dict) or not isinstance(document.get("passages"), list):
        return empty_report(path, "top level must contain a passages array", passage_id_prefix)

    corpus_passages = document["passages"]
    passages = [
        passage
        for passage in corpus_passages
        if passage_id_prefix is None
        or (
            isinstance(passage, dict)
            and isinstance(passage.get("id"), str)
            and passage["id"].startswith(passage_id_prefix)
        )
    ]
    candidate_phrases: list[dict] = []
    long_sentences: list[dict] = []
    answer_cues: list[dict] = []
    public_domain: list[dict] = []
    explanation_occurrences: collections.defaultdict[str, list[dict]] = collections.defaultdict(list)
    explanation_text: dict[str, str] = {}
    all_answer_ratios: list[float] = []
    errors: list[str] = []

    for passage_index, passage in enumerate(passages):
        if not isinstance(passage, dict):
            errors.append(f"passages[{passage_index}] is not an object")
            continue
        passage_id = passage.get("id")
        if not isinstance(passage_id, str) or not passage_id:
            errors.append(f"passages[{passage_index}] has no string id")
            passage_id = f"index:{passage_index}"

        source_type = passage.get("sourceType")
        passage_text = passage.get("text")
        if source_type == "public-domain" and isinstance(passage_text, str):
            public_domain.append(
                {
                    "passage": passage_id,
                    "field": "text",
                    "source": passage.get("source") if isinstance(passage.get("source"), str) else "",
                    "attribution": (
                        passage.get("attribution")
                        if isinstance(passage.get("attribution"), str)
                        else ""
                    ),
                    "reason": "Verbatim public-domain source text is excluded from direct-language findings.",
                }
            )

        teaching = list(teaching_fields(passage))
        candidate_fields: list[tuple[str, str, bool]] = [
            (field, value, True) for field, value in teaching
        ]
        candidate_fields.extend((field, value, False) for field, value in assessment_fields(passage))
        if source_type != "public-domain" and isinstance(passage_text, str):
            candidate_fields.append(("text", passage_text, False))

        for field, value, is_teaching in candidate_fields:
            for rule, pattern, teaching_only in CANDIDATE_RULES:
                if teaching_only and not is_teaching:
                    continue
                for match in pattern.finditer(value):
                    candidate_phrases.append(
                        {
                            "passage": passage_id,
                            "field": field,
                            "rule": rule,
                            "phrase": match.group(0),
                            "context": sentence_for_offset(value, match.start()),
                        }
                    )

        for field, value in teaching:
            for sentence_index, sentence in enumerate(sentences(value)):
                count = len(words(sentence))
                if count > long_sentence_words:
                    long_sentences.append(
                        {
                            "passage": passage_id,
                            "field": field,
                            "sentenceIndex": sentence_index,
                            "wordCount": count,
                            "text": " ".join(sentence.split()),
                        }
                    )

        questions = passage.get("questions")
        if not isinstance(questions, list):
            continue
        for question_index, question in enumerate(questions):
            if not isinstance(question, dict):
                continue
            question_id = (
                question.get("id") if isinstance(question.get("id"), str) else str(question_index)
            )
            explanation = question.get("explanation")
            if isinstance(explanation, str):
                key = normalize(explanation)
                if len(words(explanation)) >= 6 and key:
                    explanation_text.setdefault(key, explanation)
                    explanation_occurrences[key].append(
                        {"passage": passage_id, "question": question_id}
                    )

            choices = question.get("choices")
            answer = question.get("answer")
            if (
                not isinstance(choices, list)
                or len(choices) < 2
                or not all(isinstance(choice, str) for choice in choices)
                or not isinstance(answer, int)
                or isinstance(answer, bool)
                or not 0 <= answer < len(choices)
            ):
                continue
            choice_words = [len(words(choice)) for choice in choices]
            distractor_words = [
                count for index, count in enumerate(choice_words) if index != answer
            ]
            mean_distractor = statistics.fmean(distractor_words)
            if mean_distractor <= 0:
                continue
            correct_words = choice_words[answer]
            ratio = correct_words / mean_distractor
            all_answer_ratios.append(ratio)
            gap = correct_words - mean_distractor
            if ratio >= answer_ratio and gap >= answer_min_gap:
                answer_cues.append(
                    {
                        "passage": passage_id,
                        "question": question_id,
                        "skill": question.get("skill") if isinstance(question.get("skill"), str) else "",
                        "correctIndex": answer,
                        "correctWords": correct_words,
                        "meanDistractorWords": round(mean_distractor, 3),
                        "ratio": round(ratio, 3),
                        "correctChoice": choices[answer],
                    }
                )

    repeated = []
    for key, occurrences in explanation_occurrences.items():
        if len(occurrences) > 1:
            repeated.append(
                {
                    "normalized": key,
                    "text": explanation_text[key],
                    "occurrences": sorted(
                        occurrences, key=lambda item: (item["passage"], item["question"])
                    ),
                }
            )

    candidate_phrases.sort(
        key=lambda item: (item["passage"], item["field"], item["rule"], item["phrase"])
    )
    long_sentences.sort(
        key=lambda item: (item["passage"], item["field"], item["sentenceIndex"])
    )
    answer_cues.sort(key=lambda item: (item["passage"], item["question"]))
    repeated.sort(
        key=lambda item: (
            item["occurrences"][0]["passage"],
            item["occurrences"][0]["question"],
            item["normalized"],
        )
    )
    public_domain.sort(key=lambda item: item["passage"])

    rounded_ratios = [round(value, 3) for value in all_answer_ratios]
    return {
        "schema": 1,
        "path": display_path(path),
        "corpusVersion": document.get("version"),
        "corpusPassageCount": len(corpus_passages),
        "passageCount": len(passages),
        "filters": {"passageIdPrefix": passage_id_prefix},
        "policy": {
            "findingsAreReleaseErrors": False,
            "optionalDistractorTagsRequiredForRelease": False,
            "optionalDistractorTagCoverageMinimum": 0,
            "publicDomainSourceTextIsExempt": True,
        },
        "thresholds": {
            "longTeachingSentenceWords": long_sentence_words,
            "answerLengthRatio": answer_ratio,
            "answerLengthMinimumWordGap": answer_min_gap,
        },
        "summary": {
            "candidatePhraseCount": len(candidate_phrases),
            "longTeachingSentenceCount": len(long_sentences),
            "answerLengthCueCount": len(answer_cues),
            "repeatedExplanationGroupCount": len(repeated),
            "publicDomainExemptionCount": len(public_domain),
        },
        "answerLengthSummary": {
            "questionCount": len(rounded_ratios),
            "medianCorrectToDistractorRatio": (
                round(statistics.median(rounded_ratios), 3) if rounded_ratios else None
            ),
            "p90CorrectToDistractorRatio": (
                round(nearest_rank(rounded_ratios, 0.9), 3) if rounded_ratios else None
            ),
            "maximumCorrectToDistractorRatio": max(rounded_ratios) if rounded_ratios else None,
        },
        "candidatePhrases": candidate_phrases,
        "longTeachingSentences": long_sentences,
        "answerLengthCues": answer_cues,
        "repeatedExplanations": repeated,
        "publicDomainExemptions": public_domain,
        "errors": errors,
    }


def print_items(label: str, items: list[dict], limit: int) -> None:
    if not items:
        return
    print(f"{label} (showing {min(limit, len(items))}/{len(items)}):")
    for item in items[:limit]:
        if "rule" in item:
            print(f"  {item['passage']} {item['field']} [{item['rule']}]: {item['phrase']}")
        elif "wordCount" in item:
            print(f"  {item['passage']} {item['field']}: {item['wordCount']} words")
        elif "ratio" in item:
            print(
                f"  {item['passage']} {item['question']}: ratio {item['ratio']} "
                f"({item['correctWords']} vs {item['meanDistractorWords']} words)"
            )
        else:
            print(f"  {item['occurrences']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--json", action="store_true", help="print the complete stable report")
    parser.add_argument("--limit", type=int, default=20, help="items per section in text output")
    parser.add_argument("--long-sentence-words", type=int, default=30)
    parser.add_argument("--answer-ratio", type=float, default=2.0)
    parser.add_argument("--answer-min-gap", type=int, default=4)
    parser.add_argument(
        "--id-prefix",
        help="scan only passage IDs with this prefix; the full corpus count remains in the report",
    )
    args = parser.parse_args()

    path = args.path if args.path.is_absolute() else Path.cwd() / args.path
    report = audit(
        path,
        long_sentence_words=args.long_sentence_words,
        answer_ratio=args.answer_ratio,
        answer_min_gap=args.answer_min_gap,
        passage_id_prefix=args.id_prefix,
    )
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(
            f"Readability scan: corpus v{report.get('corpusVersion', '?')}, "
            f"{report.get('passageCount', 0)} passages"
        )
        if report["errors"]:
            print(f"Input errors: {len(report['errors'])}")
            for error in report["errors"]:
                print(f"  {error}")
        else:
            summary = report["summary"]
            print(
                "Review candidates: "
                f"{summary['candidatePhraseCount']} phrases; "
                f"{summary['longTeachingSentenceCount']} long teaching sentences; "
                f"{summary['answerLengthCueCount']} answer-length cues; "
                f"{summary['repeatedExplanationGroupCount']} repeated explanation groups."
            )
            print(
                f"Public-domain source-text exemptions: "
                f"{summary['publicDomainExemptionCount']}."
            )
            print("Findings are review prompts, not release errors.")
            print("Optional distractor tags have no release coverage minimum.")
            print_items("Direct-language candidates", report["candidatePhrases"], args.limit)
            print_items("Long teaching sentences", report["longTeachingSentences"], args.limit)
            print_items("Answer-length cues", report["answerLengthCues"], args.limit)
            print_items("Repeated explanations", report["repeatedExplanations"], args.limit)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
