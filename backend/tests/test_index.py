"""Guards for the embedding wrapper (a refactor once left its methods outside the class)."""
from pathlib import Path

import rag.index as index
from rag.index import Embedder


def test_embedder_exposes_query_and_passages():
    assert callable(getattr(Embedder, "query", None))
    assert callable(getattr(Embedder, "passages", None))


def test_readonly_cache_falls_back_to_tmp(monkeypatch, tmp_path):
    ro = tmp_path / "ro"
    (ro / "model").mkdir(parents=True)
    (ro / "model" / "weights.onnx").write_bytes(b"x")
    monkeypatch.setattr(index, "CACHE_DIR", ro)
    real_touch = Path.touch

    def touch(self, *a, **k):  # simulate Vercel's read-only bundle
        if self.parent == ro:
            raise OSError("read-only")
        return real_touch(self, *a, **k)

    monkeypatch.setattr(Path, "touch", touch)
    monkeypatch.setattr("tempfile.gettempdir", lambda: str(tmp_path / "tmp"))
    out = index._writable_cache()
    assert out == tmp_path / "tmp" / "fastembed"
    assert (out / "model" / "weights.onnx").read_bytes() == b"x"
