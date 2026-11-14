"""Grounded answering: retrieve -> prompt -> validate citations -> UI blocks.

The response separates what the sources say (FINDINGS, each with citations) from the
model's reasoning (AI INTERPRETATION) and the caveats (LIMITATIONS), matching the
dashboard's provenance labels. Findings whose citations don't point at a retrieved
source are dropped, so nothing reaches the "retrieved" block without a source.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .llm import LLM, LLMError
from .retrieve import Retriever

K = 8
CITE = re.compile(r"\[(\d{1,2})\]")
PARAM_KEYS = {"o2", "p", "u", "g", "T", "geom", "ef", "flow"}

SYSTEM = """You are the research copilot inside CRASSUS, a research-support dashboard over NASA
Physical Sciences Informatics (PSI) combustion investigations, focused on fire safety in crewed
spacecraft and habitats. Users are researchers, engineers and students.

Rules:
1. FINDINGS state only what the numbered SOURCES say. Every finding ends with one or more
   citations like [2] or [1][4] that point at the sources supporting it. Never cite a number
   that is not in SOURCES. Never invent tests, values, dates or DOIs.
2. INTERPRETATION is your own reasoning for the user's question (e.g. what the findings imply
   for a lunar habitat). Keep it clearly separate from findings and hedge appropriately.
3. LIMITATIONS: say what the sources do NOT cover (e.g. PSI has no partial-gravity combustion
   data; exploration atmospheres beyond tested O2/pressure are extrapolation; the dashboard's
   flame model is a reduced-order model, not measured data).
4. If the sources do not answer the question, return no findings and say so in limitations.
5. Rockets and propellants are out of scope.
6. If, and only if, the user asks you to set up / configure / suggest simulation conditions,
   return "proposal" with the parameter values to change (only keys from CURRENT PARAMETERS,
   within the given ranges) and a one-line "why". Otherwise "proposal" is null.
7. Be concise: at most 4 findings, interpretation and limitations of 1-3 sentences each.

Return JSON only:
{"findings": [{"text": "... [1]"}], "interpretation": "..." | null, "limitations": "..." | null,
 "proposal": {"changes": {"o2": 30}, "why": "..."} | null}"""


@dataclass
class Answer:
    blocks: list[dict]
    cites: list[dict]
    proposal: dict | None = None
    mode: str = "generated"          # generated | retrieval-only
    model: str | None = None
    notice: str | None = None
    retrieved: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"blocks": self.blocks, "cites": self.cites, "proposal": self.proposal,
                "mode": self.mode, "model": self.model, "notice": self.notice}


def _source_block(i: int, c: dict) -> str:
    who = c.get("acronym") or c["accession"]
    doi = c.get("dataset_doi") or "none listed"
    return f"[{i}] {who} ({c['accession']}, dataset DOI {doi}) — {c['section']}:\n{c['text']}"


def _context_text(ctx: dict | None) -> str:
    if not ctx:
        return "none"
    parts = []
    if ctx.get("investigation"):
        parts.append(f"Selected investigation: {ctx['investigation']}")
    if ctx.get("environment"):
        parts.append(f"Environment preset: {ctx['environment']}")
    if ctx.get("params"):
        parts.append("CURRENT PARAMETERS: " + ", ".join(f"{k}={v}" for k, v in ctx["params"].items()))
    if ctx.get("param_ranges"):
        parts.append("Ranges: " + ", ".join(f"{k}∈[{a},{b}]" for k, (a, b) in ctx["param_ranges"].items()))
    if ctx.get("model_outputs"):
        parts.append("Flame-model outputs (MODEL, not data): " + ", ".join(ctx["model_outputs"]))
    return "\n".join(parts)


def _cite_entry(n: int, c: dict) -> dict:
    return {"n": n, "inv": f"{c.get('acronym') or c['accession']} — {c.get('title') or ''}".strip(" —"),
            "acc": c["accession"], "doi": c.get("dataset_doi"), "section": c["section"],
            "pub_dois": c.get("pub_dois", [])[:4]}


def _excerpt(t: str, n: int = 320) -> str:
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= n else t[:n].rsplit(" ", 1)[0] + " …"


def retrieval_only(question: str, hits: list[dict], notice: str) -> Answer:
    top = hits[:3]
    blocks = [{"kind": "finding", "text": f"{_excerpt(c['text'])} [{i}]"} for i, c in enumerate(top, 1)]
    blocks.append({"kind": "limitation", "text": notice})
    return Answer(blocks=blocks, cites=[_cite_entry(i, c) for i, c in enumerate(top, 1)],
                  mode="retrieval-only", notice=notice, retrieved=hits)


def _validate_proposal(p, ctx: dict | None) -> dict | None:
    if not isinstance(p, dict) or not isinstance(p.get("changes"), dict):
        return None
    ranges = (ctx or {}).get("param_ranges") or {}
    current = (ctx or {}).get("params") or {}
    out = {}
    for k, v in p["changes"].items():
        if k not in PARAM_KEYS or k not in current:
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        if k in ranges:
            lo, hi = ranges[k]
            v = min(max(v, lo), hi)
        if v != current.get(k):
            out[k] = round(v, 4)
    return {"changes": out, "why": str(p.get("why") or "")[:300]} if out else None


def answer(question: str, retriever: Retriever, llm: LLM | None, ctx: dict | None = None,
           history: list[dict] | None = None) -> Answer:
    focus = (ctx or {}).get("accession")
    hits = retriever.search(question, k=K, focus=focus)
    if not hits:
        return Answer(blocks=[{"kind": "limitation", "text":
                               "Nothing in the local PSI index matches this question."}],
                      cites=[], mode="retrieval-only")
    if llm is None:
        return retrieval_only(question, hits,
                              "LLM not configured (set GROQ_API_KEY in .env) — showing the most relevant retrieved passages verbatim.")

    sources = "\n\n".join(_source_block(i, c) for i, c in enumerate(hits, 1))
    msgs = []
    for h in (history or [])[-4:]:
        if h.get("role") in ("user", "assistant") and h.get("text"):
            msgs.append({"role": h["role"], "content": h["text"][:1500]})
    msgs.append({"role": "user", "content":
                 f"SOURCES:\n{sources}\n\nDASHBOARD CONTEXT:\n{_context_text(ctx)}\n\nQUESTION: {question}"})
    try:
        raw = llm.complete_json(SYSTEM, msgs)
    except LLMError as e:
        return retrieval_only(question, hits, f"LLM unavailable ({e}) — showing retrieved passages verbatim.")

    # Keep findings only if every citation points at a retrieved source; renumber compactly.
    used: dict[int, int] = {}
    blocks = []
    for f in (raw.get("findings") or [])[:4]:
        text = f.get("text") if isinstance(f, dict) else str(f)
        nums = [int(m) for m in CITE.findall(text or "")]
        valid = [n for n in nums if 1 <= n <= len(hits)]
        if not text or not valid or len(valid) != len(nums):
            continue
        for n in valid:
            used.setdefault(n, len(used) + 1)
        blocks.append({"kind": "finding", "text": CITE.sub(lambda m: f"[{used[int(m.group(1))]}]", text).strip()})

    dropped = len(raw.get("findings") or []) - len(blocks)
    for kind, key in (("interpretation", "interpretation"), ("limitation", "limitations")):
        t = raw.get(key)
        if isinstance(t, str) and t.strip():
            # Interpretation must not smuggle in citations to sources it can't be checked against.
            blocks.append({"kind": kind, "text": CITE.sub("", t).strip()})
    if dropped > 0:
        blocks.append({"kind": "limitation", "text":
                       f"{dropped} generated statement(s) were removed because their citations could not be verified against retrieved sources."})
    if not blocks:
        blocks = [{"kind": "limitation", "text": "The retrieved PSI sources do not answer this question."}]

    cites = [_cite_entry(new, hits[old - 1]) for old, new in sorted(used.items(), key=lambda kv: kv[1])]
    return Answer(blocks=blocks, cites=cites, proposal=_validate_proposal(raw.get("proposal"), ctx),
                  model=getattr(llm, "name", None), retrieved=hits)
