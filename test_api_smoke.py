"""Smoke checks for the API, runnable with no LLM key and no network.

    python test_api_smoke.py

No EKR_LLM_API_KEY is set here, so startup is expected to fail. That is
precisely the case these tests pin down: the app must stay up, say so on
/health, and refuse readiness -- instead of reporting itself healthy with a RAG
that will silently return empty answers.
"""
import os
import sys

# Force the "no credentials" scenario regardless of any local .env: env vars
# take precedence over the env file in pydantic-settings, so these tests stay
# hermetic on a developer machine that has a working .env.
os.environ["EKR_LLM_API_KEY"] = ""
os.environ["EKR_EMBEDDING_API_KEY"] = ""

os.environ.setdefault("EKR_AUTO_INGEST", "false")
os.environ.setdefault("EKR_WORKING_DIR", "/tmp/ekr_smoke/rag_data")
os.environ.setdefault("EKR_SOURCE_DIR", "/tmp/ekr_smoke/documents")
os.environ.setdefault("EKR_ENABLE_DOCS", "false")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings, settings  # noqa: E402
from app.main import app  # noqa: E402


def test_extensions_are_filtered_to_what_the_library_supports():
    s = Settings(allowed_extensions=".pdf,.TXT, .docx ,.md,.xlsx")
    assert s.extension_list == [".pdf", ".txt", ".md"]
    assert s.unsupported_extensions == [".docx", ".xlsx"]


def test_cors_origins_parsing():
    assert Settings(cors_origins="").cors_origin_list == []
    assert Settings(cors_origins="https://a.fr, https://b.fr").cors_origin_list == [
        "https://a.fr",
        "https://b.fr",
    ]


def test_version_has_a_single_source():
    from app import __version__

    assert settings.app_version == __version__


def test_health_is_always_up_and_reports_the_truth():
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "healthy"
        # No API key in this environment => init failed => it must say so.
        assert body["rag_initialized"] is False
        assert body["startup_error"], "a failed startup must be reported"


def test_readiness_is_503_when_rag_is_down():
    with TestClient(app) as client:
        r = client.get("/health/ready")
        assert r.status_code == 503, r.text
        assert r.json()["ready"] is False


def test_docs_are_disabled_by_default():
    with TestClient(app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_stream_endpoint_refuses_cleanly_when_rag_is_down():
    """/query/stream must answer with a JSON 400 before any SSE headers go out."""
    with TestClient(app) as client:
        r = client.post("/query/stream", json={"query": "x"})
        assert r.status_code == 400, r.text
        assert "not initialized" in r.json()["detail"]


def test_documents_listing_renders_while_rag_is_down():
    """The Documents page polls this during startup: never a 4xx."""
    with TestClient(app) as client:
        r = client.get("/rag/documents")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 0
        assert body["documents"] == []
        assert body["message"]


def test_sse_event_format():
    from app.routers.query import _sse

    assert _sse("token", {"text": "a\nb"}) == 'event: token\ndata: {"text": "a\\nb"}\n\n'


def test_query_refuses_cleanly_when_rag_is_not_initialized():
    with TestClient(app) as client:
        r = client.post("/query", json={"query": "test"})
        assert r.status_code == 400, r.text
        assert "not initialized" in r.json()["detail"]


def test_missing_llm_key_is_a_startup_error():
    """No credentials must be caught at startup, not at the first query."""
    from app.state import rag_state

    assert rag_state.missing_credentials(Settings(llm_api_key=None)) == ["EKR_LLM_API_KEY"]
    assert rag_state.missing_credentials(Settings(llm_api_key="sk-x")) == []


def test_embedding_key_falls_back_to_the_llm_key():
    from app.state import RAGState

    state = RAGState()
    state.configure_from_settings(Settings(llm_api_key="sk-shared", embedding_api_key=None))
    assert state.get_current_config()["embedding"]["api_key"] == "sk-shared"


def test_graph_endpoints_reject_absurd_limits():
    with TestClient(app) as client:
        assert client.get("/db/graph/nodes?limit=100000").status_code == 422
        assert client.get("/db/graph/nodes?limit=0").status_code == 422
        # Within bounds it gets past validation (400: RAG not initialized here).
        assert client.get("/db/graph/nodes?limit=500").status_code == 400


def test_ingest_status_is_exposed():
    with TestClient(app) as client:
        r = client.get("/rag/ingest/status")
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("status", "total", "ingested", "failed", "errors", "skipped"):
            assert key in body, key


def test_scan_finds_only_supported_files():
    from app.services.ingest_service import scan_source_directory

    d = "/tmp/ekr_smoke/scan"
    os.makedirs(d, exist_ok=True)
    for name in ("a.pdf", "b.txt", "c.docx", ".hidden.pdf", "d.md"):
        open(os.path.join(d, name), "w").close()
    found = [os.path.basename(f) for f in scan_source_directory(d, [".pdf", ".txt", ".md"])]
    assert found == ["a.pdf", "b.txt", "d.md"], found


def test_already_ingested_matches_processed_docs_by_path():
    """A document already in the store must not go through MinerU again."""
    import asyncio
    from app.services.ingest_service import already_ingested

    class Store:
        async def get_doc_by_file_path(self, path):
            return {
                "/data/done.pdf": ("doc-1", {"status": "processed", "file_path": path}),
                "/data/broken.pdf": ("doc-2", {"status": "failed", "file_path": path}),
            }.get(path)

    class Rag:
        doc_status = Store()

    run = asyncio.run
    assert run(already_ingested(Rag(), "/data/done.pdf")) is True
    assert run(already_ingested(Rag(), "/data/broken.pdf")) is False   # retry failures
    assert run(already_ingested(Rag(), "/data/new.pdf")) is False


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"ok    {t.__name__}")
        except Exception as exc:
            failures += 1
            print(f"FAIL  {t.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
