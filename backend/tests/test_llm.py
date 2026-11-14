"""Offline tests for the Gemini provider (mocked HTTP; no key or network needed)."""
from __future__ import annotations

import json

import httpx
import pytest

from rag.llm import GeminiLLM, LLMError, from_env

MODELS = {"models": [
    {"name": "models/gemini-2.0-flash", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.0-flash-preview", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.5-flash-image", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
]}


def transport(reply=None, status=200, models=MODELS, seen=None):
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["x-goog-api-key"] == "k"       # key in header…
        assert "key=" not in str(req.url)                  # …never in the URL
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=models)
        if seen is not None:
            seen.append(json.loads(req.content))
        return httpx.Response(status, json=reply if reply is not None else {})
    return httpx.MockTransport(handler)


def test_picks_newest_flash_preferring_stable_full_models():
    # 3.0 is newest but preview-only → still chosen over 2.5 (generation ranks first)
    assert GeminiLLM("k", transport=transport()).model == "gemini-3.0-flash-preview"
    stable = {"models": [m for m in MODELS["models"] if "3.0" not in m["name"]]}
    m = GeminiLLM("k", transport=transport(models=stable)).model
    assert m == "gemini-2.5-flash"  # not -lite, not -image, not pro


def test_explicit_model_skips_listing():
    assert GeminiLLM("k", model="models/gemini-2.0-flash", transport=transport(models={"models": []})).model == "gemini-2.0-flash"


def test_json_mode_request_and_parse():
    seen: list = []
    reply = {"candidates": [{"content": {"parts": [{"text": '{"findings": [], "interpretation": "ok"}'}]}}]}
    llm = GeminiLLM("k", model="gemini-2.5-flash", transport=transport(reply, seen=seen))
    out = llm.complete_json("SYS", [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"},
                                    {"role": "user", "content": "q2"}])
    assert out == {"findings": [], "interpretation": "ok"}
    body = seen[0]
    assert body["systemInstruction"]["parts"][0]["text"] == "SYS"
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]
    assert body["generationConfig"]["responseMimeType"] == "application/json"


@pytest.mark.parametrize("status,reply,msg", [
    (429, {}, "quota"),
    (400, {"error": "bad"}, "Gemini error 400"),
    (200, {"promptFeedback": {"blockReason": "SAFETY"}}, "SAFETY"),
    (200, {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}, "invalid JSON"),
])
def test_errors_become_llm_errors(status, reply, msg):
    llm = GeminiLLM("k", model="gemini-2.5-flash", transport=transport(reply, status=status))
    with pytest.raises(LLMError, match=msg):
        llm.complete_json("s", [{"role": "user", "content": "q"}])


def test_falls_back_when_newest_model_is_overloaded_and_sticks():
    calls = []
    ok = {"candidates": [{"content": {"parts": [{"text": '{"findings": []}'}]}}]}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=MODELS)
        model = req.url.path.split("/models/")[1].split(":")[0]
        calls.append(model)
        if model == "gemini-3.0-flash-preview":          # newest: overloaded (the real failure seen)
            return httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}})
        return httpx.Response(200, json=ok)

    llm = GeminiLLM("k", transport=httpx.MockTransport(handler), backoff_s=0)
    assert llm.complete_json("s", [{"role": "user", "content": "q"}]) == {"findings": []}
    assert calls == ["gemini-3.0-flash-preview", "gemini-2.5-flash"]
    assert llm.name == "gemini:gemini-2.5-flash"        # sticks with the model that answered
    llm.complete_json("s", [{"role": "user", "content": "q"}])
    assert calls[-1] == "gemini-2.5-flash"


def test_failed_model_is_skipped_during_cooldown():
    calls = []
    ok = {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}

    def handler(req):
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=MODELS)
        m = req.url.path.split("/models/")[1].split(":")[0]
        calls.append(m)
        return httpx.Response(503, json={}) if m == "gemini-3.0-flash-preview" else httpx.Response(200, json=ok)

    llm = GeminiLLM("k", transport=httpx.MockTransport(handler), backoff_s=0)
    llm.complete_json("s", [{"role": "user", "content": "q"}])
    llm._use("gemini-3.0-flash-preview")         # even if pointed back at the busy model…
    llm.complete_json("s", [{"role": "user", "content": "q"}])
    assert calls.count("gemini-3.0-flash-preview") == 1   # …it isn't retried while cooling down


def test_hanging_model_times_out_and_falls_back():
    ok = {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}

    def handler(req):
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=MODELS)
        if "3.0-flash" in req.url.path:
            raise httpx.ReadTimeout("hung", request=req)
        return httpx.Response(200, json=ok)

    llm = GeminiLLM("k", transport=httpx.MockTransport(handler), backoff_s=0)
    assert llm.complete_json("s", [{"role": "user", "content": "q"}]) == {}
    assert llm.model == "gemini-2.5-flash"


def test_after_a_hang_the_next_model_still_gets_tried(monkeypatch):
    """Regression: the first model hanging for the full per-model timeout must not use up
    the whole budget (seen in production: only one model was ever tried)."""
    import rag.llm as L
    clock = [0.0]
    monkeypatch.setattr(L.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(L.time, "sleep", lambda s: None)
    ok = {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
    tried = []

    def handler(req):
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=MODELS)
        m = req.url.path.split("/models/")[1].split(":")[0]
        tried.append(m)
        if m == "gemini-3.0-flash-preview":
            clock[0] += L.GeminiLLM.PER_MODEL_S          # burns its whole allowance
            raise httpx.ReadTimeout("hung", request=req)
        return httpx.Response(200, json=ok)

    llm = GeminiLLM("k", transport=httpx.MockTransport(handler), backoff_s=0)
    assert llm.complete_json("s", [{"role": "user", "content": "q"}]) == {}
    assert tried == ["gemini-3.0-flash-preview", "gemini-2.5-flash"]


def test_all_models_busy_raises_with_reasons():
    t = httpx.MockTransport(lambda req: httpx.Response(200, json=MODELS) if req.url.path.endswith("/models")
                            else httpx.Response(503, json={}))
    llm = GeminiLLM("k", transport=t, backoff_s=0)
    with pytest.raises(LLMError, match="all Gemini models busy.*503 overloaded"):
        llm.complete_json("s", [{"role": "user", "content": "q"}])


def test_bad_key_is_reported_clearly():
    t = httpx.MockTransport(lambda req: httpx.Response(400, json={"error": {"message": "API key not valid"}}))
    with pytest.raises(LLMError, match="rejected the API key"):
        GeminiLLM("k", transport=t)


def test_from_env_provider_selection(monkeypatch):
    for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "LLM_PROVIDER"):
        monkeypatch.delenv(k, raising=False)
    assert from_env() is None
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-flash")   # avoids a network model listing
    assert from_env().name == "gemini:gemini-2.5-flash"
