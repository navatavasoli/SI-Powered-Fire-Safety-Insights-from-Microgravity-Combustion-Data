"""Build and load the hybrid (BM25 + dense embedding) retrieval index.

Usage:  python -m rag.index [--data data] [--embedder gemini|local]

Writes data/index/chunks.json, embeddings.npy and meta.json. The corpus is ~300 chunks,
so brute-force cosine over a numpy matrix is instant; no vector DB is needed.

Embedders (meta.json records which one built the index; queries must use the same):
  gemini (default) — Google gemini-embedding API. Keeps the deployed function small
                     (no local model) — the local stack overflowed Vercel's 225 MB limit.
  local            — fastembed (ONNX) BAAI/bge-small-en-v1.5; offline, `pip install fastembed`.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
from collections import Counter
from pathlib import Path

import numpy as np

from .corpus import build_chunks

EMBED_MODEL = "BAAI/bge-small-en-v1.5"
# Inside backend/ so the deploy build can pre-download it into the function bundle.
CACHE_DIR = Path(os.environ.get("FASTEMBED_CACHE", Path(__file__).resolve().parents[1] / ".cache" / "fastembed"))

_TOKEN = re.compile(r"[a-z0-9µ]+(?:[.-][a-z0-9]+)*")
_STOP = set("""a an and are as at be by for from has have in is it its of on or that the
this to was were which with into than then also these those their there can not""".split())


def tokenize(text: str) -> list[str]:
    toks = _TOKEN.findall(text.lower().replace("₂", "2"))
    return [t for t in toks if t not in _STOP and len(t) > 1]


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.4, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = [Counter(d) for d in docs]
        self.lens = np.array([len(d) for d in docs], dtype=float)
        self.avg = float(self.lens.mean()) if len(docs) else 1.0
        df = Counter(t for d in docs for t in set(d))
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def scores(self, query: list[str]) -> np.ndarray:
        s = np.zeros(len(self.docs))
        for t in set(query):
            idf = self.idf.get(t)
            if idf is None:
                continue
            for i, d in enumerate(self.docs):
                tf = d.get(t)
                if tf:
                    s[i] += idf * tf * (self.k1 + 1) / (tf + self.k1 * (1 - self.b + self.b * self.lens[i] / self.avg))
        return s


class Embedder:
    """Thin wrapper so tests can swap in a fake without downloading a model."""

    def __init__(self, model: str = EMBED_MODEL):
        from fastembed import TextEmbedding  # imported lazily: heavy

        self.m = TextEmbedding(model_name=model, cache_dir=str(_writable_cache()))

    def passages(self, texts: list[str]) -> np.ndarray:
        return _norm(np.array(list(self.m.passage_embed(texts)), dtype=np.float32))

    def query(self, text: str) -> np.ndarray:
        return _norm(np.array(list(self.m.query_embed([text])), dtype=np.float32))[0]


def _writable_cache() -> Path:
    """The model cache, made writable. On Vercel the bundle is read-only, so the model that
    the build step pre-downloaded is copied once per cold start into /tmp (the only writable
    path) — the loader may write lock files next to the model."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        probe = CACHE_DIR / ".write-test"
        probe.touch()
        probe.unlink()
        return CACHE_DIR
    except OSError:
        import shutil
        import tempfile

        tmp = Path(tempfile.gettempdir()) / "fastembed"
        if not tmp.exists() and CACHE_DIR.exists():
            shutil.copytree(CACHE_DIR, tmp)
        tmp.mkdir(parents=True, exist_ok=True)
        return tmp


def _norm(m: np.ndarray) -> np.ndarray:
    return m / np.clip(np.linalg.norm(m, axis=-1, keepdims=True), 1e-9, None)


GEMINI_EMBED_MODEL = "gemini-embedding-2"
GEMINI_EMBED_DIM = 768  # truncated (Matryoshka) output: small index, fast cosine


class GeminiEmbedder:
    """Embeddings via the Gemini API (no local model). Vectors are L2-normalised here."""

    provider = "gemini"

    def __init__(self, api_key: str | None = None, model: str = GEMINI_EMBED_MODEL, dim: int = GEMINI_EMBED_DIM,
                 transport=None, timeout: float = 15.0):
        import httpx

        key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY not set — needed for Gemini embeddings")
        self.model, self.dim = model, dim
        self.http = httpx.Client(base_url="https://generativelanguage.googleapis.com/v1beta", timeout=timeout,
                                 headers={"x-goog-api-key": key}, transport=transport)

    def _embed(self, text: str, task: str, retries: int = 6) -> np.ndarray:
        import time

        body = {"content": {"parts": [{"text": text}]}, "taskType": task, "outputDimensionality": self.dim}
        for attempt in range(retries):
            r = self.http.post(f"/models/{self.model}:embedContent", json=body)
            if r.status_code in (429, 500, 503) and attempt < retries - 1:
                time.sleep(min(2 ** attempt, 20))  # free-tier per-minute limits during indexing
                continue
            r.raise_for_status()
            return np.array(r.json()["embedding"]["values"], dtype=np.float32)
        raise RuntimeError("unreachable")

    def passages(self, texts: list[str]) -> np.ndarray:
        out = []
        for i, t in enumerate(texts):
            out.append(self._embed(t, "RETRIEVAL_DOCUMENT"))
            if (i + 1) % 25 == 0:
                print(f"  embedded {i + 1}/{len(texts)}")
        return _norm(np.stack(out))

    def query(self, text: str) -> np.ndarray:
        return _norm(self._embed(text, "RETRIEVAL_QUERY"))

    def meta(self) -> dict:
        return {"provider": self.provider, "model": self.model, "dim": self.dim}


Embedder.provider = "local"
Embedder.meta = lambda self: {"provider": "local", "model": EMBED_MODEL}


def embedder_for(meta: dict):
    """The query embedder matching how the index was built."""
    if meta.get("provider", "local") == "gemini":
        return GeminiEmbedder(model=meta.get("model", GEMINI_EMBED_MODEL), dim=meta.get("dim", GEMINI_EMBED_DIM))
    return Embedder(meta.get("model", EMBED_MODEL))


def build(data: Path, embedder=None) -> Path:
    chunks = build_chunks(data)
    out = data / "index"
    out.mkdir(parents=True, exist_ok=True)
    embedder = embedder or GeminiEmbedder()
    emb = embedder.passages([c["search_text"] for c in chunks])
    (out / "chunks.json").write_text(json.dumps(chunks, ensure_ascii=False, indent=0), encoding="utf-8")
    np.save(out / "embeddings.npy", emb)
    meta = {**embedder.meta(), "n": len(chunks), "dim": int(emb.shape[1])}
    (out / "meta.json").write_text(json.dumps(meta))
    print(f"{len(chunks)} chunks, {meta['provider']}:{meta['model']} dim {emb.shape[1]} -> {out}")
    return out


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, default=Path("data"))
    ap.add_argument("--embedder", choices=["gemini", "local"], default="gemini")
    a = ap.parse_args()
    build(a.data, GeminiEmbedder() if a.embedder == "gemini" else Embedder())
