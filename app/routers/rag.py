"""RAG instance management router"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.models.config import RAGStatusResponse
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
