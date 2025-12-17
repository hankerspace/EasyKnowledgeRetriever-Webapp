"""FastAPI application entry point for EasyKnowledgeRetriever API"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    logger.info("Starting up EasyKnowledgeRetriever API...")
    os.makedirs(settings.working_dir, exist_ok=True)
    os.makedirs(settings.source_dir, exist_ok=True)
    
    logger.info(f"Working directory: {settings.working_dir}")
    logger.info(f"Source directory: {settings.source_dir}")
    
    # Initialize RAG
    try:
        logger.info("Configuring RAG from settings...")
        rag_state.configure_from_settings(settings)
        
        logger.info("Initializing RAG...")
        await rag_state.initialize(settings.working_dir)
        
        # Auto-ingest
        from app.services.ingest_service import ingest_source_directory
        logger.info("Starting automatic ingestion...")
        await ingest_source_directory(settings.source_dir, settings.allowed_extensions)
        
    except Exception as e:
        logger.error(f"Failed to initialize RAG at startup: {e}")
    
    yield
    # Shutdown: finalize RAG if initialized
    logger.info("Shutting down...")
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
- **Configuration**: Configure LLM, embedding, and storage backends
- **Ingestion**: Automatic ingestion from source directory
- **Query**: Query the knowledge base with multiple retrieval modes
- **Database Access**: Explore the knowledge graph, vector store, and KV storage

### Quick Start
1. Configure LLM: `POST /config/llm`
2. Configure Embedding: `POST /config/embedding`
3. Initialize RAG: `POST /rag/initialize`
4. Query: `POST /query`
    """,
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
# app.include_router(config_router)  # Disabled: Configuration via env/file only
app.include_router(rag_router)
# app.include_router(ingest_router)  # Disabled: Automatic ingestion only
app.include_router(query_router)
app.include_router(database_router)


@app.get("/", tags=["Root"])
async def root():
    """API root endpoint"""
    return {
        "name": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "status": "running"
    }


@app.get("/health", tags=["Health"])
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "rag_initialized": rag_state.is_initialized
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug
    )
