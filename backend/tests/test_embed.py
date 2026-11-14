"""Gemini embedder + retrieval fallbacks (mocked HTTP; no key or network)."""
import json

import httpx
import numpy as np

from rag.index import GeminiEmbedder, embedder_for
from rag.retrieve import Retriever


def fake_gemini(dim=4, fail_status=None, seen=None):
    def handler(req):
        body = json.loads(req.content)
        if seen is not None:
            seen.append((req.url.path, body["taskType"], body["outputDimensionality"]))
        if fail_status:
            return httpx.Response(fail_status, json={})
        v = [float(len(body["content"]["parts"][0]["text"]) % 7 + 1)] + [1.0] * (dim - 1)
        return httpx.Response(200, json={"embedding": {"values": v}})
    return httpx.MockTransport(handler)


def test_gemini_embedder_task_types_and_normalisation():
    seen = []
    e = GeminiEmbedder(api_key="k", model="gemini-embedding-2", dim=4, transport=fake_gemini(seen=seen))
    P = e.passages(["alpha", "beta gamma"])
    q = e.query("flame")
    assert P.shape == (2, 4) and np.allclose(np.linalg.norm(P, axis=1), 1)
    assert np.isclose(np.linalg.norm(q), 1)
    assert seen[0] == ("/v1beta/models/gemini-embedding-2:embedContent", "RETRIEVAL_DOCUMENT", 4)
    assert seen[-1][1] == "RETRIEVAL_QUERY"
    assert e.meta() == {"provider": "gemini", "model": "gemini-embedding-2", "dim": 4}


def test_embedder_for_reads_meta(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    e = embedder_for({"provider": "gemini", "model": "gemini-embedding-2", "dim": 768})
    assert isinstance(e, GeminiEmbedder) and e.dim == 768


CHUNKS = [
    {"accession": "PSI-1", "section": "objective", "text": "smoke particles", "search_text": "smoke particle detector"},
    {"accession": "PSI-2", "section": "objective", "text": "flame spread", "search_text": "flame spread pmma"},
]


def test_query_embedding_failure_falls_back_to_bm25_and_queries_are_cached():
    calls = []

    class Flaky:
        def query(self, t):
            calls.append(t)
            raise RuntimeError("503")

    r = Retriever(CHUNKS, np.eye(2, dtype=np.float32), Flaky())
    hits = r.search("smoke detector", k=1)
    assert hits[0]["accession"] == "PSI-1" and hits[0]["cosine"] is None
    assert r.dense_errors == 1

    class Good:
        def query(self, t):
            calls.append(t)
            return np.array([1.0, 0.0], dtype=np.float32)

    r2 = Retriever(CHUNKS, np.eye(2, dtype=np.float32), Good())
    r2.search("smoke detector"); r2.search("smoke detector")
    assert calls.count("smoke detector") == 2  # one failed (Flaky) + one cached miss (Good)
