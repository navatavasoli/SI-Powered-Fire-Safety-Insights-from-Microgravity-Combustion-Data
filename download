"""Step 1 of the pipeline: cache every combustion investigation from PSI.

Usage:  python -m ingest.fetch_combustion [--out data] [--max-table-mb 5]

Writes:
  data/raw/<ACCESSION>.json            full investigation record
  data/raw/tables/<ACCESSION>/<file>   experimental-table CSVs (the test matrices)
  data/catalog.json                    one normalised row per investigation
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .psi_client import PSIClient


def is_combustion(summary: dict) -> bool:
    return "combustion" in (summary.get("Research Area") or "").lower()


def catalog_row(d: dict) -> dict:
    """Flatten the fields the dashboard filters, ranks and cites on."""
    return {
        "accession": d.get("accession"),
        "acronym": d.get("investigationAcronym") or None,
        "title": d.get("title"),
        "doi": d.get("doi") or None,
        "license": d.get("licenseIdentifier") or None,
        "project_type": d.get("projectType"),
        "sub_area": d.get("subResearchArea") or None,
        "platform": d.get("flightProgram") or None,
        "hardware": d.get("experimentHardware") or None,
        "start": d.get("investigationStartDate") or None,
        "end": d.get("investigationEndDate") or None,
        "related": (d.get("related_glds") or "").split(),
        "objective": d.get("objective"),
        "approach": d.get("approach"),
        "hypothesis": d.get("hypothesis"),
        "impacts": d.get("researchImpacts"),
        "total_bytes": d.get("totalFileSize") or 0,
        "tables": [t["file_name"] for t in d.get("experimentalTable") or []],
        "images": [i["file_name"] for i in d.get("images") or []],
        "publications": [
            {"title": p.get("title"), "authors": p.get("authorList"), "doi": p.get("doi") or None}
            for p in d.get("publications") or []
        ],
    }


def run(out: Path, max_table_bytes: int, client: PSIClient | None = None) -> list[dict]:
    client = client or PSIClient()
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)

    summaries = [s for s in client.search_investigations() if is_combustion(s)]
    print(f"{len(summaries)} combustion investigations")

    catalog = []
    for s in sorted(summaries, key=lambda s: int(s["Accession"].split("-")[1])):
        acc = s["Accession"]
        d = client.investigation(acc)
        (raw / f"{acc}.json").write_text(json.dumps(d, indent=2), encoding="utf-8")

        for t in d.get("experimentalTable") or []:
            if t.get("restricted") or (t.get("file_size") or 0) > max_table_bytes:
                continue
            dest = raw / "tables" / acc / t["file_name"]
            if not dest.exists():  # resumable
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(client.download_file(acc, t["file_name"]))

        row = catalog_row(d)
        catalog.append(row)
        print(f"  {acc:8} {row['acronym'] or '-':22} {row['total_bytes']/1e9:8.1f} GB  "
              f"{len(row['tables'])} table(s)  {len(row['publications'])} pubs")

    (out / "catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"total {sum(r['total_bytes'] for r in catalog)/1e12:.2f} TB -> {out/'catalog.json'}")
    return catalog


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--max-table-mb", type=float, default=5)
    a = ap.parse_args()
    run(a.out, int(a.max_table_mb * 1e6))
