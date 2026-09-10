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
    existing: int = 0  # found in the store already, not re-parsed
    failed: int = 0
    current_file: Optional[str] = None
    errors: List[Dict[str, str]] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)
    message: str = ""
    preflight_error: Optional[str] = None

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
            "preflight_error": self.preflight_error,
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


async def already_ingested(rag, path: str) -> bool:
    """True when the store holds a PROCESSED document for this exact path.

    The library only deduplicates by content hash, i.e. after a full MinerU
    parse (hours on a big PDF). Checking the path first makes a restart free.
    ponytail: a file modified in place under the same name is skipped too;
    delete its entry from the doc-status store (or rename it) to re-ingest.
    """
    try:
        found = await rag.doc_status.get_doc_by_file_path(path)
    except Exception as exc:  # a broken lookup must not block ingestion
        logger.warning("Could not look up %s in the doc-status store: %s", path, exc)
        return False
    if not found:
        return False
    status = found[1].get("status")
    return getattr(status, "value", status) == "processed"


async def ingest_source_directory(
    source_dir: str,
    extensions: List[str],
    unsupported: Optional[List[str]] = None,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
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
        state.ingested = state.existing = state.failed = state.total = 0
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

        if state.preflight_error and any(f.lower().endswith(".pdf")
                                         for f in scan_source_directory(source_dir, extensions)):
            state.status = "failed"
            state.message = (
                "PDF ingestion is unavailable in this image: "
                f"{state.preflight_error}"
            )
            logger.error(state.message)
            return state

        files = scan_source_directory(source_dir, extensions)
        state.total = len(files)
        state.status = "running"
        logger.info("Found %d document(s) to ingest in %s", len(files), source_dir)

        for path in files:
            if await already_ingested(rag_state.rag, path):
                state.existing += 1
                logger.info("Skipping %s: already in the knowledge base", path)
                continue
            state.current_file = path
            try:
                logger.info("Ingesting %s ...", path)
                kwargs = {}
                if start_page is not None:
                    kwargs["start_page"] = start_page
                if end_page is not None:
                    kwargs["end_page"] = end_page
                await rag_state.rag.ingest(path, **kwargs)
                state.ingested += 1
                logger.info("Ingested %s (%d/%d)", path, state.ingested, state.total)
            except Exception as exc:
                state.failed += 1
                state.errors.append({"file": path, "error": str(exc)})
                logger.error("Failed to ingest %s: %s", path, exc, exc_info=True)

        state.current_file = None

        # rag.ingest() returns cleanly even when the pipeline failed downstream
        # (an embedding 422, say): the library records the failure on the
        # document instead of raising. Without this check the API would report
        # a successful ingestion over an empty index.
        await _record_failed_documents(state)

        state.status = "completed"
        state.message = (
            f"Ingested {state.ingested}/{state.total} document(s), "
            f"{state.existing} already present, {state.failed} failed."
        )
        logger.info(state.message)
        return state


async def _record_failed_documents(state: IngestState) -> None:
    """Fold documents the library marked FAILED into the reported state."""
    try:
        from easy_knowledge_retriever.kg.kv_storage.base import DocStatus

        failed_docs = await rag_state.rag.doc_status.get_docs_by_status(DocStatus.FAILED)
    except Exception as exc:  # never let the check itself break ingestion
        logger.warning("Could not read document statuses: %s", exc)
        return

    already = {e["file"] for e in state.errors}
    for doc_id, doc in (failed_docs or {}).items():
        path = getattr(doc, "file_path", None) or doc_id
        if path in already:
            continue
        reason = getattr(doc, "error_msg", None) or getattr(doc, "error", None) or "marked FAILED by the library"
        state.errors.append({"file": path, "error": str(reason)})
        state.failed += 1
        state.ingested = max(0, state.ingested - 1)
        logger.error("Document %s reported FAILED after ingestion: %s", path, reason)
