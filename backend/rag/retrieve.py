"""Hybrid retrieval: BM25 + dense cosine, fused with reciprocal rank fusion (RRF)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .index import BM25, tokenize

RRF_K = 60


class Retriever:
    QCACHE_MAX = 512

    def __init__(self, chunks: list[dict], embeddings: np.ndarray | None, embedder=None):
        self.chunks = chunks
        self.emb = embeddings
        self.embedder = embedder
        self.bm25 = BM25([tokenize(c["search_text"]) for c in chunks])
        self._qcache: dict[str, np.ndarray] = {}  # ranking/evidence tabs repeat fixed queries
        self.dense_errors = 0

    @classmethod
    def load(cls, data: Path, embedder=None) -> "Retriever":
        idx = data / "index"
        chunks = json.loads((idx / "chunks.json").read_text(encoding="utf-8"))
        emb_path = idx / "embeddings.npy"
        emb = np.load(emb_path) if emb_path.exists() else None
        if emb is not None and embedder is None:
            meta_path = idx / "meta.json"
            meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
            try:
                from .index import embedder_for
                embedder = embedder_for(meta)
            except Exception as e:  # no key / model missing: keyword search still works
                print(f"[rag] dense retrieval disabled: {e}")
                emb = None
        return cls(chunks, emb, embedder)

    def _query_vec(self, query: str) -> np.ndarray | None:
        if query in self._qcache:
            return self._qcache[query]
        try:
            v = self.embedder.query(query)
        except Exception as e:  # API down / quota: this query falls back to BM25 only
            self.dense_errors += 1
            print(f"[rag] query embedding failed, BM25 only: {e}")
            return None
        if len(self._qcache) >= self.QCACHE_MAX:
            self._qcache.pop(next(iter(self._qcache)))
        self._qcache[query] = v
        return v

    def search(self, query: str, k: int = 8, focus: str | None = None,
               sections: set[str] | None = None) -> list[dict]:
        """Top-k chunks. `focus` (an accession) gently boosts the selected investigation."""
        n = len(self.chunks)
        ranks: list[np.ndarray] = []
        bm = self.bm25.scores(tokenize(query))
        ranks.append(np.argsort(-bm))
        dense = None
        if self.emb is not None and self.embedder is not None:
            q = self._query_vec(query)
            if q is not None:
                dense = self.emb @ q
                ranks.append(np.argsort(-dense))

        fused = np.zeros(n)
        for order in ranks:
            fused[order] += 1.0 / (RRF_K + np.arange(1, n + 1))
        if bm.max() <= 0 and dense is None:
            return []
        if focus:
            fused += np.array([0.25 / RRF_K if c["accession"] == focus else 0.0 for c in self.chunks])

        out = []
        for i in np.argsort(-fused):
            c = self.chunks[i]
            if sections and c["section"] not in sections:
                continue
            out.append({**c, "score": float(fused[i]), "bm25": float(bm[i]),
                        "cosine": float(dense[i]) if dense is not None else None})
            if len(out) >= k:
                break
        return out
