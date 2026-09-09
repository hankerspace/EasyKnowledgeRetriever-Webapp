"""FastAPI application entry point for EasyKnowledgeRetriever API"""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.config import settings
from app.logger import setup_logging, get_logger
from app.routers import (
    rag_router, query_router, database_router
)
from app.state import rag_state

# Setup logging
setup_logging()
logger = get_logger(__name__)

# Background ingestion task, kept referenced so it is not garbage collected.
_ingest_task: asyncio.Task | None = None


async def _startup_ingest():
    """Ingest the source directory. Runs in the background, never raises."""
    from app.services.ingest_service import ingest_source_directory

    try:
        await ingest_source_directory(
            settings.source_dir,
            settings.extension_list,
            settings.unsupported_extensions,
        )
    except asyncio.CancelledError:
        logger.info("Ingestion cancelled during shutdown.")
        raise
    except Exception as e:
        logger.error(f"Background ingestion crashed: {e}", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    global _ingest_task

    logger.info("Starting up EasyKnowledgeRetriever API...")
    os.makedirs(settings.working_dir, exist_ok=True)
    os.makedirs(settings.source_dir, exist_ok=True)

    logger.info(f"Working directory: {settings.working_dir}")
    logger.info(f"Source directory: {settings.source_dir}")

    try:
        # The OpenAI client builds fine without a key and only fails at call
        # time, deep inside the library, where the error is swallowed and the
        # query returns an empty answer. Fail here instead, loudly.
        missing = rag_state.missing_credentials(settings)
        if missing:
            raise RuntimeError(
                "Missing required configuration: "
                + ", ".join(missing)
                + ". Set them in .env (see .env.example)."
            )

        logger.info("Configuring RAG from settings...")
        rag_state.configure_from_settings(settings)

        logger.info("Initializing RAG...")
        await rag_state.initialize(settings.working_dir)

        # Ingestion takes minutes to hours. It MUST NOT run before the yield:
        # uvicorn accepts no connection until lifespan startup returns, so a
        # blocking ingest means the whole app 502s for its entire duration.
        if settings.auto_ingest:
            logger.info("Scheduling background ingestion...")
            _ingest_task = asyncio.create_task(_startup_ingest())
        else:
            logger.info("Auto-ingestion disabled (EKR_AUTO_INGEST=false).")

    except Exception as e:
        # Startup failure is recorded and surfaced on /health, instead of the
        # app reporting itself healthy with a dead RAG behind it.
        rag_state.record_startup_error(e)
        logger.error(f"Failed to initialize RAG at startup: {e}", exc_info=True)

    yield

    logger.info("Shutting down...")
    if _ingest_task and not _ingest_task.done():
        logger.info("Cancelling in-flight ingestion...")
        _ingest_task.cancel()
        try:
            await _ingest_task
        except (asyncio.CancelledError, Exception):
            pass

    if rag_state.is_initialized:
        try:
            logger.info("Finalizing RAG state...")
            await rag_state.finalize()
            logger.info("RAG state finalized.")
        except Exception as e:
            logger.error(f"Error finalizing RAG state: {e}")


app = FastAPI(
    title=settings.app_name,
    description="""
## EasyKnowledgeRetriever REST API

A powerful REST API for building Retrieval-Augmented Generation (RAG) systems 
with integrated Knowledge Graph support.

### Features
- **Ingestion**: Automatic background ingestion from the source directory
- **Query**: Query the knowledge base with multiple retrieval modes
- **Database Access**: Explore the knowledge graph, vector store, and KV storage

### Quick Start
Configuration is environment-only (see `.env.example`). On startup the API
initializes the RAG and ingests `EKR_SOURCE_DIR` in the background.
1. Watch progress: `GET /rag/ingest/status`
2. Wait for readiness: `GET /health/ready`
3. Query: `POST /query`
    """,
    version=__version__,
    lifespan=lifespan,
    # Docs are part of the exposed attack surface; off unless explicitly enabled.
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

# CORS: only when explicitly configured. The Docker image serves the frontend
# same-origin through nginx, so no middleware is needed there -- and
# allow_origins=["*"] with allow_credentials=True is rejected by browsers anyway.
if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

app.include_router(rag_router)
app.include_router(query_router)
app.include_router(database_router)


@app.get("/", tags=["Root"])
async def root():
    """API root endpoint"""
    return {
        "name": settings.app_name,
        "version": __version__,
        "docs": "/docs" if settings.enable_docs else None,
        "status": "running",
    }


@app.get("/health", tags=["Health"])
async def health():
    """Liveness: the process is up. Always 200 while the app is running."""
    from app.services.ingest_service import ingest_state

    return {
        "status": "healthy",
        "version": __version__,
        "rag_initialized": rag_state.is_initialized,
        "startup_error": rag_state.startup_error,
        "ingestion": ingest_state.status,
    }


@app.get("/health/ready", tags=["Health"])
async def ready():
    """Readiness: RAG initialized AND ingestion finished. 503 until then.

    This is the endpoint a load balancer or `docker healthcheck` should use.
    """
    from app.services.ingest_service import ingest_state

    is_ready = rag_state.is_initialized and ingest_state.is_finished
    payload = {
        "ready": is_ready,
        "rag_initialized": rag_state.is_initialized,
        "startup_error": rag_state.startup_error,
        "ingestion": ingest_state.as_dict(),
    }
    return JSONResponse(payload, status_code=200 if is_ready else 503)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=settings.debug,
    )
