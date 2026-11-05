import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import llm
from app.config import Settings, get_settings
from app.main import app
from app.schemas import ChatMessage

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_chat_validation_rejects_empty_messages():
    assert client.post("/api/chat", json={"messages": []}).status_code == 422


def test_chat_validation_rejects_bad_role():
    body = {"messages": [{"role": "root", "content": "hi"}]}
    assert client.post("/api/chat", json=body).status_code == 422


def test_chat_success(monkeypatch):
    async def fake_chat(settings, messages, provider):
        return llm.LLMResult("hello", "ollama", "qwen3:1.7b", 12, 5, 2)

    monkeypatch.setattr(llm, "chat", fake_chat)
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200
    assert r.json()["reply"] == "hello"
    assert r.json()["completion_tokens"] == 2


def test_chat_provider_error_maps_to_502(monkeypatch):
    async def boom(settings, messages, provider):
        raise llm.LLMError("Ollama is not reachable.")

    monkeypatch.setattr(llm, "chat", boom)
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 502


def test_strip_thinking():
    assert llm.strip_thinking("<think>x\ny</think>\nAnswer") == "Answer"


@pytest.mark.asyncio
async def test_cloud_requires_key():
    s = Settings(cloud_api_key=SecretStr(""))
    with pytest.raises(llm.LLMError):
        await llm.chat(s, [ChatMessage(role="user", content="hi")], "cloud")


@pytest.mark.asyncio
async def test_ollama_unreachable_is_llm_error():
    s = Settings(ollama_base_url="http://127.0.0.1:1")
    with pytest.raises(llm.LLMError):
        await llm.chat(s, [ChatMessage(role="user", content="hi")], "ollama")


@pytest.mark.asyncio
async def test_ollama_parsing(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "message": {"content": "<think>hmm</think>ok"},
                "prompt_eval_count": 7,
                "eval_count": 3,
            },
        )

    real = httpx.AsyncClient
    monkeypatch.setattr(
        llm.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )
    res = await llm.chat(Settings(), [ChatMessage(role="user", content="hi")], "ollama")
    assert res.text == "ok" and res.prompt_tokens == 7 and res.completion_tokens == 3


def test_llm_status_offline():
    app.dependency_overrides[get_settings] = lambda: Settings(ollama_base_url="http://127.0.0.1:1")
    try:
        r = client.get("/api/llm/status")
        assert r.status_code == 200
        assert r.json()["ollama_reachable"] is False
    finally:
        app.dependency_overrides.clear()
