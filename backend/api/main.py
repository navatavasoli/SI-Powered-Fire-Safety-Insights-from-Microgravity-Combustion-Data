"""CRASSUS backend: serves the cached PSI data and the RAG copilot.

Run:  uvicorn api.main:app --port 8000     (from backend/)

Reads only the committed local cache in data/ — never the live PSI API.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import rag  # noqa: F401  (TLS via OS trust store)
from rag.answer import answer
from rag.llm import LLMError, from_env
from rag.retrieve import Retriever

load_dotenv()
BACKEND = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("CRASSUS_DATA", BACKEND / "data"))

app = FastAPI(title="CRASSUS API", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


def _read(rel: str):
    p = DATA / rel
    if not p.exists():
        raise HTTPException(503, f"{p} missing — run the ingest pipeline (see README)")
    return json.loads(p.read_text(encoding="utf-8"))


@lru_cache
def retriever() -> Retriever:
    return Retriever.load(DATA)


_llm_state: dict = {}


def _key_fingerprint() -> str:
    import hashlib
    keys = "|".join(os.environ.get(k, "") for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "LLM_PROVIDER",
                                                     "GEMINI_MODEL", "GROQ_MODEL"))
    return hashlib.sha256(keys.encode()).hexdigest()  # compare keys without keeping them around


def llm():
    """The configured LLM. Until one works, .env is re-read on each call so a newly added key
    takes effect without a restart; setup is retried only when the key settings change."""
    if _llm_state.get("llm") is None:
        load_dotenv(override=True)
        fp = _key_fingerprint()
        if _llm_state.get("fp") != fp:
            _llm_state["fp"] = fp
            try:
                _llm_state["llm"], _llm_state["error"] = from_env(), None
            except LLMError as e:
                _llm_state["llm"], _llm_state["error"] = None, str(e)
    return _llm_state["llm"]


def short_name(c: dict) -> str:
    if c.get("acronym"):
        return c["acronym"]
    t = re.sub(r"^(Computational and Experimental Analysis of|Utilization of the|Effect of|Quantitative Studies of)\s+",
               "", c.get("title") or c["accession"], flags=re.I)
    return (t[:30].rsplit(" ", 1)[0] + "…") if len(t) > 30 else t


@lru_cache
def investigations() -> list[dict]:
    catalog = {c["accession"]: c for c in _read("catalog.json")}
    out = []
    for e in _read("derived/envelopes.json"):
        c = catalog.get(e["accession"], {})
        out.append({
            **e, "name": short_name(c or e),
            "objective": (c.get("objective") or "")[:600],
            "start": c.get("start"), "end": c.get("end"), "license": c.get("license"),
            "n_pubs": len(c.get("publications") or []),
            "pub_dois": [p["doi"] for p in c.get("publications") or [] if p.get("doi")][:20],
            "psi_url": f"https://psi.nasa.gov/investigations/{e['accession']}",
        })
    return out


@app.get("/api/health")
def health():
    m = llm()
    r = retriever()
    return {"ok": True, "chunks": len(r.chunks), "dense": r.emb is not None,
            "llm": getattr(m, "name", None), "llm_error": _llm_state.get("error")}


@app.get("/api/investigations")
def get_investigations():
    return investigations()


@app.get("/api/flex-tests")
def flex_tests():
    return _read("derived/flex_tests.json")


@app.get("/api/burner-tests")
def burner_tests():
    return _read("derived/burner_tests.json")


class ChatIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[dict] = []
    context: dict | None = None


@app.post("/api/chat")
def chat(body: ChatIn):
    return answer(body.question, retriever(), llm(), body.context, body.history).to_dict()


# ---------- relevance ranking ----------

FIRE_SAFETY_QUERY = ("fire safety in crewed spacecraft and habitats: material flammability, flame spread, "
                     "ignition, smoke detection, fire suppression and extinguishment")
ENV_TERMS = {
    "iss": "ISS cabin air microgravity",
    "cabin": "spacecraft cabin air microgravity ventilation",
    "lunar": "exploration atmosphere elevated oxygen reduced pressure lunar partial gravity",
    "mars": "exploration atmosphere elevated oxygen reduced pressure Mars partial gravity",
    "rover": "pressurized rover exploration atmosphere elevated oxygen reduced pressure",
    "custom": "",
}


def _coverage(rng: list[float] | None, x: float | None, scale: float) -> float | None:
    """1 inside the tested range, decaying with distance outside; None if not reported."""
    if rng is None or x is None:
        return None
    lo, hi = rng
    d = 0.0 if lo <= x <= hi else min(abs(x - lo), abs(x - hi))
    return float(2.718281828 ** (-d / scale))


@app.get("/api/rank")
def rank(env: str = "cabin", o2: float | None = None, p: float | None = None, k: int = 10):
    q = f"{FIRE_SAFETY_QUERY}. {ENV_TERMS.get(env, '')}"
    hits = retriever().search(q, k=60)
    best: dict[str, dict] = {}
    for h in hits:
        best.setdefault(h["accession"], h)
    top = max((h["score"] for h in best.values()), default=1.0)

    rows = []
    for inv in investigations():
        h = best.get(inv["accession"])
        topic = (h["score"] / top) if h else 0.0
        cov_o2 = _coverage(inv["o2_pct"], o2, 8.0)       # e-fold per 8 O2 points outside range
        cov_p = _coverage(inv["p_kpa"], p, 30.0)        # e-fold per 30 kPa outside range
        covs = [c for c in (cov_o2, cov_p) if c is not None]
        coverage = sum(covs) / len(covs) if covs else 0.5  # unreported = neutral
        tagged = 1.0 if "fire" in (inv.get("sub_area") or "").lower() else 0.0
        score = 0.55 * topic + 0.30 * coverage + 0.15 * tagged

        why = []
        if h:
            why.append(f"matched on {h['section']}")
        if covs:
            why.append("tested conditions cover target" if coverage > 0.95 else
                       f"tested O₂/pressure {'near' if coverage > 0.5 else 'far from'} target")
        else:
            why.append("O₂/pressure not reported in test matrix")
        if tagged:
            why.append("PSI sub-area: " + inv["sub_area"])
        rows.append({
            "accession": inv["accession"], "name": inv["name"], "title": inv["title"],
            "sub_area": inv.get("sub_area"), "doi": inv.get("doi"), "n_tests": inv["n_tests"],
            "score": round(score, 3), "components": {"topic": round(topic, 3), "coverage": round(coverage, 3), "tagged": tagged},
            "why": "; ".join(why), "evidence": (h["text"][:220] + "…") if h else None,
        })
    rows.sort(key=lambda r: -r["score"])
    return {"env": env, "o2": o2, "p": p,
            "weights": {"topic": 0.55, "coverage": 0.30, "tagged": 0.15}, "rows": rows[:k]}


# ---------- fire-safety evidence board ----------

SAFETY = [
    ("PREVENTION", "Materials · flammability limits · ignition",
     "solid material flammability limits flame spread ignition oxygen concentration low flow"),
    ("DETECTION", "Smoke · aerosols · sensors", "smoke particle size aerosol measurement fire detection detectors"),
    ("SUPPRESSION", "Extinction · suppressants · atmosphere",
     "fire suppression and extinguishment effectiveness of diluent gases carbon dioxide helium on burning fuel extinction limits"),
    ("FUTURE EQUIPMENT", "Next-gen systems · models · tech transfer",
     "design of fire detection and suppression systems computational models electric field flame control future missions"),
]


@app.get("/api/safety")
def safety(per: int = 3):
    out = []
    for title, sub, q in SAFETY:
        items, seen = [], set()
        for h in retriever().search(q, k=30, sections={"objective", "hypothesis", "approach", "research impacts", "description"}):
            if h["accession"] in seen:
                continue
            seen.add(h["accession"])
            t = re.sub(r"\s+", " ", h["text"]).strip()
            items.append({"kind": "RETRIEVED", "src": f"{h.get('acronym') or h['accession']} · {h['section']}",
                          "acc": h["accession"], "doi": h.get("dataset_doi"),
                          "text": t if len(t) < 360 else t[:360].rsplit(" ", 1)[0] + " …"})
            if len(items) >= per:
                break
        out.append({"title": title, "sub": sub, "items": items})
    return out
