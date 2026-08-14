#!/usr/bin/env python3
"""Validate the 365-passage 2026 authoring pack before it enters OTA data.

The default invocation validates every content/year-of-readings-2026/batch-*.json
file and requires the complete fixed distribution. During authoring, pass one or
more batch paths with --allow-partial to run all per-passage checks without the
final 365-item distribution gate.
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
PACK_DIR = ROOT / "content" / "year-of-readings-2026"
DATA_PATH = ROOT / "data" / "passages.json"

GENRE_TARGETS = {
    "biography": 30,
    "economics": 30,
    "essay": 30,
    "fable": 30,
    "fiction": 31,
    "history": 31,
    "nature": 31,
    "nonfiction": 31,
    "philosophy": 30,
    "psychology": 30,
    "science": 31,
    "technology": 30,
}
GENRE_CYCLE = [
    "fiction",
    "history",
    "nature",
    "nonfiction",
    "science",
    "biography",
    "economics",
    "essay",
    "fable",
    "philosophy",
    "psychology",
    "technology",
]
LEVEL_TARGETS = {level: 73 for level in range(1, 6)}
WORD_BANDS = {
    1: (115, 145),
    2: (140, 175),
    3: (165, 200),
    4: (190, 225),
    5: (215, 255),
}
MAX_SENTENCE_WORDS = {1: 24, 2: 28, 3: 34, 4: 40, 5: 46}
SKILLS = ["main-idea", "inference", "vocabulary", "detail"]
SOURCE = "Written for Fluency"
ATTRIBUTION = "Original passage © Studio AM, written for Fluency."
RELEASED_AT = "2026-08-12"
ID_RE = re.compile(r"^og-y26-d(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*$")
PLACEHOLDER_RE = re.compile(r"\b(?:todo|tbd|placeholder|lorem ipsum|as an ai)\b", re.I)
WORD_RE = re.compile(r"[a-z0-9]+(?:[’'-][a-z0-9]+)*", re.I)
DISTRACTOR_REGISTRY, DISTRACTOR_REGISTRY_ERRORS = load_registry()


def compact(value: str) -> str:
    return " ".join(WORD_RE.findall(value.casefold()))


def ngrams(value: str, size: int = 5) -> set[tuple[str, ...]]:
    words = compact(value).split()
    return {tuple(words[i : i + size]) for i in range(len(words) - size + 1)}


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path, errors: list[str]):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{display_path(path)}: cannot read valid JSON: {exc}")
        return None


def validate_passage(
    p: object, origin: str, errors: list[str]
) -> tuple[int | None, int | None, int, int, int]:
    if not isinstance(p, dict):
        errors.append(f"{origin}: passage is not an object")
        return None, None, 0, 0, 0

    pid = p.get("id")
    tag = f"{origin}:{pid or '?'}"
    match = ID_RE.fullmatch(pid) if isinstance(pid, str) else None
    if not match:
        errors.append(f"{tag}: id must match {ID_RE.pattern}")
        day = None
    else:
        day = int(match.group(1))
        if not 1 <= day <= 365:
            errors.append(f"{tag}: day number {day} is outside 001..365")

    title = p.get("title")
    if not isinstance(title, str) or not 3 <= len(title.strip()) <= 80:
        errors.append(f"{tag}: title must be 3..80 characters")

    fixed = {
        "sourceType": "original",
        "source": SOURCE,
        "attribution": ATTRIBUTION,
        "releasedAt": RELEASED_AT,
    }
    for key, expected in fixed.items():
        if p.get(key) != expected:
            errors.append(f"{tag}: {key} must be {expected!r}")

    genre = p.get("genre")
    if genre not in GENRE_TARGETS:
        errors.append(f"{tag}: unsupported genre {genre!r}")
    elif day is not None:
        expected_genre = GENRE_CYCLE[(day - 1) % len(GENRE_CYCLE)]
        if genre != expected_genre:
            errors.append(f"{tag}: day {day:03d} genre must be {expected_genre!r}")

    level = p.get("level")
    if level not in WORD_BANDS:
        errors.append(f"{tag}: level must be an integer from 1 through 5")
        level = None
    elif day is not None:
        expected_level = ((day - 1) % 5) + 1
        if level != expected_level:
            errors.append(f"{tag}: day {day:03d} level must be {expected_level}")

    text = p.get("text")
    if not isinstance(text, str) or not text.strip():
        errors.append(f"{tag}: text must be non-empty")
        text = ""
    elif PLACEHOLDER_RE.search(text):
        errors.append(f"{tag}: text contains a placeholder phrase")

    words = text.strip().split()
    if p.get("wordCount") != len(words):
        errors.append(
            f"{tag}: wordCount {p.get('wordCount')!r} does not match whitespace count {len(words)}"
        )
    if level is not None:
        low, high = WORD_BANDS[level]
        if not low <= len(words) <= high:
            errors.append(f"{tag}: {len(words)} words is outside level-{level} band {low}..{high}")

    paragraphs = [x for x in re.split(r"\n\s*\n", text.strip()) if x.strip()]
    if not 2 <= len(paragraphs) <= 4:
        errors.append(f"{tag}: passage needs 2..4 paragraphs, found {len(paragraphs)}")

    sentences = [x.strip() for x in re.split(r"(?<=[.!?])[\"”’']*\s+", text.strip()) if x.strip()]
    if len(sentences) < 5:
        errors.append(f"{tag}: passage needs at least 5 sentences, found {len(sentences)}")
    if level is not None and sentences:
        longest = max(len(sentence.split()) for sentence in sentences)
        if longest > MAX_SENTENCE_WORDS[level]:
            errors.append(
                f"{tag}: longest sentence has {longest} words; level {level} maximum is "
                f"{MAX_SENTENCE_WORDS[level]}"
            )

    questions = p.get("questions")
    tagged_distractors = 0
    total_distractors = 0
    authored_tag_questions = 0
    if not isinstance(questions, list) or len(questions) != 4:
        errors.append(f"{tag}: questions must contain exactly four items")
        questions = questions if isinstance(questions, list) else []
    for index, q in enumerate(questions):
        qtag = f"{tag}:q{index + 1}"
        if not isinstance(q, dict):
            errors.append(f"{qtag}: question is not an object")
            continue
        if q.get("id") != f"q{index + 1}":
            errors.append(f"{qtag}: id must be q{index + 1}")
        if index < len(SKILLS) and q.get("skill") != SKILLS[index]:
            errors.append(f"{qtag}: skill must be {SKILLS[index]!r}")
        stem = q.get("stem")
        if not isinstance(stem, str) or not 12 <= len(stem.strip()) <= 180:
            errors.append(f"{qtag}: stem must be 12..180 characters")
        elif PLACEHOLDER_RE.search(stem):
            errors.append(f"{qtag}: stem contains a placeholder phrase")
        choices = q.get("choices")
        if not isinstance(choices, list) or len(choices) != 4:
            errors.append(f"{qtag}: choices must contain exactly four items")
            choices = choices if isinstance(choices, list) else []
        elif any(not isinstance(choice, str) or not choice.strip() for choice in choices):
            errors.append(f"{qtag}: every choice must be a non-empty string")
        elif len({compact(choice) for choice in choices}) != 4:
            errors.append(f"{qtag}: choices must be distinct")
        elif any(len(choice) > 180 for choice in choices):
            errors.append(f"{qtag}: a choice exceeds 180 characters")
        expected_answer = ((day - 1 + index) % 4) if day is not None else None
        if q.get("answer") != expected_answer:
            errors.append(f"{qtag}: answer must be {expected_answer}, found {q.get('answer')!r}")
        tag_issues, coverage = validate_question_tags(q, DISTRACTOR_REGISTRY)
        total_distractors += coverage.distractor_slots
        tagged_distractors += coverage.tagged_slots
        authored_tag_questions += int(coverage.authored)
        for _code, message in tag_issues:
            errors.append(f"{qtag}: {message}")
        if index == 0 and expected_answer is not None and len(choices) == 4:
            gist = choices[expected_answer]
            if isinstance(gist, str) and (
                len(gist.strip()) < 30 or len(re.findall(r"[.!?](?:\s|$)", gist.strip())) > 1
            ):
                errors.append(f"{qtag}: correct main-idea choice must be a self-contained one-sentence gist")
        explanation = q.get("explanation")
        if not isinstance(explanation, str) or not 25 <= len(explanation.strip()) <= 400:
            errors.append(f"{qtag}: explanation must be 25..400 characters")
        elif PLACEHOLDER_RE.search(explanation):
            errors.append(f"{qtag}: explanation contains a placeholder phrase")

    lesson = p.get("lesson")
    if not isinstance(lesson, dict):
        errors.append(f"{tag}: lesson must be an object")
        lesson = {}
    strategy = lesson.get("strategy")
    if not isinstance(strategy, str) or not 80 <= len(strategy.strip()) <= 320:
        errors.append(f"{tag}: lesson.strategy must be 80..320 characters")

    signals = lesson.get("signals")
    if not isinstance(signals, list) or len(signals) != 3:
        errors.append(f"{tag}: lesson.signals must contain exactly three items")
        signals = signals if isinstance(signals, list) else []
    seen_signals: set[str] = set()
    text_compact = compact(text)
    for index, signal in enumerate(signals):
        stag = f"{tag}:signal{index + 1}"
        if not isinstance(signal, dict):
            errors.append(f"{stag}: signal is not an object")
            continue
        phrase = signal.get("phrase")
        means = signal.get("means")
        if not isinstance(phrase, str) or not 3 <= len(phrase.strip()) <= 60:
            errors.append(f"{stag}: phrase must be 3..60 characters")
        else:
            needle = compact(phrase)
            if not needle or phrase.casefold() not in text.casefold():
                errors.append(f"{stag}: phrase is not verbatim in the passage")
            if needle in seen_signals:
                errors.append(f"{stag}: signal phrase is duplicated")
            seen_signals.add(needle)
        if not isinstance(means, str) or not 15 <= len(means.strip()) <= 120:
            errors.append(f"{stag}: means must be 15..120 characters")

    vocab = lesson.get("vocab")
    if not isinstance(vocab, list) or len(vocab) != 3:
        errors.append(f"{tag}: lesson.vocab must contain exactly three items")
        vocab = vocab if isinstance(vocab, list) else []
    seen_vocab: set[str] = set()
    for index, item in enumerate(vocab):
        vtag = f"{tag}:vocab{index + 1}"
        if not isinstance(item, dict):
            errors.append(f"{vtag}: vocabulary item is not an object")
            continue
        word = item.get("word")
        context = item.get("inContext")
        if not isinstance(word, str) or not 2 <= len(word.strip()) <= 40:
            errors.append(f"{vtag}: word must be 2..40 characters")
        else:
            needle = compact(word)
            if not needle or needle not in text_compact:
                errors.append(f"{vtag}: word is not verbatim in the passage")
            if needle in seen_vocab:
                errors.append(f"{vtag}: vocabulary word is duplicated")
            seen_vocab.add(needle)
        if not isinstance(context, str) or not 10 <= len(context.strip()) <= 100:
            errors.append(f"{vtag}: inContext must be 10..100 characters")

    tips = lesson.get("skillTips")
    if not isinstance(tips, dict):
        errors.append(f"{tag}: lesson.skillTips must be an object")
        tips = {}
    if set(tips) != set(SKILLS):
        errors.append(f"{tag}: skillTips keys must be exactly {SKILLS}")
    for skill in SKILLS:
        tip = tips.get(skill)
        if not isinstance(tip, str) or not 40 <= len(tip.strip()) <= 200:
            errors.append(f"{tag}: skillTips[{skill!r}] must be 40..200 characters")

    serialized = json.dumps(p, ensure_ascii=False)
    if PLACEHOLDER_RE.search(serialized):
        errors.append(f"{tag}: passage contains placeholder language")

    return day, level, tagged_distractors, total_distractors, authored_tag_questions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*", type=Path, help="batch JSON paths (default: every batch)")
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="skip the final 365-item and distribution requirements",
    )
    parser.add_argument(
        "--include-existing-batches",
        action="store_true",
        help="when validating explicit paths, also use other pack batches for cross-batch duplicate checks",
    )
    args = parser.parse_args()

    errors: list[str] = [
        f"distractor taxonomy: {message}" for message in DISTRACTOR_REGISTRY_ERRORS
    ]
    paths = args.paths or sorted(PACK_DIR.glob("batch-*.json"))
    paths = [path if path.is_absolute() else ROOT / path for path in paths]
    # A full run must not silently accept abandoned/overlapping draft batches.
    # Partial authoring may target explicit temp paths, but the publish gate only
    # accepts the documented batch naming convention.
    if not args.paths:
        unexpected = sorted(
            path for path in PACK_DIR.glob("batch-*.json")
            if not re.fullmatch(r"batch-\d+[a-z]?\.json", path.name)
        )
        for path in unexpected:
            errors.append(f"unexpected batch filename: {display_path(path)}")
    if not paths:
        errors.append("no batch-*.json files found")

    base_doc = load_json(DATA_PATH, errors)
    all_base = base_doc.get("passages", []) if isinstance(base_doc, dict) else []
    # The publish workflow may validate again after merge. Exclude this pack's
    # own IDs from the collision baseline so an idempotent v12 candidate does
    # not compare every authored item with itself; all non-pack corpus entries
    # remain reserved.
    base = [
        p for p in all_base
        if not (
            isinstance(p, dict)
            and isinstance(p.get("id"), str)
            and ID_RE.fullmatch(p["id"])
        )
    ]
    base_ids = {p.get("id") for p in base if isinstance(p, dict)}
    base_titles = {compact(p.get("title", "")) for p in base if isinstance(p, dict)}
    comparison_ids = set(base_ids)
    comparison_titles = set(base_titles)

    passages: list[dict] = []
    origins: list[str] = []
    for path in paths:
        doc = load_json(path, errors)
        if doc is None:
            continue
        batch = doc.get("passages") if isinstance(doc, dict) else None
        if not isinstance(batch, list):
            errors.append(f"{display_path(path)}: top level must contain a passages array")
            continue
        for p in batch:
            passages.append(p)
            origins.append(display_path(path))

    comparison_passages = list(base)
    if args.include_existing_batches and args.paths:
        selected = {path.resolve() for path in paths}
        for other_path in sorted(PACK_DIR.glob("batch-*.json")):
            if other_path.resolve() in selected:
                continue
            other_doc = load_json(other_path, errors)
            other_batch = other_doc.get("passages") if isinstance(other_doc, dict) else None
            if isinstance(other_batch, list):
                for other in other_batch:
                    if not isinstance(other, dict):
                        continue
                    comparison_passages.append(other)
                    comparison_ids.add(other.get("id"))
                    comparison_titles.add(compact(other.get("title", "")))

    days: list[int] = []
    ids: list[str] = []
    titles: list[str] = []
    levels: collections.Counter[int] = collections.Counter()
    genres: collections.Counter[str] = collections.Counter()
    cells: collections.Counter[tuple[int, str]] = collections.Counter()
    tagged_distractors = 0
    total_distractors = 0
    authored_tag_questions = 0

    for p, origin in zip(passages, origins):
        day, level, tagged, distractors, authored = validate_passage(p, origin, errors)
        tagged_distractors += tagged
        total_distractors += distractors
        authored_tag_questions += authored
        if day is not None:
            days.append(day)
        if isinstance(p, dict):
            pid = p.get("id")
            title = compact(p.get("title", ""))
            if isinstance(pid, str):
                ids.append(pid)
                if pid in comparison_ids:
                    errors.append(f"{origin}:{pid}: id collides with the existing corpus or another batch")
            if title:
                titles.append(title)
                if title in comparison_titles:
                    errors.append(f"{origin}:{pid or '?'}: title collides with the existing corpus or another batch")
            genre = p.get("genre")
            if level in LEVEL_TARGETS:
                levels[level] += 1
            if genre in GENRE_TARGETS:
                genres[genre] += 1
            if level in LEVEL_TARGETS and genre in GENRE_TARGETS:
                cells[(level, genre)] += 1

    for label, values in (("id", ids), ("title", titles), ("day", days)):
        repeated = sorted(value for value, count in collections.Counter(values).items() if count > 1)
        for value in repeated:
            errors.append(f"duplicate {label}: {value}")

    # Catch accidental rewrites or template copies. Five-word shingles make
    # this insensitive to punctuation while avoiding topic-level false matches.
    seen_texts: list[tuple[str, set[tuple[str, ...]]]] = []
    for p in comparison_passages:
        if isinstance(p, dict) and isinstance(p.get("text"), str):
            seen_texts.append((p.get("id", "v11:?"), ngrams(p["text"])))
    for p in passages:
        if not isinstance(p, dict) or not isinstance(p.get("text"), str):
            continue
        pid = p.get("id", "?")
        grams = ngrams(p["text"])
        for other_id, other in seen_texts:
            if not grams or not other:
                continue
            overlap = len(grams & other) / len(grams | other)
            if overlap >= 0.35:
                errors.append(f"{pid}: text is too similar to {other_id} (5-gram Jaccard {overlap:.2f})")
        seen_texts.append((pid, grams))

    # Lightweight template-language detector. Repeated lesson/question wording
    # across a large generated pack is a quality defect even when the passages
    # themselves differ. Exact normalized strings should be passage-specific.
    repeated_fields: collections.defaultdict[tuple[str, str], list[str]] = collections.defaultdict(list)
    for p in passages:
        if not isinstance(p, dict):
            continue
        pid = p.get("id", "?")
        lesson = p.get("lesson") if isinstance(p.get("lesson"), dict) else {}
        for key in ("strategy",):
            value = lesson.get(key)
            if isinstance(value, str):
                repeated_fields[(f"lesson.{key}", compact(value))].append(pid)
        tips = lesson.get("skillTips") if isinstance(lesson.get("skillTips"), dict) else {}
        for skill, value in tips.items():
            if isinstance(value, str):
                repeated_fields[(f"lesson.skillTips.{skill}", compact(value))].append(pid)
        for q in p.get("questions", []) if isinstance(p.get("questions"), list) else []:
            if not isinstance(q, dict):
                continue
            # Generic stems such as "What is the main idea?" are intentional;
            # explanations, unlike stems, must be passage-specific.
            for key in ("explanation",):
                value = q.get(key)
                if isinstance(value, str):
                    repeated_fields[(f"question.{key}", compact(value))].append(pid)
    for (field, value), pids in repeated_fields.items():
        if value and len(pids) > 1:
            errors.append(f"repeated {field} language across passages {pids}")

    if not args.allow_partial:
        if len(passages) != 365:
            errors.append(f"complete pack must contain 365 passages, found {len(passages)}")
        if set(days) != set(range(1, 366)):
            missing = sorted(set(range(1, 366)) - set(days))
            extra = sorted(set(days) - set(range(1, 366)))
            errors.append(f"day sequence must be exactly 001..365; missing={missing}, extra={extra}")
        if dict(levels) != LEVEL_TARGETS:
            errors.append(f"level counts must be {LEVEL_TARGETS}, found {dict(sorted(levels.items()))}")
        if dict(genres) != GENRE_TARGETS:
            errors.append(f"genre counts must be {GENRE_TARGETS}, found {dict(sorted(genres.items()))}")
        bad_cells = {cell: count for cell, count in cells.items() if count not in (6, 7)}
        missing_cells = [
            (level, genre)
            for level in LEVEL_TARGETS
            for genre in GENRE_TARGETS
            if (level, genre) not in cells
        ]
        if bad_cells or missing_cells:
            errors.append(f"every level/genre cell must contain 6 or 7 passages; bad={bad_cells}, missing={missing_cells}")

    if errors:
        print(f"FAIL — {len(errors)} problem(s) across {len(passages)} proposed passages:")
        for error in errors:
            print(f"  {error}")
        return 1

    print(
        f"OK — {len(passages)} proposed passages; "
        f"levels={dict(sorted(levels.items()))}; genres={dict(sorted(genres.items()))}; "
        f"distractor evidence={tagged_distractors}/{total_distractors} slots across "
        f"{authored_tag_questions}/{len(passages) * 4} questions with optional tag arrays"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
