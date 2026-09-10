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

## API surface used by the UI

| Endpoint | Purpose |
|---|---|
| `POST /query` | One-shot JSON answer, with the chunks and references the answer cites. |
| `POST /query/stream` | Same request, answered as Server-Sent Events: `status` (`retrieving` → `generating`), `context` (chunks, references, entity/relation counts), `token`, `done`, `error`. |
| `GET /rag/ingest/status` | Progress of the ingestion pass (files seen / ingested / failed, current file, errors). |
| `GET /rag/documents` | Documents in the library's status store (status, chunk count, size, timestamps, error). |
| `POST /rag/ingest` | Re-scan the source directory in the background (409 while a pass is running). |

The frontend (`frontend/`) is built on [shadcn/ui](https://ui.shadcn.com): the
Assistant page streams answers and shows, next to each passage, the document
and page that support it; clicking a citation opens the verbatim of the
retrieved chunk(s). The Documents page follows ingestion live.

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

### Library version

`requirements.txt` requires **>= 1.3.0**: that is the first release where the
embedding encoding format is configurable, which OpenAI-compatible gateways
need. To build against the library repository instead of PyPI:

```bash
docker compose build --build-arg \
  EKR_PACKAGE="easy-knowledge-retriever[pdf] @ git+https://github.com/hankerspace/EasyKnowledgeRetriever@main"
```

### Image size

The `[pdf]` extra pulls torch. By default the build installs the **CPU** wheel:
left to the default index, torch drags in the whole CUDA stack (cuDNN alone is
~650 MB) and the image grows by several GB on a host with no GPU. On an actual
GPU host:

```bash
docker compose build --build-arg TORCH_VARIANT=default
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
| `EKR_EMBEDDING_ENCODING_FORMAT` | `base64` | Set to `float` for gateways that reject base64 with a 422. |
| `EKR_RERANKER_MODEL` / `_BASE_URL` | *(none)* | Optional cross-encoder rerank. The base URL is the **full** endpoint, `/rerank` included. |
| `EKR_INGEST_START_PAGE` / `_END_PAGE` | *(none)* | Ingest a page slice, to measure cost before a long document. |
| `AUTH_USER` / `AUTH_PASSWORD` | *(none)* | Both must be set, or **the app is served with no authentication**. |

## Deployment notes

- **TLS is not handled here.** The compose file publishes on `127.0.0.1` only.
  Put a TLS-terminating proxy (Caddy, Traefik, nginx) in front before exposing
  it: basic auth over plain HTTP sends the password in clear.
- **Back up `rag_data/`.** Rebuilding it costs hours of LLM calls and real money.
- The `ekr_models` volume holds the MinerU model cache; do not prune it casually.

## Troubleshooting

Every entry here is a bug that actually happened in this image. The Dockerfile
and CI now guard against them; this is the reference for when something new
looks similar.

### Ingestion reports 0 documents with "Mineru failed: ImportError: libxcb.so.1"

OpenCV arrives through MinerU and links X11/GL libraries that `python:*-slim`
does not ship — including in the *headless* OpenCV build, which still needs
`libxcb.so.1`. The image builds fine; the failure only appears once a PDF is
parsed, inside a subprocess.

The Dockerfile installs `libgl1 libglib2.0-0 libxcb1 libsm6 libxext6
libxrender1`. On startup the app now probes the toolchain and reports the
result on `GET /health` (`preflight_error`), so a broken image says so in
seconds instead of failing per document.

### `--build-arg EKR_PACKAGE=...@main` installs a stale commit

The `RUN pip install "$EKR_PACKAGE"` layer is cached on the *argument value*,
not on what the branch points at. Pushing a new commit and rebuilding with the
same `@main` argument silently reuses the old layer, and the build then fails
on a version requirement it should satisfy. Pin the commit instead -- it busts
the cache and makes the build reproducible:

```bash
docker compose build --build-arg \
  EKR_PACKAGE="easy-knowledge-retriever[pdf] @ git+https://github.com/hankerspace/EasyKnowledgeRetriever@<commit-sha>"
```

### Ingestion fails with "HybridDependencyError: `hybrid-transformers` requires ..."

MinerU's default backend needs its local pipeline dependencies. The library's
`[pdf]` extra must install `mineru[core]`, not bare `mineru` -- fixed in
easy-knowledge-retriever 1.3.1. Nothing fails at install time; it only breaks
on the first real document.

### Ingestion fails with "operator torchvision::nms does not exist"

`torch` and `torchvision` must come from the **same** wheel index. Installing
torch from the CPU index while pip resolves torchvision from PyPI gives two
builds compiled against different torch versions; the C++ operator registration
fails at import. It surfaces late, when `doclayout_yolo` loads during a PDF
parse. The Dockerfile installs both in one command from one index.

### The image is ~10GB instead of ~3GB

`torch` must be installed from the CPU wheel index **before** anything that
depends on it. Installed afterwards, the `[pdf]` extra resolves torch from the
default index first, pulling the whole CUDA stack (cuDNN alone is 650MB);
installing the CPU build later swaps torch but leaves ~8GB of `nvidia-*`
wheels behind. Order in the Dockerfile matters — do not move that step.

On a GPU host: `docker compose build --build-arg TORCH_VARIANT=default`.

### `--build-arg EKR_PACKAGE=...git+https://...` fails with "Cannot find command 'git'"

`python:*-slim` has no git and pip shells out to it for `git+` URLs. The
Dockerfile installs git for exactly this reason.

### Queries return 504 after about a minute

nginx defaults to a 60s `proxy_read_timeout`, and a RAG query with decomposition
and reranking runs longer. `nginx.conf` sets 600s. If you replace that file,
keep `user www-data;` too: without it workers run as nobody, cannot read
`.htpasswd`, and **every authenticated request returns 500**.

### Ingestion says "completed" but the index is empty

Two independent causes, both fixed here:

- **The library swallows failures.** `rag.ingest()` can return cleanly while
  recording the document as FAILED. The app now reads document statuses back
  after each pass and folds them into `GET /rag/ingest/status`.
- **Embedding format.** The OpenAI SDK requests base64-encoded embeddings.
  Many OpenAI-*compatible* gateways accept only `float` and answer **422**.
  Set `EKR_EMBEDDING_ENCODING_FORMAT=float` (library >= 1.3.0).

### Retrieval returns irrelevant results

Check `EKR_EMBEDDING_DIM` against the model. It is not cosmetic: a mismatch
builds an index that cannot be searched properly. `text-embedding-3-small` is
1536, **`bge-m3` is 1024**. Changing the model or the dimension means rebuilding
`rag_data/` from scratch.

### Ingestion runs for hours

Expected on a long document: MinerU parses on CPU, then the library makes one
LLM call per chunk. Two levers:

- `EKR_MAX_ASYNC` / `EKR_EMBEDDING_MAX_ASYNC` default to 1 in the library —
  every call is serialized. Raise them to match your provider's rate limits.
- `EKR_INGEST_START_PAGE` / `EKR_INGEST_END_PAGE` ingest a slice first, so you
  can measure cost per page before committing to the whole document.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness. No auth. Always 200 while the process runs. Reports `startup_error` and `preflight_error`. |
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
