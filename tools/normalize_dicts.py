#!/usr/bin/env python3
"""Normalize every dialect dictionary to the shared CSV schema.

Schema: header ``italiano,traduzione``, UTF-8, one entry per row,
lowercase keys, typographic apostrophes unified to U+0027, entries
deduplicated on ``italiano`` (first occurrence wins) and sorted
alphabetically. Run from the repository root:

    python3 tools/normalize_dicts.py [file.csv ...]

With no arguments it normalizes every ``.csv`` under ``public/dictionaries/``.
"""
import csv
import sys
import unicodedata
from pathlib import Path

HEADER = ["italiano", "traduzione"]
LEGACY_KEYS = ("italiano", "traduzione", "bresciano", "milanese", "dialetto")


def clean(cell: str) -> str:
    cell = unicodedata.normalize("NFC", cell or "")
    cell = cell.replace("’", "'").replace("‘", "'")
    return " ".join(cell.split())


def normalize(path: Path) -> None:
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return
    header = [clean(c).lower() for c in rows[0]]
    body = rows[1:] if all(k in LEGACY_KEYS for k in header if k) else rows

    entries: dict[str, str] = {}
    for row in body:
        if len(row) < 2:
            continue
        ita, tra = clean(row[0]).lower(), clean(row[1])
        if not ita or not tra:
            continue
        entries.setdefault(ita, tra)

    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        for ita in sorted(entries):
            writer.writerow([ita, entries[ita]])
    print(f"{path}: {len(entries)} voci")


def main() -> None:
    targets = [Path(a) for a in sys.argv[1:]]
    if not targets:
        targets = sorted(Path("public/dictionaries").rglob("*.csv"))
    for path in targets:
        normalize(path)


if __name__ == "__main__":
    main()
