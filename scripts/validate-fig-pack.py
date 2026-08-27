#!/usr/bin/env python3
"""Validate the figurative-language and tone pack (`og-fig-*`) inside the corpus.

The year pack ships batch files, so `year_pack_parity.py` can prove that the
published records still match an authoring source. This pack has no batch file
by design, which would otherwise leave its mechanical invariants unverifiable
and its "regenerated, never hand-edited" discipline unrunnable. Everything a
generator would have guaranteed is asserted here instead, directly against the
published corpus, so a hand edit that breaks an invariant fails like any other
release check.

Editorial judgement is out of scope. This checks only what can be decided
mechanically from the records themselves.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import statistics
import sys
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CORPUS = ROOT / "data" / "passages.json"

ID_PREFIX = "og-fig-"
ID_RE = re.compile(r"^og-fig-[a-z0-9]+(?:-[a-z0-9]+)*$")
EXPECTED_COUNT = 30
GENRE_TARGETS = {"biography": 10, "essay": 10, "fiction": 10}
LEVEL_TARGETS = {3: 10, 4: 10, 5: 10}
# The year pack's authoring bands, reused unchanged: a level-4 reader meets the
# same passage length here as in the daily pack.
WORD_BANDS = {3: (165, 200), 4: (190, 225), 5: (215, 255)}
CORE_SKILLS = ["main-idea", "inference", "vocabulary", "detail"]
# The fifth item is either a figurative-meaning item (scored as `vocabulary`) or
# a tone item (scored as `inference`), fifteen of each.
FIFTH_SKILL_TARGETS = {"vocabulary": 15, "inference": 15}
SOURCE = "Written for Fluency"
ATTRIBUTION = "Original passage © Studio AM, written for Fluency."
SOURCE_TYPE = "original"
RELEASED_AT = "2026-08-26"
PLACEHOLDER_RE = re.compile(r"\b(?:todo|tbd|placeholder|lorem ipsum|as an ai)\b", re.I)
WORD_RE = re.compile(r"[a-z0-9]+(?:[’'-][a-z0-9]+)*", re.I)
SENTENCE_BREAK = re.compile(r"(?<=[.!?])[\"”’']*\s+")
QUOTED_RE = re.compile(r"'([^']+)'")
# audit-readability.py's teaching-sentence threshold, applied to this pack as a
# hard gate rather than a review prompt.
MAX_TEACHING_SENTENCE_WORDS = 30
# audit-readability.py's answer-length cue thresholds.
ANSWER_CUE_RATIO = 2.0
ANSWER_CUE_MIN_GAP = 4

# The vocabulary skill tip opens by naming its targets ("Route, synthesis, and
# sterols carry exact senses here"). Every named target must occur verbatim in
# the passage, or the tip sends a learner hunting a word that is not there.
TIP_LIST_BOUNDARY = {
    "all", "both", "are", "is", "was", "come", "carry", "belong",
    "get", "have", "describe", "mean", "matter",
}

VOICE_SUBJECT_RE = re.compile(r"\bthe (?:writer|narrator)\b", re.I)
GENDERED_RE = re.compile(r"\b(?:he|she|his|her|hers|him|himself|herself)\b", re.I)
# Sentences where a gendered pronoun sits beside "the writer" but refers to a
# person the passage does mark. Reviewed individually; everything else fails.
VOICE_PRONOUN_EXCEPTIONS = {
    # "he" is the neighbour, introduced as "My neighbour ... He has never sold one".
    ("og-fig-the-hobby-that-pays-nothing", "questions/q2/stem"),
    ("og-fig-the-hobby-that-pays-nothing", "questions/q5/explanation"),
    # "she" is Bessie Coleman, named in the passage and in the same question.
    ("og-fig-the-language-bessie-coleman-had-to-learn", "questions/q5/explanation"),
}


def words(value: str) -> list[str]:
    return WORD_RE.findall(value)


def sentences(value: str) -> list[str]:
    return [part.strip() for part in SENTENCE_BREAK.split(value.strip()) if part.strip()]


def tip_targets(tip: str) -> list[str]:
    """The words a vocabulary skill tip names before its first verb."""
    head = tip.split(".")[0].strip()
    parts = [part.strip() for part in head.split(", ")]
    last, items = parts[-1], parts[:-1]
    if last.lower().startswith("and "):
        tail = last[4:]
    elif " and " in last:
        first, tail = last.split(" and ", 1)
        items.append(first.strip())
    else:
        tail = last
    tokens = tail.split()
    cut = len(tokens)
    for index, token in enumerate(tokens):
        if token.strip(",").lower() in TIP_LIST_BOUNDARY:
            cut = index
            break
    items.append(" ".join(tokens[:cut]))
    return [item.strip().strip(",") for item in items if item.strip()]


def teaching_fields(p: dict):
    for q in p["questions"]:
        yield f"questions/{q['id']}/explanation", q["explanation"]
    lesson = p["lesson"]
    yield "lesson/strategy", lesson["strategy"]
    for index, signal in enumerate(lesson["signals"]):
        yield f"lesson/signals/{index}/means", signal["means"]
    for index, item in enumerate(lesson["vocab"]):
        yield f"lesson/vocab/{index}/inContext", item["inContext"]
    for skill in sorted(lesson["skillTips"]):
        yield f"lesson/skillTips/{skill}", lesson["skillTips"][skill]


def voice_fields(p: dict):
    for q in p["questions"]:
        yield f"questions/{q['id']}/stem", q["stem"]
        for index, choice in enumerate(q["choices"]):
            yield f"questions/{q['id']}/choices/{index}", choice
    yield from teaching_fields(p)


def every_string(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from every_string(item)
    elif isinstance(value, list):
        for item in value:
            yield from every_string(item)


def check(p: dict, index: int, errors: list[str]) -> None:
    pid = p["id"]

    def fail(message: str) -> None:
        errors.append(f"{pid}: {message}")

    if not ID_RE.match(pid):
        fail("id must match og-fig-<slug>")
    for field, expected in (
        ("sourceType", SOURCE_TYPE),
        ("source", SOURCE),
        ("attribution", ATTRIBUTION),
        ("releasedAt", RELEASED_AT),
    ):
        if p.get(field) != expected:
            fail(f"{field} must be {expected!r}, found {p.get(field)!r}")
    if p.get("genre") not in GENRE_TARGETS:
        fail(f"genre must be one of {sorted(GENRE_TARGETS)}, found {p.get('genre')!r}")
    level = p.get("level")
    if level not in LEVEL_TARGETS:
        fail(f"level must be one of {sorted(LEVEL_TARGETS)}, found {level!r}")

    text = p.get("text")
    if not isinstance(text, str) or not text.strip():
        fail("text must be a non-empty string")
        return
    if PLACEHOLDER_RE.search(text):
        fail("text contains a placeholder phrase")

    # wordCount is never declared by hand: it must equal the whitespace count.
    counted = len(text.strip().split())
    if p.get("wordCount") != counted:
        fail(f"wordCount {p.get('wordCount')!r} does not match whitespace count {counted}")
    if level in WORD_BANDS:
        low, high = WORD_BANDS[level]
        if not low <= counted <= high:
            fail(f"{counted} words is outside level-{level} band {low}..{high}")

    paragraphs = [x for x in re.split(r"\n\s*\n", text.strip()) if x.strip()]
    if not 2 <= len(paragraphs) <= 4:
        fail(f"passage needs 2..4 paragraphs, found {len(paragraphs)}")
    if len(sentences(text)) < 5:
        fail(f"passage needs at least 5 sentences, found {len(sentences(text))}")

    questions = p.get("questions")
    if not isinstance(questions, list) or len(questions) != 5:
        fail("questions must contain exactly five items")
        return
    skills = [q.get("skill") for q in questions]
    if skills[:4] != CORE_SKILLS:
        fail(f"the first four questions must be {CORE_SKILLS}, found {skills[:4]}")
    if skills[4] not in FIFTH_SKILL_TARGETS:
        fail(f"the fifth question must be one of {sorted(FIFTH_SKILL_TARGETS)}, found {skills[4]!r}")

    for position, q in enumerate(questions):
        qid = q.get("id")
        if qid != f"q{position + 1}":
            fail(f"question {position} must have id q{position + 1}, found {qid!r}")
        choices = q.get("choices")
        answer = q.get("answer")
        if not isinstance(choices, list) or len(choices) != 4:
            fail(f"{qid}: must offer exactly four choices")
            continue
        if len({c.strip().casefold() for c in choices}) != 4:
            fail(f"{qid}: choices must be distinct")
        if not isinstance(answer, int) or isinstance(answer, bool) or not 0 <= answer < 4:
            fail(f"{qid}: answer must be an index 0..3, found {answer!r}")
            continue
        # The pack rotates the key so no position is over-represented.
        expected_answer = (index + position) % 4
        if answer != expected_answer:
            fail(f"{qid}: answer index must be {expected_answer} under the pack rotation, found {answer}")
        counts = [len(words(choice)) for choice in choices]
        mean_distractor = statistics.fmean([c for i, c in enumerate(counts) if i != answer])
        if mean_distractor > 0:
            ratio = counts[answer] / mean_distractor
            gap = counts[answer] - mean_distractor
            if ratio >= ANSWER_CUE_RATIO and gap >= ANSWER_CUE_MIN_GAP:
                fail(f"{qid}: correct choice is an answer-length cue (ratio {ratio:.2f})")
        if not isinstance(q.get("explanation"), str) or not q["explanation"].strip():
            fail(f"{qid}: explanation must be a non-empty string")

    # A figurative fifth item must target a phrase that is actually in the text,
    # and the same phrase must be glossed in lesson.vocab so the coaching card
    # covers the word the item tested.
    fifth = questions[4]
    if fifth.get("skill") == "vocabulary":
        quoted = QUOTED_RE.findall(fifth.get("stem", ""))
        if not quoted:
            fail("q5: a figurative item must quote its target in the stem")
        else:
            target = quoted[0]
            if target.casefold() not in text.casefold():
                fail(f"q5: figurative target {target!r} does not occur in the passage text")
            glossed = {v["word"].casefold() for v in p["lesson"]["vocab"]}
            if target.casefold() not in glossed:
                fail(f"q5: figurative target {target!r} is not seeded into lesson.vocab")

    lesson = p.get("lesson")
    if not isinstance(lesson, dict):
        fail("lesson must be an object")
        return
    for signal in lesson.get("signals", []):
        if signal["phrase"] not in text:
            fail(f"lesson signal {signal['phrase']!r} does not occur verbatim in the text")
    for item in lesson.get("vocab", []):
        if item["word"].casefold() not in text.casefold():
            fail(f"lesson vocab {item['word']!r} does not occur in the text")
    tips = lesson.get("skillTips")
    if not isinstance(tips, dict) or sorted(tips) != sorted(CORE_SKILLS):
        fail(f"lesson.skillTips must cover exactly {sorted(CORE_SKILLS)}")
    else:
        for target in tip_targets(tips["vocabulary"]):
            if target.casefold() not in text.casefold():
                fail(f"vocabulary skill tip names {target!r}, which is not in the passage text")

    for field, value in teaching_fields(p):
        for sentence in sentences(value):
            length = len(words(sentence))
            if length > MAX_TEACHING_SENTENCE_WORDS:
                fail(f"{field}: teaching sentence of {length} words exceeds {MAX_TEACHING_SENTENCE_WORDS}")

    # The narrator of a first-person passage and the writer of an essay are
    # unnamed voices. Teaching copy must not give them a gender the text never
    # states.
    for field, value in voice_fields(p):
        if (pid, field) in VOICE_PRONOUN_EXCEPTIONS:
            continue
        for sentence in sentences(value):
            if VOICE_SUBJECT_RE.search(sentence) and GENDERED_RE.search(sentence):
                fail(f"{field}: gendered pronoun applied to the writer or narrator: {sentence!r}")

    for value in every_string(p):
        for character in value:
            if unicodedata.category(character) == "Pd" and character != "-":
                fail(f"non-ASCII dash U+{ord(character):04X} in {value[:48]!r}")
                break


def validate(path: Path) -> tuple[list[str], dict]:
    errors: list[str] = []
    doc = json.loads(path.read_text(encoding="utf-8"))
    passages = [p for p in doc["passages"] if isinstance(p, dict) and str(p.get("id", "")).startswith(ID_PREFIX)]
    if len(passages) != EXPECTED_COUNT:
        errors.append(f"pack must contain exactly {EXPECTED_COUNT} passages, found {len(passages)}")
    for index, p in enumerate(passages):
        check(p, index, errors)

    genres = collections.Counter(p.get("genre") for p in passages)
    levels = collections.Counter(p.get("level") for p in passages)
    fifths = collections.Counter(
        p["questions"][4].get("skill") for p in passages
        if isinstance(p.get("questions"), list) and len(p["questions"]) == 5
    )
    if len(passages) == EXPECTED_COUNT:
        if dict(genres) != GENRE_TARGETS:
            errors.append(f"genre counts must be {GENRE_TARGETS}, found {dict(sorted(genres.items()))}")
        if dict(levels) != LEVEL_TARGETS:
            errors.append(f"level counts must be {LEVEL_TARGETS}, found {dict(sorted(levels.items()))}")
        if dict(fifths) != FIFTH_SKILL_TARGETS:
            errors.append(f"fifth-item shapes must be {FIFTH_SKILL_TARGETS}, found {dict(sorted(fifths.items()))}")
        spread = collections.Counter(
            q["answer"] for p in passages for q in p["questions"] if isinstance(q.get("answer"), int)
        )
        if sorted(spread.values()) != [37, 37, 38, 38]:
            errors.append(f"answer positions must spread 38/38/37/37, found {dict(sorted(spread.items()))}")

    summary = {
        "version": doc.get("version"),
        "passages": len(passages),
        "questions": sum(len(p.get("questions", [])) for p in passages),
        "genres": dict(sorted(genres.items())),
        "levels": dict(sorted(levels.items())),
        "fifthItems": dict(sorted(fifths.items())),
    }
    return errors, summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--json", action="store_true", help="emit a machine-readable report")
    args = parser.parse_args()

    errors, summary = validate(args.path)
    if args.json:
        print(json.dumps({"summary": summary, "errors": errors}, ensure_ascii=False, indent=2))
        return 1 if errors else 0
    if errors:
        print(f"FAIL — {len(errors)} problem(s) in the og-fig-* pack:")
        for error in errors:
            print(f"  {error}")
        return 1
    print(
        f"OK — corpus v{summary['version']}: {summary['passages']} og-fig-* passages, "
        f"{summary['questions']} questions; genres={summary['genres']}; "
        f"levels={summary['levels']}; fifth items={summary['fifthItems']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
