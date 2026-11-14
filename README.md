"""Thin client for the (undocumented) JSON API behind psi.nasa.gov.

Endpoints were found by inspecting the PSI search page on 2026-11-14.
They are not a published contract, so every response is cached to disk and
the dashboard reads the cache, never the live API.
"""
from __future__ import annotations

import time
from urllib.parse import quote

import requests

BASE = "https://psi.nasa.gov/geode-py/ws"
UA = "flamescope-portfolio-project (student research; contact via GitHub repo)"


class PSIClient:
    def __init__(self, delay_s: float = 1.0, timeout_s: float = 60.0):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.delay_s = delay_s
        self.timeout_s = timeout_s

    def _get(self, url: str, **params) -> requests.Response:
        r = self.s.get(url, params=params or None, timeout=self.timeout_s)
        r.raise_for_status()
        time.sleep(self.delay_s)  # be polite: this is a small public server
        return r

    def search_investigations(self, size: int = 500) -> list[dict]:
        """All investigation summaries (Elasticsearch `_source` dicts)."""
        j = self._get(f"{BASE}/repo/search", source="psi", type="investigation", size=size).json()
        return [h["_source"] for h in j["hits"]["hits"]]

    def investigation(self, accession: str) -> dict:
        """Full record: objectives, hardware, DOI, publications, file lists."""
        return self._get(f"{BASE}/repo/investigations/{accession}").json()

    def download_file(self, accession: str, file_name: str) -> bytes:
        """Download one named file. Only use for small files (tables, docs)."""
        url = f"{BASE}/studies/{accession}/download?source=datamanager&file={quote(file_name)}"
        return self._get(url).content
