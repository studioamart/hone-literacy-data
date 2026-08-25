#!/usr/bin/env python3
"""Reviewed distractor taxonomy and position-alignment validation.

This module never infers a tag from skill, answer position, or choice text. It
only validates optional labels supplied by a content reviewer. A nil distractor
is valid and means "no defensible reviewed category yet."
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TAXONOMY = ROOT / "content" / "distractor-taxonomy-v1.json"
TAG_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKILLS = {"main-idea", "inference", "vocabulary", "detail"}


@dataclass(frozen=True)
class ReviewedTag:
    id: str
    skill: str


@dataclass(frozen=True)
class TagCoverage:
    authored: bool
    tagged_slots: int
    distractor_slots: int


def load_registry(path: Path = DEFAULT_TAXONOMY) -> tuple[dict[str, ReviewedTag], list[str]]:
    errors: list[str] = []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {}, [f"cannot read taxonomy {path}: {exc}"]
    if not isinstance(doc, dict) or doc.get("schema") != 1 or doc.get("version") != 1:
        errors.append("taxonomy schema and version must both be integer 1")
    tags = doc.get("tags") if isinstance(doc, dict) else None
    if not isinstance(tags, list) or not tags:
        return {}, errors + ["taxonomy tags must be a non-empty array"]

    registry: dict[str, ReviewedTag] = {}
    for index, item in enumerate(tags):
        where = f"taxonomy tag {index}"
        if not isinstance(item, dict):
            errors.append(f"{where} must be an object")
            continue
        tag_id, skill = item.get("id"), item.get("skill")
        if not isinstance(tag_id, str) or not TAG_ID.fullmatch(tag_id):
            errors.append(f"{where} id must be a canonical lowercase slug")
            continue
        if tag_id in registry:
            errors.append(f"duplicate taxonomy id {tag_id!r}")
            continue
        if skill not in SKILLS:
            errors.append(f"{where} has unsupported skill {skill!r}")
            continue
        for field in ("definition", "editorialRule"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                errors.append(f"{where} {field} must be a non-empty string")
        registry[tag_id] = ReviewedTag(id=tag_id, skill=skill)
    return registry, errors


def validate_question_tags(
    question: dict,
    registry: dict[str, ReviewedTag],
) -> tuple[list[tuple[str, str]], TagCoverage]:
    """Validate optional position-aligned tags without imposing a coverage floor."""

    choices = question.get("choices")
    answer = question.get("answer")
    distractor_slots = max(0, len(choices) - 1) if isinstance(choices, list) else 0
    if "distractorTags" not in question:
        return [], TagCoverage(False, 0, distractor_slots)

    issues: list[tuple[str, str]] = []
    tags = question.get("distractorTags")
    if not isinstance(tags, list):
        return [("distractor-tags-type", "distractorTags must be an array when present")], TagCoverage(
            True, 0, distractor_slots
        )
    if not isinstance(choices, list) or len(tags) != len(choices):
        return [(
            "distractor-tags-length",
            f"distractorTags length {len(tags)} must equal choices length "
            f"{len(choices) if isinstance(choices, list) else '?'}",
        )], TagCoverage(True, 0, distractor_slots)

    if isinstance(answer, int) and not isinstance(answer, bool) and answer in range(len(tags)):
        if tags[answer] is not None:
            issues.append(("distractor-tag-correct-choice", "the correct choice tag must be null"))

    tagged_slots = 0
    skill = question.get("skill")
    for index, raw in enumerate(tags):
        if index == answer or raw is None:
            continue
        if not isinstance(raw, str) or not raw or raw != raw.strip() or not TAG_ID.fullmatch(raw):
            issues.append((
                "distractor-tag-id",
                f"choice {index} tag must be null or a canonical nonblank lowercase slug",
            ))
            continue
        reviewed = registry.get(raw)
        if reviewed is None:
            issues.append(("distractor-tag-unknown", f"choice {index} uses unknown tag {raw!r}"))
            continue
        if skill != reviewed.skill:
            issues.append((
                "distractor-tag-skill",
                f"choice {index} tag {raw!r} is reviewed for {reviewed.skill!r}, not {skill!r}",
            ))
            continue
        tagged_slots += 1
    return issues, TagCoverage(True, tagged_slots, distractor_slots)
