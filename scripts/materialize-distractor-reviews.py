#!/usr/bin/env python3
"""Materialize only editorially reviewed distractor semantics into runtime corpora.

The review sidecar is authoritative. It records a fingerprint of the passage
and question semantics plus a rationale for every non-null tag. This script
never guesses from skill, answer position, or option text. A changed passage,
stem, choice, answer, or explanation invalidates the old review and fails
closed until an editor reviews that exact variant again.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from distractor_review_artifact import (
    GIT_COMMIT_RE,
    SHA256_RE,
    SNAPSHOT_ARTIFACT,
    materialization_sha256 as compute_materialization_sha256,
    question_fingerprint,
    semantic_sha256 as compute_semantic_sha256,
    snapshot_questions,
)
from distractor_taxonomy import ReviewedTag, load_registry


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CORPUS = ROOT / "data" / "passages.json"
DEFAULT_SNAPSHOT = (
    ROOT / "content" / "corpus-snapshots" / "bundled-v11-question-semantics.json"
)
DEFAULT_REVIEWS = ROOT / "content" / "distractor-reviews-v1.json"


@dataclass(frozen=True)
class CorpusDocument:
    path: Path
    version: int
    document: dict
    semantic_sha256: str


@dataclass(frozen=True)
class QuestionLocation:
    artifact_path: Path
    corpus_version: int
    passage_id: str
    question_id: str
    fingerprint: str
    skill: str
    choice_count: int
    answer: int
    is_runtime: bool
    question: dict | None
    has_tags: bool
    current_tags: list[str | None] | None


def load_json(path: Path, label: str, errors: list[str]) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{label}: cannot read valid JSON from {path}: {exc}")
        return None


def index_corpora(
    paths: list[Path], errors: list[str]
) -> tuple[dict[Path, CorpusDocument], dict[tuple[int, str, str], QuestionLocation]]:
    documents: dict[Path, CorpusDocument] = {}
    questions: dict[tuple[int, str, str], QuestionLocation] = {}
    seen_versions: set[int] = set()
    for path in paths:
        path = path.resolve()
        raw = load_json(path, "corpus", errors)
        if not isinstance(raw, dict):
            if raw is not None:
                errors.append(f"corpus {path}: root must be an object")
            continue
        version = raw.get("version")
        passages = raw.get("passages")
        if raw.get("schema") != 1 or not isinstance(version, int) or isinstance(version, bool):
            errors.append(f"corpus {path}: expected schema 1 and an integer version")
            continue
        if version in seen_versions:
            errors.append(
                f"corpus version {version}: pass at most one artifact for each version"
            )
            continue
        seen_versions.add(version)
        if not isinstance(passages, list):
            errors.append(f"corpus {path}: passages must be an array")
            continue
        entries, snapshot_errors = snapshot_questions(raw)
        if snapshot_errors:
            errors.extend(f"corpus {path}: {message}" for message in snapshot_errors)
            continue
        corpus_semantic_sha256 = compute_semantic_sha256(entries)
        documents[path] = CorpusDocument(
            path=path,
            version=version,
            document=raw,
            semantic_sha256=corpus_semantic_sha256,
        )
        for passage in passages:
            # snapshot_questions already validated this structure.
            assert isinstance(passage, dict) and isinstance(passage.get("id"), str)
            items = passage.get("questions")
            assert isinstance(items, list)
            for question in items:
                assert isinstance(question, dict) and isinstance(question.get("id"), str)
                key = (version, passage["id"], question["id"])
                if key in questions:
                    errors.append(
                        f"corpus v{version}: duplicate compound question id "
                        f"{passage['id']}/{question['id']}"
                    )
                    continue
                choices = question["choices"]
                questions[key] = QuestionLocation(
                    artifact_path=path,
                    corpus_version=version,
                    passage_id=passage["id"],
                    question_id=question["id"],
                    fingerprint=question_fingerprint(passage, question),
                    skill=question["skill"],
                    choice_count=len(choices),
                    answer=question["answer"],
                    is_runtime=True,
                    question=question,
                    has_tags="distractorTags" in question,
                    current_tags=(
                        list(question["distractorTags"])
                        if "distractorTags" in question
                        else None
                    ),
                )
    return documents, questions


def index_snapshots(
    paths: list[Path],
    documents: dict[Path, CorpusDocument],
    questions: dict[tuple[int, str, str], QuestionLocation],
    errors: list[str],
) -> None:
    """Add provenance-only snapshots and cross-check matching runtime corpora."""

    runtime_by_version = {document.version: document for document in documents.values()}
    seen_versions: set[int] = set()
    for path in paths:
        path = path.resolve()
        raw = load_json(path, "corpus snapshot", errors)
        if not isinstance(raw, dict):
            if raw is not None:
                errors.append(f"corpus snapshot {path}: root must be an object")
            continue
        expected_root = {
            "schema", "artifact", "corpusVersion", "source", "semanticSHA256",
            "materializationSHA256", "questions",
        }
        if set(raw) != expected_root:
            errors.append(
                f"corpus snapshot {path}: fields must be exactly {sorted(expected_root)}"
            )
            continue
        version = raw.get("corpusVersion")
        source = raw.get("source")
        semantic_sha256 = raw.get("semanticSHA256")
        materialization_sha256 = raw.get("materializationSHA256")
        entries = raw.get("questions")
        if raw.get("schema") != 1 or raw.get("artifact") != SNAPSHOT_ARTIFACT:
            errors.append(f"corpus snapshot {path}: unsupported schema or artifact kind")
            continue
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            errors.append(f"corpus snapshot {path}: corpusVersion must be positive")
            continue
        if version in seen_versions:
            errors.append(f"corpus snapshot v{version}: pass at most one snapshot per version")
            continue
        seen_versions.add(version)
        if (
            not isinstance(source, dict)
            or set(source) != {"commit", "path", "sha256"}
            or not isinstance(source.get("commit"), str)
            or not GIT_COMMIT_RE.fullmatch(source["commit"])
            or not isinstance(source.get("path"), str)
            or not source["path"]
            or source["path"].startswith("/")
            or source["path"] != source["path"].strip()
            or "\\" in source["path"]
            or ".." in PurePosixPath(source["path"]).parts
            or not isinstance(source.get("sha256"), str)
            or not SHA256_RE.fullmatch(source["sha256"])
        ):
            errors.append(f"corpus snapshot {path}: malformed pinned source provenance")
            continue
        if not isinstance(semantic_sha256, str) or not SHA256_RE.fullmatch(semantic_sha256):
            errors.append(f"corpus snapshot {path}: semanticSHA256 must be lowercase SHA-256")
            continue
        if (
            not isinstance(materialization_sha256, str)
            or not SHA256_RE.fullmatch(materialization_sha256)
        ):
            errors.append(
                f"corpus snapshot {path}: materializationSHA256 must be lowercase SHA-256"
            )
            continue
        if not isinstance(entries, list):
            errors.append(f"corpus snapshot {path}: questions must be an array")
            continue
        if compute_semantic_sha256(entries) != semantic_sha256:
            errors.append(f"corpus snapshot {path}: semanticSHA256 does not match questions")
            continue
        if compute_materialization_sha256(entries) != materialization_sha256:
            errors.append(
                f"corpus snapshot {path}: materializationSHA256 does not match questions"
            )
            continue

        snapshot_locations: dict[tuple[int, str, str], QuestionLocation] = {}
        for index, entry in enumerate(entries):
            where = f"corpus snapshot {path} question {index}"
            expected_fields = {
                "passageId", "questionId", "questionFingerprint", "skill", "choiceCount", "answer",
                "distractorTagsPresent", "distractorTags",
            }
            if not isinstance(entry, dict) or set(entry) != expected_fields:
                errors.append(f"{where}: fields must be exactly {sorted(expected_fields)}")
                continue
            passage_id = entry.get("passageId")
            question_id = entry.get("questionId")
            fingerprint = entry.get("questionFingerprint")
            skill = entry.get("skill")
            choice_count = entry.get("choiceCount")
            answer = entry.get("answer")
            tags_present = entry.get("distractorTagsPresent")
            current_tags = entry.get("distractorTags")
            if not isinstance(passage_id, str) or not passage_id:
                errors.append(f"{where}: passageId must be nonblank")
                continue
            if not isinstance(question_id, str) or not question_id:
                errors.append(f"{where}: questionId must be nonblank")
                continue
            if not isinstance(fingerprint, str) or not SHA256_RE.fullmatch(fingerprint):
                errors.append(f"{where}: questionFingerprint must be lowercase SHA-256")
                continue
            if not isinstance(skill, str) or not skill:
                errors.append(f"{where}: skill must be nonblank")
                continue
            if (
                not isinstance(choice_count, int)
                or isinstance(choice_count, bool)
                or choice_count < 2
            ):
                errors.append(f"{where}: choiceCount must be an integer of at least 2")
                continue
            if (
                not isinstance(answer, int)
                or isinstance(answer, bool)
                or answer not in range(choice_count)
            ):
                errors.append(f"{where}: answer is out of range")
                continue
            if not isinstance(tags_present, bool):
                errors.append(f"{where}: distractorTagsPresent must be boolean")
                continue
            if not tags_present and current_tags is not None:
                errors.append(f"{where}: absent distractorTags must be represented by null")
                continue
            if tags_present and (
                not isinstance(current_tags, list)
                or len(current_tags) != choice_count
                or current_tags[answer] is not None
                or any(tag is not None and not isinstance(tag, str) for tag in current_tags)
            ):
                errors.append(f"{where}: materialized distractorTags state is malformed")
                continue
            key = (version, passage_id, question_id)
            if key in snapshot_locations:
                errors.append(
                    f"corpus snapshot v{version}: duplicate compound question id "
                    f"{passage_id}/{question_id}"
                )
                continue
            snapshot_locations[key] = QuestionLocation(
                artifact_path=path,
                corpus_version=version,
                passage_id=passage_id,
                question_id=question_id,
                fingerprint=fingerprint,
                skill=skill,
                choice_count=choice_count,
                answer=answer,
                is_runtime=False,
                question=None,
                has_tags=tags_present,
                current_tags=(list(current_tags) if tags_present else None),
            )

        runtime = runtime_by_version.get(version)
        if runtime is not None:
            if runtime.semantic_sha256 != semantic_sha256:
                errors.append(
                    f"corpus snapshot {path}: v{version} semantics differ from runtime "
                    f"{runtime.path}; create a new corpus version and review snapshot"
                )
            runtime_keys = {
                key for key in questions if key[0] == version and questions[key].is_runtime
            }
            if runtime_keys != set(snapshot_locations):
                errors.append(
                    f"corpus snapshot {path}: v{version} compound question set differs "
                    f"from runtime {runtime.path}"
                )
            for key in runtime_keys & set(snapshot_locations):
                runtime_location = questions[key]
                snapshot_location = snapshot_locations[key]
                if (
                    runtime_location.has_tags != snapshot_location.has_tags
                    or runtime_location.current_tags != snapshot_location.current_tags
                ):
                    errors.append(
                        f"corpus snapshot {path}: materialized distractorTags differ "
                        f"from runtime {runtime.path} at v{key[0]}/{key[1]}/{key[2]}"
                    )
            continue

        for key, location in snapshot_locations.items():
            if key in questions:
                errors.append(
                    f"corpus snapshot {path}: duplicate artifact for "
                    f"v{key[0]}/{key[1]}/{key[2]}"
                )
                continue
            questions[key] = location


def validate_reviews(
    path: Path,
    registry: dict[str, ReviewedTag],
    questions: dict[tuple[int, str, str], QuestionLocation],
    errors: list[str],
) -> tuple[dict[tuple[int, str, str], list[str | None]], set[tuple[int, str, str]], int, int]:
    """Resolve reviews against every supplied artifact by question fingerprint.

    A review binds to the exact semantics the reviewer saw, so a corpus version
    bump that leaves a question untouched carries the review forward instead of
    orphaning it. ``corpusVersion`` records the corpus that first materialized
    the review: artifacts at or above it must carry the tags (returned in the
    enforced set), while an older pinned artifact, such as a bundled snapshot,
    legitimately predates the review and may stay untagged.

    Returns (expected tags by artifact question key, enforced keys,
    validated review count, tagged slot count).
    """

    raw = load_json(path, "review source", errors)
    if not isinstance(raw, dict):
        if raw is not None:
            errors.append("review source root must be an object")
        return {}, set(), 0, 0
    if raw.get("schema") != 1 or raw.get("taxonomyVersion") != 1:
        errors.append("review source schema and taxonomyVersion must both be integer 1")
    reviews = raw.get("reviews")
    if not isinstance(reviews, list):
        errors.append("review source reviews must be an array")
        return {}, set(), 0, 0

    by_compound_id: dict[tuple[str, str], list[QuestionLocation]] = {}
    for location in questions.values():
        by_compound_id.setdefault(
            (location.passage_id, location.question_id), []
        ).append(location)

    result: dict[tuple[int, str, str], list[str | None]] = {}
    enforced: set[tuple[int, str, str]] = set()
    seen_variants: set[tuple[str, str, str]] = set()
    reviewed_variants = 0
    reviewed_slots = 0
    for index, review in enumerate(reviews):
        where = f"review {index}"
        if not isinstance(review, dict):
            errors.append(f"{where}: must be an object")
            continue
        expected_fields = {
            "corpusVersion", "passageId", "questionId", "questionFingerprint", "options"
        }
        if set(review) != expected_fields:
            errors.append(
                f"{where}: fields must be exactly {sorted(expected_fields)}; "
                f"found {sorted(review)}"
            )
            continue
        version = review.get("corpusVersion")
        passage_id = review.get("passageId")
        question_id = review.get("questionId")
        fingerprint = review.get("questionFingerprint")
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            errors.append(f"{where}: corpusVersion must be a positive integer")
            continue
        if not isinstance(passage_id, str) or not passage_id.strip():
            errors.append(f"{where}: passageId must be a nonblank stable id")
            continue
        if not isinstance(question_id, str) or not question_id.strip():
            errors.append(f"{where}: questionId must be a nonblank stable id")
            continue
        if not isinstance(fingerprint, str) or not SHA256_RE.fullmatch(fingerprint):
            errors.append(f"{where}: questionFingerprint must be a lowercase SHA-256")
            continue
        variant = (passage_id, question_id, fingerprint)
        if variant in seen_variants:
            errors.append(
                f"{where}: duplicate review for {passage_id}/{question_id} "
                f"variant {fingerprint}"
            )
            continue
        seen_variants.add(variant)
        candidates = by_compound_id.get((passage_id, question_id), [])
        if not candidates:
            errors.append(
                f"{where}: no supplied artifact contains {passage_id}/{question_id}; "
                "restore that content or delete the stale review"
            )
            continue
        matches = [
            candidate for candidate in candidates
            if candidate.fingerprint == fingerprint
        ]
        if not matches:
            errors.append(
                f"{where}: authored content changed; no supplied artifact still "
                f"carries the reviewed variant of {passage_id}/{question_id}. "
                "Re-review this exact variant."
            )
            continue
        if all(match.corpus_version < version for match in matches):
            newest = max(match.corpus_version for match in matches)
            errors.append(
                f"{where}: corpusVersion {version} is newer than every supplied "
                f"artifact carrying this exact variant (newest is v{newest}); "
                "correct the review's corpusVersion or re-review the changed question"
            )
            continue
        # The fingerprint pins skill, choices, and answer, so every match
        # shares the option geometry the reviewer saw.
        location = matches[0]

        options = review.get("options")
        if not isinstance(options, list) or len(options) != location.choice_count:
            errors.append(
                f"{where}: options must align with all {location.choice_count} choice positions"
            )
            continue
        if options[location.answer] is not None:
            errors.append(f"{where}: the correct choice review must be null")
            continue

        tags: list[str | None] = []
        option_failed = False
        for choice_index, option in enumerate(options):
            option_where = f"{where} choice {choice_index}"
            if option is None:
                tags.append(None)
                continue
            if not isinstance(option, dict) or set(option) != {"tag", "rationale"}:
                errors.append(
                    f"{option_where}: use null or exactly {{tag, rationale}}"
                )
                option_failed = True
                tags.append(None)
                continue
            tag_id = option.get("tag")
            rationale = option.get("rationale")
            reviewed = registry.get(tag_id) if isinstance(tag_id, str) else None
            if reviewed is None:
                errors.append(f"{option_where}: tag must be a reviewed taxonomy id")
                option_failed = True
            elif reviewed.skill != location.skill:
                errors.append(
                    f"{option_where}: {tag_id!r} is reviewed for {reviewed.skill!r}, "
                    f"not {location.skill!r}"
                )
                option_failed = True
            if (
                not isinstance(rationale, str)
                or rationale != rationale.strip()
                or len(rationale) < 15
            ):
                errors.append(
                    f"{option_where}: rationale must be a trimmed, specific explanation "
                    "of at least 15 characters"
                )
                option_failed = True
            tags.append(tag_id if reviewed is not None else None)
        if not option_failed:
            reviewed_variants += 1
            reviewed_slots += sum(tag is not None for tag in tags)
            for match in matches:
                match_key = (match.corpus_version, match.passage_id, match.question_id)
                result[match_key] = tags
                if match.corpus_version >= version:
                    enforced.add(match_key)
    return result, enforced, reviewed_variants, reviewed_slots


def scaffold(
    selector: str,
    questions: dict[tuple[int, str, str], QuestionLocation],
) -> int:
    parts = selector.split(":", 2)
    if len(parts) != 3 or not parts[0].isdigit():
        print("--scaffold must be VERSION:PASSAGE_ID:QUESTION_ID", file=sys.stderr)
        return 2
    key = (int(parts[0]), parts[1], parts[2])
    location = questions.get(key)
    if location is None:
        print(f"No supplied corpus contains v{parts[0]}/{parts[1]}/{parts[2]}", file=sys.stderr)
        return 1
    record = {
        "corpusVersion": location.corpus_version,
        "passageId": location.passage_id,
        "questionId": location.question_id,
        "questionFingerprint": location.fingerprint,
        "options": [None for _choice in range(location.choice_count)],
    }
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--corpus",
        action="append",
        type=Path,
        help="runtime schema-1 corpus to check (repeatable)",
    )
    parser.add_argument(
        "--snapshot",
        action="append",
        type=Path,
        help="immutable review-provenance snapshot to check (repeatable)",
    )
    parser.add_argument("--reviews", type=Path, default=DEFAULT_REVIEWS)
    parser.add_argument(
        "--write-target",
        type=Path,
        help=(
            "materialize reviewed tags only into this explicitly supplied runtime corpus; "
            "all other artifacts remain read-only"
        ),
    )
    parser.add_argument(
        "--scaffold",
        metavar="VERSION:PASSAGE_ID:QUESTION_ID",
        help="print a fingerprinted all-null review record for an editor to complete",
    )
    args = parser.parse_args()
    if args.corpus is None and args.snapshot is None:
        corpus_paths = [DEFAULT_CORPUS]
        snapshot_paths = [DEFAULT_SNAPSHOT]
    else:
        corpus_paths = args.corpus or []
        snapshot_paths = args.snapshot or []
    corpus_paths = [
        (path if path.is_absolute() else Path.cwd() / path).resolve()
        for path in corpus_paths
    ]
    snapshot_paths = [
        (path if path.is_absolute() else Path.cwd() / path).resolve()
        for path in snapshot_paths
    ]
    reviews_path = args.reviews if args.reviews.is_absolute() else Path.cwd() / args.reviews
    reviews_path = reviews_path.resolve()
    write_target = None
    if args.write_target is not None:
        write_target = (
            args.write_target
            if args.write_target.is_absolute()
            else Path.cwd() / args.write_target
        ).resolve()

    errors: list[str] = []
    registry, taxonomy_errors = load_registry()
    errors.extend(f"taxonomy: {message}" for message in taxonomy_errors)
    documents, questions = index_corpora(corpus_paths, errors)
    index_snapshots(snapshot_paths, documents, questions, errors)
    if args.scaffold:
        if errors:
            for error in errors:
                print(error, file=sys.stderr)
            return 1
        return scaffold(args.scaffold, questions)

    expected, enforced, reviewed_variants, reviewed_slots = validate_reviews(
        reviews_path, registry, questions, errors
    )
    if write_target is not None and write_target not in documents:
        errors.append(
            "--write-target must exactly identify one runtime corpus supplied with --corpus"
        )

    changed_questions = 0
    for key, location in questions.items():
        expected_tags = expected.get(key)
        if expected_tags is None:
            if location.has_tags:
                errors.append(
                    f"v{key[0]}/{key[1]}/{key[2]}: distractorTags are not backed by "
                    "a fingerprinted editorial review; refusing to erase or trust them"
                )
            continue
        if not location.has_tags and key not in enforced:
            # The review first materialized at a later corpus version; this
            # older pinned artifact legitimately predates it and stays untagged.
            continue
        if location.current_tags != expected_tags or not location.has_tags:
            if location.is_runtime and write_target == location.artifact_path:
                assert location.question is not None
                location.question["distractorTags"] = expected_tags
                changed_questions += 1
            elif not location.is_runtime:
                errors.append(
                    f"v{key[0]}/{key[1]}/{key[2]}: bundled materialization snapshot "
                    "differs from the reviewed source; materialize the pinned runtime "
                    "corpus, commit it, and refresh the compact snapshot"
                )
            else:
                errors.append(
                    f"v{key[0]}/{key[1]}/{key[2]}: materialized distractorTags differ "
                    "from the reviewed source; use --write-target for that exact runtime "
                    "corpus and review the diff"
                )

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    if write_target is not None and changed_questions:
        document = documents[write_target]
        write_target.write_text(
            json.dumps(document.document, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(
        f"Distractor reviews OK: {reviewed_variants} reviewed question variants, "
        f"{reviewed_slots} tagged slots, {changed_questions} materialized changes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
