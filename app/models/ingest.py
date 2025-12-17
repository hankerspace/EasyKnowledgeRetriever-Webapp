"""Ingestion Pydantic models"""
from typing import Optional, List
from pydantic import BaseModel, Field
from enum import Enum


class IngestionStatus(str, Enum):
    """Ingestion status enum"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class IngestTextRequest(BaseModel):
    """Request for ingesting raw text"""
    content: str = Field(..., description="Text content to ingest")
    source_name: Optional[str] = Field(default=None, description="Optional source name for the content")
    metadata: Optional[dict] = Field(default=None, description="Additional metadata")


class IngestURLRequest(BaseModel):
    """Request for ingesting content from URL"""
    url: str = Field(..., description="URL to fetch and ingest")
    metadata: Optional[dict] = Field(default=None, description="Additional metadata")


class IngestResponse(BaseModel):
    """Response for ingestion endpoints"""
    success: bool
    message: str
    document_id: Optional[str] = None
    status: IngestionStatus = IngestionStatus.PENDING


class IngestionStatusResponse(BaseModel):
    """Response for ingestion status"""
    total_documents: int
    documents: List[dict]


class DocumentInfo(BaseModel):
    """Information about an ingested document"""
    document_id: str
    source: str
    status: IngestionStatus
    pages: Optional[int] = None
    chunks: Optional[int] = None
    ingested_at: Optional[str] = None
    metadata: Optional[dict] = None
