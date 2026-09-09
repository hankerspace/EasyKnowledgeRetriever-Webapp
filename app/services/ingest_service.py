"""Source-directory ingestion, with observable state.

Ingestion is long (MinerU parsing + one LLM round-trip per chunk). It runs in
the background so the API stays available, and it reports progress instead of
losing failures in the logs.
"""
import asyncio
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.state import rag_state
from app.logger import get_logger

logger = get_logger(__name__)


@dataclass
class IngestState:
    """Observable state of the ingestion pass. Exposed on /rag/ingest/status."""

    status: str = "idle"  # idle | scanning | running | completed | failed
    total: int = 0
    ingested: int = 0
    failed: int = 0
    current_file: Optional[str] = None
    errors: List[Dict[str, str]] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)
    message: str = ""

    @property
    def is_finished(self) -> bool:
        return self.status in ("idle", "completed", "failed")

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "total": self.total,
            "ingested": self.ingested,
            "failed": self.failed,
            "current_file": self.current_file,
            "errors": self.errors,
            "skipped": self.skipped,
            "message": self.message,
        }


ingest_state = IngestState()

# Guards against two ingestion passes running at once (startup + a manual
# trigger, say) corrupting the shared storages.
_ingest_lock = asyncio.Lock()


def scan_source_directory(source_dir: str, extensions: List[str]) -> List[str]:
    """List ingestible files, sorted for a deterministic ingestion order."""
    found: List[str] = []
    for root, _, files in os.walk(source_dir):
        for name in files:
            if name.startswith("."):
                continue
            if any(name.lower().endswith(ext) for ext in extensions):
                found.append(os.path.join(root, name))
    return sorted(found)


async def ingest_source_directory(
    source_dir: str,
    extensions: List[str],
    unsupported: Optional[List[str]] = None,
) -> IngestState:
    """Ingest every supported file found under `source_dir`.

    Never raises: a failure on one document is recorded and the pass continues,
    so one bad PDF does not abort the whole corpus.
    """
    if _ingest_lock.locked():
        logger.warning("Ingestion already running, skipping this request.")
        return ingest_state

    async with _ingest_lock:
        state = ingest_state
        state.status = "scanning"
        state.ingested = state.failed = state.total = 0
        state.errors = []
        state.skipped = []
        state.current_file = None

        if unsupported:
            state.skipped = list(unsupported)
            logger.warning(
                "Ignoring unsupported extensions in EKR_ALLOWED_EXTENSIONS: %s",
                ", ".join(unsupported),
            )

        if not os.path.isdir(source_dir):
            state.status = "completed"
            state.message = f"Source directory {source_dir} does not exist. Nothing ingested."
            logger.warning(state.message)
            return state

        if not rag_state.is_initialized:
            state.status = "failed"
            state.message = "RAG is not initialized; cannot ingest."
            logger.error(state.message)
            return state

        files = scan_source_directory(source_dir, extensions)
        state.total = len(files)
        state.status = "running"
        logger.info("Found %d document(s) to ingest in %s", len(files), source_dir)

        for path in files:
            state.current_file = path
            try:
                logger.info("Ingesting %s ...", path)
                await rag_state.rag.ingest(path)
                state.ingested += 1
                logger.info("Ingested %s (%d/%d)", path, state.ingested, state.total)
            except Exception as exc:
                state.failed += 1
                state.errors.append({"file": path, "error": str(exc)})
                logger.error("Failed to ingest %s: %s", path, exc, exc_info=True)

        state.current_file = None
        state.status = "completed"
        state.message = (
            f"Ingested {state.ingested}/{state.total} document(s), {state.failed} failed."
        )
        logger.info(state.message)
        return state
