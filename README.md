# EasyKnowledgeRetriever WebApp

Web application (Backend + Frontend) providing a graphical interface for the
[EasyKnowledgeRetriever](https://github.com/hankerspace/EasyKnowledgeRetriever)
library: configure a RAG pipeline, ingest documents, explore the knowledge base
(graph and vectors) and query it through a chat interface.

## Architecture

- **Backend (`app/`)** — FastAPI REST API. Orchestrates the RAG, exposes query
  and database endpoints. Bound to `127.0.0.1:8000`; never exposed directly.
- **Frontend (`frontend/`)** — React + Vite + TailwindCSS.
- **Docker image** — a single container running nginx (TLS-less reverse proxy,
  basic auth, static frontend) and uvicorn under supervisord.

Configuration is **environment-only**. There is no configuration API.

## Quick start (Docker, recommended)

```bash
cp .env.example .env
# Set at least EKR_LLM_API_KEY, AUTH_USER and AUTH_PASSWORD.
# Generate a password: openssl rand -base64 24

mkdir -p documents rag_data
cp /path/to/your.pdf documents/

docker compose up -d --build
```

The UI is on <http://127.0.0.1:85>. The API answers immediately; ingestion runs
in the **background** and can take hours on a large corpus.

```bash
curl -s localhost:85/health              # liveness, no auth needed
curl -s localhost:85/rag/ingest/status   # ingestion progress
curl -s localhost:85/health/ready        # 503 until RAG is up AND ingest done
```

### Before publishing library version 1.2.5

`requirements.txt` targets `easy-knowledge-retriever[pdf]>=1.2.5`. Until that
release is on PyPI, build against the library repository directly:

```bash
docker compose build --build-arg \
  EKR_PACKAGE="easy-knowledge-retriever[pdf] @ git+https://github.com/hankerspace/EasyKnowledgeRetriever@main"
```

### First-run model download

MinerU downloads several GB of layout/OCR models on the first PDF ingestion.
They are cached in the `ekr_models` volume, so this happens once. To bake them
into the image instead (slower build, fast and offline-capable first run):

```bash
docker compose build --build-arg PREFETCH_MINERU_MODELS=true
```

## Local development

Two terminals.

**Backend:**
```bash
pip install -r requirements.txt
cp .env.example .env      # then fill in EKR_LLM_API_KEY
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend && npm install && npm run dev
```
Vite proxies `/rag`, `/query`, `/db` and `/health` to `localhost:8000`.

**Tests** (no LLM key, no network required):
```bash
python test_api_smoke.py
```

## Configuration

Every setting is documented in [`.env.example`](.env.example). The ones that
matter most:

| Variable | Default | Notes |
|---|---|---|
| `EKR_LLM_API_KEY` | *(none)* | **Required.** Startup fails loudly without it. |
| `EKR_EMBEDDING_API_KEY` | *(falls back to the LLM key)* | Same provider in the common case. |
| `EKR_EMBEDDING_MODEL` / `EKR_EMBEDDING_DIM` | `text-embedding-3-small` / `1536` | Changing either **invalidates the index**: rebuild `rag_data/` from scratch. |
| `EKR_ALLOWED_EXTENSIONS` | `.pdf,.txt,.md` | Unsupported extensions are reported under `skipped`, not silently dropped. |
| `EKR_AUTO_INGEST` | `true` | Set `false` to ingest out-of-band via `POST /rag/ingest`. |
| `EKR_ENABLE_DOCS` | `false` | Exposes `/docs`, `/redoc`, `/openapi.json`. |
| `EKR_MAX_ASYNC` | `4` | Concurrent LLM calls. `1` (library default) is very slow; raise to match your provider's rate limits. |
| `AUTH_USER` / `AUTH_PASSWORD` | *(none)* | Both must be set, or **the app is served with no authentication**. |

## Deployment notes

- **TLS is not handled here.** The compose file publishes on `127.0.0.1` only.
  Put a TLS-terminating proxy (Caddy, Traefik, nginx) in front before exposing
  it: basic auth over plain HTTP sends the password in clear.
- **Back up `rag_data/`.** Rebuilding it costs hours of LLM calls and real money.
- The `ekr_models` volume holds the MinerU model cache; do not prune it casually.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness. No auth. Always 200 while the process runs. |
| `GET` | `/health/ready` | Readiness. 503 until RAG is initialized and ingestion has finished. |
| `GET` | `/rag/status` | Current RAG configuration. |
| `GET` | `/rag/ingest/status` | Files seen / ingested / failed, with per-file errors. |
| `POST` | `/rag/ingest` | Re-scan the source directory (returns immediately). |
| `POST` | `/query` | Ask a question. |
| `POST` | `/query/context` | Retrieved context only, no generation. |
| `GET` | `/db/graph/nodes`, `/db/graph/edges` | Paginated graph access. |

## License

This application is MIT.

> **Note**: it depends on `easy-knowledge-retriever`, which is licensed
> **CC BY-NC-SA 4.0** (NonCommercial). Any commercial deployment requires
> separate permission from the library's author.
