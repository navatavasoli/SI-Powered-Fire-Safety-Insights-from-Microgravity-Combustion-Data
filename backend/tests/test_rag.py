"""Offline tests for envelopes, chunking, retrieval and grounded answering (no network)."""
from __future__ import annotations

import numpy as np

from ingest.envelopes import flow_ms, numbers, o2_percent, pressure_kpa
from rag.answer import answer
from rag.corpus import split
from rag.llm import LLMError
from rag.retrieve import Retriever


# ---------- envelope parsing ----------

def test_numbers_from_free_text():
    assert numbers("21; 26.5; 40") == [21, 26.5, 40]
    assert numbers("~ 21.5") == [21.5]
    assert numbers("0.1 - 5") == [0.1, 5]
    assert numbers(".33 cm") == [0.33]


def test_o2_fraction_and_percent():
    assert o2_percent("XO2", ["0.21", "0.4"]) == [21.0, 40.0]
    assert o2_percent("Percent O2", ["21.5 - 21.7"]) == [21.5, 21.7]
    assert o2_percent("O2", ["2"]) == []  # 2 % is not a plausible O2 level here


def test_pressure_units():
    assert pressure_kpa("Pressure", ["1 atm", "2 atm"]) == [101.3, 202.7]
    assert pressure_kpa("Ambient pressure; mmHg", ["760"]) == [101.3]
    assert pressure_kpa("approx p (bar)", ["1.10"]) == [110.0]
    assert pressure_kpa("Pressure", ["unknown"]) == []


def test_flow_requires_cm_per_s():
    assert flow_ms("Air Flow (cm/s)", ["20"]) == [0.2]
    assert flow_ms("Fan display", ["62"]) == []


def test_split_respects_max():
    text = " ".join(f"Sentence number {i} about flames." for i in range(200))
    parts = split(text, max_chars=300, overlap=50)
    assert len(parts) > 5 and all(len(p) <= 300 for p in parts)


# ---------- retrieval + answering ----------

CHUNKS = [
    {"id": "A:objective:0", "accession": "PSI-25", "acronym": "BASS-II", "title": "Burning and Suppression of Solids - II",
     "dataset_doi": "10.60555/bass2", "section": "objective", "pub_dois": [],
     "text": "Flame spread over PMMA in low-speed opposed flow near the oxygen limit.",
     "search_text": "BASS-II flame spread PMMA opposed flow oxygen limit"},
    {"id": "B:objective:0", "accession": "PSI-102", "acronym": "SAME", "title": "Smoke and Aerosol Measurement Experiment",
     "dataset_doi": "10.60555/same", "section": "objective", "pub_dois": [],
     "text": "Smoke particle size from overheated spacecraft materials for detector design.",
     "search_text": "SAME smoke particle size detector spacecraft materials"},
]


def bm25_only() -> Retriever:
    return Retriever(CHUNKS, embeddings=None)


class FakeLLM:
    name = "fake"

    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.calls = reply, error, []

    def complete_json(self, system, messages, max_tokens=1200):
        self.calls.append(messages)
        if self.error:
            raise LLMError(self.error)
        return self.reply


def test_bm25_finds_relevant_chunk():
    hits = bm25_only().search("smoke particle detector", k=1)
    assert hits[0]["acronym"] == "SAME"


def test_dense_fusion_with_fake_embedder():
    class E:
        def query(self, t):
            return np.array([0.0, 1.0], dtype=np.float32)
    emb = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    hits = Retriever(CHUNKS, emb, E()).search("flame", k=2)
    assert {h["accession"] for h in hits} == {"PSI-25", "PSI-102"}
    assert hits[0]["cosine"] is not None


def test_no_llm_falls_back_to_retrieval_only():
    a = answer("smoke particle size", bm25_only(), None)
    assert a.mode == "retrieval-only"
    assert a.cites and a.cites[0]["doi"] == "10.60555/same"
    assert a.blocks[-1]["kind"] == "limitation"


def test_llm_error_falls_back():
    a = answer("smoke particle size", bm25_only(), FakeLLM(error="rate limit"))
    assert a.mode == "retrieval-only" and "rate limit" in a.notice


def test_unverifiable_citations_are_dropped_and_renumbered():
    reply = {
        "findings": [
            {"text": "Smoke particle size was measured [2]."},   # valid -> renumbered to [1]
            {"text": "Something invented [7]."},                 # invalid -> dropped
            {"text": "No citation at all."},                     # uncited -> dropped
        ],
        "interpretation": "Detectors may need tuning [1].",     # citations stripped from interpretation
        "limitations": "No partial-gravity data.",
        "proposal": None,
    }
    hits_order = bm25_only().search("smoke particle", k=8)
    a = answer("smoke particle", bm25_only(), FakeLLM(reply))
    findings = [b for b in a.blocks if b["kind"] == "finding"]
    assert len(findings) == 1 and findings[0]["text"].endswith("[1].")
    assert a.cites[0]["acc"] == hits_order[1]["accession"]
    assert "[1]" not in next(b for b in a.blocks if b["kind"] == "interpretation")["text"]
    assert any("removed" in b["text"] for b in a.blocks if b["kind"] == "limitation")


def test_proposal_clamped_to_ranges_and_known_keys():
    ctx = {"params": {"o2": 21, "p": 101.3}, "param_ranges": {"o2": [10, 50], "p": [20, 200]}}
    reply = {"findings": [], "interpretation": None, "limitations": None,
             "proposal": {"changes": {"o2": 90, "p": 101.3, "warp": 9}, "why": "high O2"}}
    a = answer("configure high oxygen", bm25_only(), FakeLLM(reply), ctx)
    assert a.proposal == {"changes": {"o2": 50.0}, "why": "high O2"}
