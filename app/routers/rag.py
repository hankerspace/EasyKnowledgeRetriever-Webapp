"""RAG instance management router"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from app.config import settings
from app.models.config import RAGStatusResponse
from app.services.ingest_service import ingest_source_directory, ingest_state
from app.state import rag_state
from app.logger import get_logger

router = APIRouter(prefix="/rag", tags=["RAG Management"])
logger = get_logger(__name__)


class InitializeRequest(BaseModel):
    """Request for initializing RAG"""
    working_dir: str = Field(default="./rag_data", description="Working directory for RAG data")


class InitializeResponse(BaseModel):
    """Response for initialization"""
    success: bool
    message: str


@router.post("/finalize", response_model=InitializeResponse)
async def finalize_rag():
    """Finalize and save storage state"""
    logger.info("Received request to finalize RAG")
    try:
        if not rag_state.is_initialized:
            logger.warning("Attempted to finalize RAG but it is not initialized")
            raise HTTPException(status_code=400, detail="RAG is not initialized")
        
        logger.debug("Finalizing RAG state...")
        await rag_state.finalize()
        logger.info("RAG finalized successfully")
        
        return InitializeResponse(
            success=True,
            message="RAG finalized and storage saved successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to finalize RAG: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to finalize RAG: {str(e)}")


@router.get("/status", response_model=RAGStatusResponse)
async def get_rag_status():
    """Get the current RAG instance status"""
    try:
        status = rag_state.get_status()
        return RAGStatusResponse(**status)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ingest/status")
async def get_ingest_status():
    """Progress of the ingestion pass (files seen / ingested / failed).

    This is what the UI polls instead of showing an opaque 400 while the
    knowledge base is still being built.
    """
    return ingest_state.as_dict()


@router.post("/ingest", response_model=InitializeResponse)
async def trigger_ingest(background_tasks: BackgroundTasks):
    """Re-scan the source directory and ingest new documents.

    Returns immediately; poll GET /rag/ingest/status for progress. Already
    ingested documents are skipped by the library's own deduplication.
    """
    if not rag_state.is_initialized:
        raise HTTPException(status_code=400, detail="RAG is not initialized")
    if not ingest_state.is_finished:
        raise HTTPException(
            status_code=409,
            detail=f"An ingestion is already {ingest_state.status}.",
        )

    background_tasks.add_task(
        ingest_source_directory,
        settings.source_dir,
        settings.extension_list,
        settings.unsupported_extensions,
        settings.ingest_start_page,
        settings.ingest_end_page,
    )
    logger.info("Manual ingestion scheduled.")
    return InitializeResponse(success=True, message="Ingestion started in background.")
