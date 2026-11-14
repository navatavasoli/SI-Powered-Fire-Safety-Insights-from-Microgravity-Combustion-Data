"""LLM providers behind one small interface: Google Gemini or Groq (both have free tiers).

Configure in .env (see .env.example):
  GEMINI_API_KEY=...          Gemini (preferred if set)
  GROQ_API_KEY=...            Groq
  LLM_PROVIDER=gemini|groq    optional, when both keys are set
  GEMINI_MODEL / GROQ_MODEL   optional; otherwise picked from what the key can access
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Protocol

import httpx

GROQ_URL = "https://api.groq.com/openai/v1"
# Tried in order against the models the key can actually see (Groq retires models).
PREFERRED = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b",
             "meta-llama/llama-4-maverick-17b-128e-instruct", "llama-3.1-8b-instant"]


class LLMError(RuntimeError):
    pass


class LLM(Protocol):
    name: str

    def complete_json(self, system: str, messages: list[dict], max_tokens: int = 1200) -> dict: ...


class GroqLLM:
    def __init__(self, api_key: str, model: str | None = None, timeout: float = 60.0):
        self.http = httpx.Client(base_url=GROQ_URL, timeout=timeout,
                                 headers={"Authorization": f"Bearer {api_key}"})
        self.model = model or self._pick_model()
        self.name = f"groq:{self.model}"

    def _pick_model(self) -> str:
        try:
            r = self.http.get("/models")
            r.raise_for_status()
            have = {m["id"] for m in r.json().get("data", [])}
        except httpx.HTTPError as e:
            raise LLMError(f"could not list Groq models: {e}") from e
        for m in PREFERRED:
            if m in have:
                return m
        raise LLMError(f"none of {PREFERRED} available; set GROQ_MODEL (have: {sorted(have)[:10]})")

    def complete_json(self, system: str, messages: list[dict], max_tokens: int = 1200) -> dict:
        body = {
            "model": self.model, "temperature": 0.2, "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, *messages],
        }
        try:
            r = self.http.post("/chat/completions", json=body)
        except httpx.HTTPError as e:
            raise LLMError(f"Groq request failed: {e}") from e
        if r.status_code == 429:
            raise LLMError("Groq rate limit reached (free tier). Try again shortly.")
        if r.status_code >= 400:
            raise LLMError(f"Groq error {r.status_code}: {r.text[:300]}")
        content = r.json()["choices"][0]["message"]["content"]
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise LLMError(f"model returned invalid JSON: {content[:200]}") from e


GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"
_GEMINI_SKIP = re.compile(r"image|tts|audio|live|embed|vision|learnlm|gemma|robotics|computer-use|exp|omni", re.I)


class _Transient(Exception):
    """A per-model failure where another model may still answer."""


class GeminiLLM:
    """Google Gemini via the native generateContent API, in JSON output mode."""

    # Statuses worth trying another model for: overloaded, per-model quota, server error, retired.
    TRANSIENT = {404, 429, 500, 503, 504}
    MAX_MODELS = 5
    # Overloaded models often hang instead of refusing, so cap each attempt and the whole
    # answer; a model that just failed is skipped for a while rather than waited on again.
    PER_MODEL_S = 20.0
    BUDGET_S = 55.0
    MIN_ATTEMPT_S = 8.0  # don't start an attempt with less time than this left
    COOLDOWN_S = 600.0

    def __init__(self, api_key: str, model: str | None = None, timeout: float | None = None, transport=None,
                 backoff_s: float = 0.6):
        # Key goes in a header, never the URL, so it can't end up in logs.
        t = httpx.Timeout(timeout or self.PER_MODEL_S, connect=10.0)
        self.http = httpx.Client(base_url=GEMINI_URL, timeout=t, headers={"x-goog-api-key": api_key},
                                 transport=transport)
        self.backoff_s = backoff_s
        self._cool: dict[str, float] = {}  # model -> monotonic time it may be retried
        # A pinned GEMINI_MODEL is used alone; otherwise a ranked fallback list.
        self.candidates = [model.removeprefix("models/")] if model else self._rank_models()
        self._use(self.candidates[0])

    def _use(self, model: str):
        self.model = model
        self.name = f"gemini:{model}"

    def _rank_models(self) -> list[str]:
        """Flash models the key can call, best first (Flash = the free-tier workhorse)."""
        try:
            r = self.http.get("/models", params={"pageSize": 200})
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (400, 401, 403):
                raise LLMError("Gemini rejected the API key (check GEMINI_API_KEY in .env)") from e
            raise LLMError(f"could not list Gemini models: {e}") from e
        except httpx.HTTPError as e:
            raise LLMError(f"could not reach Gemini: {e}") from e
        names = [m["name"].removeprefix("models/") for m in r.json().get("models", [])
                 if "generateContent" in m.get("supportedGenerationMethods", [])]
        flash = [n for n in names if "flash" in n and not _GEMINI_SKIP.search(n)]

        def rank(n: str):
            v = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
            return (float(v.group(1)) if v else 0.0,      # newest generation first
                    "preview" not in n,                     # stable over preview
                    "lite" not in n,                        # full Flash over Flash-Lite
                    "latest" not in n)                      # pinned name over alias
        if not flash:
            raise LLMError(f"no Gemini Flash model available; set GEMINI_MODEL (have: {names[:8]})")
        return sorted(flash, key=rank, reverse=True)

    def complete_json(self, system: str, messages: list[dict], max_tokens: int = 1200) -> dict:
        """Try the current model, then fall through the ranked list on overload/quota/retirement.
        The first model that answers becomes the default for later calls."""
        start = self.candidates.index(self.model) if self.model in self.candidates else 0
        ring = self.candidates[start:] + self.candidates[:start]
        now = time.monotonic()
        ready = [m for m in ring if self._cool.get(m, 0) <= now]
        # If everything is cooling down, still try the best one rather than give up.
        order = (ready or ring[:1])[: self.MAX_MODELS]
        errors, t0 = [], time.monotonic()
        for i, m in enumerate(order):
            if i:
                time.sleep(self.backoff_s)
            # Each attempt gets what's left of the budget (capped), so one hung model
            # still leaves room to try the next one.
            left = self.BUDGET_S - (time.monotonic() - t0)
            if left < self.MIN_ATTEMPT_S:
                errors.append("time budget exhausted")
                break
            try:
                out = self._complete(m, system, messages, max_tokens, timeout=min(self.PER_MODEL_S, left))
            except _Transient as e:
                errors.append(f"{m}: {e}")
                self._cool[m] = time.monotonic() + self.COOLDOWN_S
                continue
            self._cool.pop(m, None)
            self._use(m)
            return out
        raise LLMError("all Gemini models busy or unavailable — " + "; ".join(errors))

    def _complete(self, model: str, system: str, messages: list[dict], max_tokens: int,
                  timeout: float | None = None) -> dict:
        contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                    for m in messages]
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": contents,
            # Headroom for models that spend output tokens on internal reasoning.
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": max(max_tokens, 4096),
                                 "responseMimeType": "application/json"},
        }
        try:
            r = self.http.post(f"/models/{model}:generateContent", json=body,
                               timeout=httpx.Timeout(timeout, connect=10.0) if timeout else httpx.USE_CLIENT_DEFAULT)
        except httpx.TimeoutException as e:
            raise _Transient("timed out") from e
        except httpx.HTTPError as e:
            raise LLMError(f"Gemini request failed: {e}") from e
        if r.status_code in self.TRANSIENT:
            msg = {429: "rate limit / free-tier quota", 503: "overloaded", 404: "not available"}.get(r.status_code, "server error")
            raise _Transient(f"{r.status_code} {msg}")
        if r.status_code >= 400:
            raise LLMError(f"Gemini error {r.status_code}: {r.text[:300]}")
        data = r.json()
        try:
            cand = data["candidates"][0]
            text = "".join(p.get("text", "") for p in cand["content"]["parts"])
        except (KeyError, IndexError) as e:
            reason = (data.get("promptFeedback") or {}).get("blockReason") or \
                     (data.get("candidates") or [{}])[0].get("finishReason")
            raise LLMError(f"Gemini returned no text ({reason or 'unknown reason'})") from e
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMError(f"model returned invalid JSON: {text[:200]}") from e


def from_env() -> LLM | None:
    """The configured LLM, or None (the copilot then answers retrieval-only).

    LLM_PROVIDER=gemini|groq picks explicitly; otherwise whichever key is set (Gemini first).
    """
    gemini = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    groq = os.environ.get("GROQ_API_KEY", "").strip()
    provider = os.environ.get("LLM_PROVIDER", "").strip().lower() or ("gemini" if gemini else "groq" if groq else "")
    if provider == "gemini" and gemini:
        return GeminiLLM(gemini, os.environ.get("GEMINI_MODEL") or None)
    if provider == "groq" and groq:
        return GroqLLM(groq, os.environ.get("GROQ_MODEL") or None)
    return None
