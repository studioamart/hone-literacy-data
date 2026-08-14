#!/usr/bin/env python3
"""Build or verify an immutable corpus-semantics snapshot for review provenance."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from distractor_review_artifact import build_snapshot


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source-path", required=True)
    parser.add_argument(
        "--source-repository",
        required=True,
        type=Path,
        help="Git repository containing the pinned commit and source path",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the existing output is not the deterministic snapshot",
    )
    args = parser.parse_args()

    try:
        corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Cannot read corpus {args.corpus}: {exc}", file=sys.stderr)
        return 1
    pinned = subprocess.run(
        [
            "git", "-C", str(args.source_repository), "show",
            f"{args.source_commit}:{args.source_path}",
        ],
        capture_output=True,
        check=False,
    )
    if pinned.returncode != 0:
        detail = pinned.stderr.decode("utf-8", errors="replace").strip()
        print(
            "Cannot read the pinned source blob from Git"
            + (f": {detail}" if detail else "."),
            file=sys.stderr,
        )
        return 1
    corpus_bytes = args.corpus.read_bytes()
    if pinned.stdout != corpus_bytes:
        print(
            "Corpus bytes do not match the pinned source commit and path; "
            f"working SHA-256 is {hashlib.sha256(corpus_bytes).hexdigest()}, "
            f"pinned SHA-256 is {hashlib.sha256(pinned.stdout).hexdigest()}.",
            file=sys.stderr,
        )
        return 1
    snapshot, errors = build_snapshot(
        args.corpus,
        corpus,
        source_commit=args.source_commit,
        source_path=args.source_path,
    )
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    encoded = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        try:
            existing = args.output.read_text(encoding="utf-8")
        except OSError as exc:
            print(f"Cannot read snapshot {args.output}: {exc}", file=sys.stderr)
            return 1
        if existing != encoded:
            print(
                f"Snapshot {args.output} is stale; regenerate it from the pinned source.",
                file=sys.stderr,
            )
            return 1
        print(f"Snapshot OK — {len(snapshot['questions'])} question variants.")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(encoded, encoding="utf-8")
    print(f"Wrote {args.output} — {len(snapshot['questions'])} question variants.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
