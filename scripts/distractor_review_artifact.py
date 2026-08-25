#!/usr/bin/env python3
"""Stable semantic fingerprints for editorially reviewed distractor evidence.

The snapshot keeps an immutable hash of the authored question semantics a
reviewer saw. It also mirrors whether aligned ``distractorTags`` are currently
materialized so CI can fail closed for a bundled corpus stored in another
repository. It is not a second runtime corpus and never infers a label.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath


SNAPSHOT_ARTIFACT = "distractor-review-corpus-snapshot"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def question_fingerprint(passage: dict, question: dict) -> str:
    """Fingerprint every authored value that can change an option's meaning."""

    return canonical_sha256({
        "passageText": passage.get("text"),
        "skill": question.get("skill"),
        "stem": question.get("stem"),
        "choices": question.get("choices"),
        "answer": question.get("answer"),
        "explanation": question.get("explanation"),
    })


def semantic_sha256(entries: list[dict]) -> str:
    """Hash review semantics while deliberately excluding tag materialization state."""

    semantic_entries = [{
        key: value
        for key, value in entry.items()
        if key not in {"distractorTagsPresent", "distractorTags"}
    } for entry in entries]
    return canonical_sha256(semantic_entries)


def materialization_sha256(entries: list[dict]) -> str:
    """Bind the full compact artifact, including absent-versus-present tag state."""

    return canonical_sha256(entries)


def snapshot_questions(corpus: dict) -> tuple[list[dict], list[str]]:
    """Return the immutable review index for a schema-1 runtime corpus."""

    errors: list[str] = []
    if not isinstance(corpus, dict):
        return [], ["corpus root must be an object"]
    passages = corpus.get("passages")
    if corpus.get("schema") != 1 or not isinstance(corpus.get("version"), int):
        errors.append("corpus must use schema 1 and an integer version")
        return [], errors
    if isinstance(corpus.get("version"), bool):
        errors.append("corpus version must not be a boolean")
        return [], errors
    if not isinstance(passages, list):
        errors.append("corpus passages must be an array")
        return [], errors

    entries: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for passage_index, passage in enumerate(passages):
        if not isinstance(passage, dict) or not isinstance(passage.get("id"), str):
            errors.append(f"passage {passage_index}: stable string id required")
            continue
        passage_id = passage["id"]
        questions = passage.get("questions")
        if not isinstance(questions, list):
            errors.append(f"{passage_id}: questions must be an array")
            continue
        for question_index, question in enumerate(questions):
            where = f"{passage_id}/question {question_index}"
            if not isinstance(question, dict) or not isinstance(question.get("id"), str):
                errors.append(f"{where}: stable string id required")
                continue
            question_id = question["id"]
            key = (passage_id, question_id)
            if key in seen:
                errors.append(f"duplicate compound question id {passage_id}/{question_id}")
                continue
            seen.add(key)
            choices = question.get("choices")
            answer = question.get("answer")
            skill = question.get("skill")
            if not isinstance(choices, list) or not choices:
                errors.append(f"{passage_id}/{question_id}: choices must be non-empty")
                continue
            if (
                not isinstance(answer, int)
                or isinstance(answer, bool)
                or answer not in range(len(choices))
            ):
                errors.append(f"{passage_id}/{question_id}: answer is out of range")
                continue
            if not isinstance(skill, str) or not skill:
                errors.append(f"{passage_id}/{question_id}: skill must be nonblank")
                continue
            tags_present = "distractorTags" in question
            tags = question.get("distractorTags")
            if tags_present:
                if not isinstance(tags, list) or len(tags) != len(choices):
                    errors.append(
                        f"{passage_id}/{question_id}: materialized distractorTags "
                        "must align with choices"
                    )
                    continue
                if tags[answer] is not None:
                    errors.append(
                        f"{passage_id}/{question_id}: correct choice tag must be null"
                    )
                    continue
                if any(tag is not None and not isinstance(tag, str) for tag in tags):
                    errors.append(
                        f"{passage_id}/{question_id}: distractorTags values must be strings or null"
                    )
                    continue
            entries.append({
                "passageId": passage_id,
                "questionId": question_id,
                "questionFingerprint": question_fingerprint(passage, question),
                "skill": skill,
                "choiceCount": len(choices),
                "answer": answer,
                "distractorTagsPresent": tags_present,
                "distractorTags": list(tags) if tags_present else None,
            })
    entries.sort(key=lambda item: (item["passageId"], item["questionId"]))
    return entries, errors


def build_snapshot(
    corpus_path: Path,
    corpus: dict,
    *,
    source_commit: str,
    source_path: str,
) -> tuple[dict, list[str]]:
    entries, errors = snapshot_questions(corpus)
    if not GIT_COMMIT_RE.fullmatch(source_commit):
        errors.append("source commit must be a full lowercase 40-character Git hash")
    source_parts = PurePosixPath(source_path).parts
    if (
        not source_path
        or source_path.startswith("/")
        or source_path != source_path.strip()
        or "\\" in source_path
        or ".." in source_parts
    ):
        errors.append("source path must be a trimmed repository-relative path")
    if errors:
        return {}, errors
    return {
        "schema": 1,
        "artifact": SNAPSHOT_ARTIFACT,
        "corpusVersion": corpus["version"],
        "source": {
            "commit": source_commit,
            "path": source_path,
            "sha256": hashlib.sha256(corpus_path.read_bytes()).hexdigest(),
        },
        "semanticSHA256": semantic_sha256(entries),
        "materializationSHA256": materialization_sha256(entries),
        "questions": entries,
    }, []
