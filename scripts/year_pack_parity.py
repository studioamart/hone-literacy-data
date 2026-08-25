#!/usr/bin/env python3
"""Require the checked-in 2026 batch records to match the live OTA corpus.

The batch files are editable source records. ``data/passages.json`` is the file
the app downloads. Keeping both copies creates a drift risk, so this check
compares each complete JSON passage object and fails on missing, extra,
duplicate, malformed, or changed records.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PACK_DIR = ROOT / "content" / "year-of-readings-2026"
DEFAULT_CORPUS = ROOT / "data" / "passages.json"
PACK_ID = re.compile(r"^og-y26-d\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$")
BATCH_NAME = re.compile(r"^batch-\d+[a-z]?\.json$")


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT.resolve()))
    except ValueError:
        return str(path)


def load_json(path: Path, errors: list[str]) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{display_path(path)}: cannot read valid JSON: {exc}")
        return None


def first_difference(left: Any, right: Any, pointer: str = "$") -> str | None:
    """Return the first deterministic JSON-pointer-like difference."""

    if type(left) is not type(right):
        return f"{pointer} (type {type(left).__name__} != {type(right).__name__})"
    if isinstance(left, dict):
        for key in sorted(set(left) | set(right)):
            child = f"{pointer}/{key}"
            if key not in left:
                return f"{child} (missing from batch)"
            if key not in right:
                return f"{child} (missing from live corpus)"
            difference = first_difference(left[key], right[key], child)
            if difference:
                return difference
        return None
    if isinstance(left, list):
        if len(left) != len(right):
            return f"{pointer}/length ({len(left)} != {len(right)})"
        for index, (left_item, right_item) in enumerate(zip(left, right)):
            difference = first_difference(left_item, right_item, f"{pointer}/{index}")
            if difference:
                return difference
        return None
    if left != right:
        return pointer
    return None


def collect_batch_records(pack_dir: Path, errors: list[str]) -> dict[str, tuple[dict, Path]]:
    records: dict[str, tuple[dict, Path]] = {}
    paths = sorted(path for path in pack_dir.glob("batch-*.json") if BATCH_NAME.fullmatch(path.name))
    if not paths:
        errors.append(f"{display_path(pack_dir)}: no supported batch files found")
        return records

    for path in paths:
        document = load_json(path, errors)
        passages = document.get("passages") if isinstance(document, dict) else None
        if not isinstance(passages, list):
            if document is not None:
                errors.append(f"{display_path(path)}: top level must contain a passages array")
            continue
        for index, passage in enumerate(passages):
            origin = f"{display_path(path)}:passages[{index}]"
            if not isinstance(passage, dict):
                errors.append(f"{origin}: passage must be an object")
                continue
            passage_id = passage.get("id")
            if not isinstance(passage_id, str) or not PACK_ID.fullmatch(passage_id):
                errors.append(f"{origin}: id must be a 2026 year-pack id")
                continue
            if passage_id in records:
                prior = display_path(records[passage_id][1])
                errors.append(f"{passage_id}: duplicate batch record in {prior} and {display_path(path)}")
                continue
            records[passage_id] = (passage, path)
    return records


def collect_live_records(corpus_path: Path, errors: list[str]) -> dict[str, dict]:
    document = load_json(corpus_path, errors)
    passages = document.get("passages") if isinstance(document, dict) else None
    if not isinstance(passages, list):
        if document is not None:
            errors.append(f"{display_path(corpus_path)}: top level must contain a passages array")
        return {}

    records: dict[str, dict] = {}
    for index, passage in enumerate(passages):
        if not isinstance(passage, dict):
            continue
        passage_id = passage.get("id")
        if not isinstance(passage_id, str) or not PACK_ID.fullmatch(passage_id):
            continue
        if passage_id in records:
            errors.append(
                f"{display_path(corpus_path)}: duplicate live year-pack id {passage_id} "
                f"at passages[{index}]"
            )
            continue
        records[passage_id] = passage
    return records


def check_parity(pack_dir: Path, corpus_path: Path, expected_count: int = 365) -> dict:
    errors: list[str] = []
    batch = collect_batch_records(pack_dir, errors)
    live = collect_live_records(corpus_path, errors)

    if len(batch) != expected_count:
        errors.append(f"batch record count is {len(batch)}; expected {expected_count}")
    if len(live) != expected_count:
        errors.append(f"live year-pack record count is {len(live)}; expected {expected_count}")

    missing_from_batch = sorted(set(live) - set(batch))
    missing_from_live = sorted(set(batch) - set(live))
    for passage_id in missing_from_batch:
        errors.append(f"{passage_id}: present in live corpus but missing from batches")
    for passage_id in missing_from_live:
        errors.append(f"{passage_id}: present in batches but missing from live corpus")

    mismatches: list[dict[str, str]] = []
    for passage_id in sorted(set(batch) & set(live)):
        batch_passage, batch_path = batch[passage_id]
        difference = first_difference(batch_passage, live[passage_id])
        if difference:
            mismatches.append(
                {
                    "passage": passage_id,
                    "batchPath": display_path(batch_path),
                    "difference": difference,
                }
            )

    return {
        "ok": not errors and not mismatches,
        "packDirectory": display_path(pack_dir),
        "corpusPath": display_path(corpus_path),
        "expectedCount": expected_count,
        "batchCount": len(batch),
        "liveCount": len(live),
        "errors": errors,
        "mismatches": mismatches,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack-dir", type=Path, default=DEFAULT_PACK_DIR)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--expected-count", type=int, default=365)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = check_parity(args.pack_dir, args.corpus, args.expected_count)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    elif report["ok"]:
        print(
            f"OK — {report['batchCount']} year-pack batch records exactly match "
            f"{report['corpusPath']}."
        )
    else:
        problems = len(report["errors"]) + len(report["mismatches"])
        print(f"FAIL — {problems} year-pack parity problem(s):")
        for error in report["errors"]:
            print(f"  {error}")
        for mismatch in report["mismatches"]:
            print(
                f"  {mismatch['passage']}: {mismatch['batchPath']} differs from live at "
                f"{mismatch['difference']}"
            )
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
