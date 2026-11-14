"""Turn the cached PSI records into citable text chunks.

Every chunk carries the investigation accession, acronym and dataset DOI so any answer
built from it can cite by DOI (PSI's citation requirement). Publication chunks also
carry the paper DOIs they list.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

MAX_CHARS = 1100   # ~250 tokens: small enough to cite precisely
OVERLAP = 150
PUBS_PER_CHUNK = 8


def _clean(t: str | None) -> str:
    t = (t or "").replace("\r", "")
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def split(text: str, max_chars: int = MAX_CHARS, overlap: int = OVERLAP) -> list[str]:
    """Split on paragraph/sentence boundaries into chunks of at most ~max_chars."""
    text = _clean(text)
    if len(text) <= max_chars:
        return [text] if text else []
    sents = re.split(r"(?<=[.!?])\s+|\n+", text)
    out, cur = [], ""
    for s in sents:
        if not s:
            continue
        if cur and len(cur) + len(s) + 1 > max_chars:
            out.append(cur.strip())
            cur = cur[-overlap:].split(" ", 1)[-1] if overlap else ""
        cur = f"{cur} {s}" if cur else s
        while len(cur) > max_chars:  # a single enormous "sentence"
            out.append(cur[:max_chars])
            cur = cur[max_chars - overlap:]
    if cur.strip():
        out.append(cur.strip())
    return out


def _fmt_range(r, unit, nd=1):
    if not r:
        return "not reported"
    a, b = r
    return f"{a:.{nd}f} {unit}" if a == b else f"{a:.{nd}f}–{b:.{nd}f} {unit}"


def envelope_text(e: dict) -> str:
    fuels = "; ".join(e["fuels"][:12]) or "not reported"
    return (
        f"Test matrix summary for {e.get('acronym') or e['accession']} ({e['accession']}): "
        f"{e['n_tests']} rows in the PSI experimental table(s). "
        f"Oxygen: {_fmt_range(e['o2_pct'], '% vol')}. "
        f"Pressure: {_fmt_range(e['p_kpa'], 'kPa')}. "
        f"Forced flow: {_fmt_range(e['u_ms'], 'm/s', 3)}. "
        f"Gravity: {e['gravity']}. Fuels / materials: {fuels}."
    )


def build_chunks(data: Path) -> list[dict]:
    envs = {}
    env_path = data / "derived" / "envelopes.json"
    if env_path.exists():
        envs = {e["accession"]: e for e in json.loads(env_path.read_text(encoding="utf-8"))}

    chunks: list[dict] = []
    for f in sorted((data / "raw").glob("PSI-*.json"), key=lambda p: int(p.stem.split("-")[1])):
        d = json.loads(f.read_text(encoding="utf-8"))
        acc = d["accession"]
        acr = d.get("investigationAcronym") or None
        name = acr or d.get("title") or acc
        base = {
            "accession": acc, "acronym": acr, "title": d.get("title"),
            "dataset_doi": d.get("doi") or None,
        }

        def add(section: str, text: str, pub_dois: list[str] | None = None):
            for i, part in enumerate(split(text)):
                chunks.append({
                    **base, "id": f"{acc}:{section}:{i}", "section": section,
                    "text": part, "pub_dois": pub_dois or [],
                    # Prefix gives the embedder and BM25 the investigation context.
                    "search_text": f"{name} — {d.get('title')} — {section}: {part}",
                })

        overview = (
            f"{d.get('title')} ({acr or acc}), PSI accession {acc}. "
            f"Research area: {d.get('researchArea') or 'Combustion Science'}; "
            f"sub-area: {d.get('subResearchArea') or 'not stated'}. "
            f"Type: {d.get('projectType') or 'not stated'}. "
            f"Platform: {d.get('flightProgram') or 'not stated'}; hardware: {d.get('experimentHardware') or 'not stated'}. "
            f"Dates: {d.get('investigationStartDate') or '?'} to {d.get('investigationEndDate') or '?'}. "
            f"Dataset DOI: {d.get('doi') or 'none listed'}. Licence: {d.get('licenseIdentifier') or 'not stated'}."
        )
        add("overview", overview)
        for key, label in [("description", "description"), ("objective", "objective"),
                           ("hypothesis", "hypothesis"), ("approach", "approach"),
                           ("researchImpacts", "research impacts")]:
            if _clean(d.get(key)):
                add(label, d[key])
        if acc in envs:
            add("test matrix", envelope_text(envs[acc]))

        pubs = [p for p in d.get("publications") or [] if p.get("title")]
        for i in range(0, len(pubs), PUBS_PER_CHUNK):
            group = pubs[i:i + PUBS_PER_CHUNK]
            lines = [
                f"- {p['title'].strip()} — {(p.get('authorList') or '').strip()}"
                + (f" (DOI {p['doi'].strip()})" if (p.get('doi') or '').strip() else "")
                for p in group
            ]
            text = f"Publications from {name}:\n" + "\n".join(lines)
            chunks.append({
                **base, "id": f"{acc}:publications:{i // PUBS_PER_CHUNK}", "section": "publications",
                "text": text, "search_text": f"{name} — {d.get('title')} — publications: {text}",
                "pub_dois": [p["doi"].strip() for p in group if (p.get("doi") or "").strip()],
            })
    return chunks
