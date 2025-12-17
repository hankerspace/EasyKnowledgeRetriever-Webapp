"""Query API router"""
import json

from easy_knowledge_retriever.retrieval import HybridMixRetrieval
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
from app.models.query import QueryRequest, QueryResponse, ContextChunk, StreamChunk, QueryResult
from app.state import rag_state
from app.logger import get_logger
try:
    from easy_knowledge_retriever import QueryResult as LibQueryResult
except ImportError:
    LibQueryResult = None

router = APIRouter(prefix="/query", tags=["Query & Retrieval"])
logger = get_logger(__name__)


def _check_initialized():
    """Check if RAG is initialized"""
    if not rag_state.is_initialized:
        raise HTTPException(
            status_code=400, 
            detail="RAG is not initialized. Please call POST /rag/initialize first"
        )


@router.post("", response_model=QueryResponse)
async def query(request: QueryRequest):
    """Query the knowledge base"""
    _check_initialized()
    
    logger.info(f"Received query: '{request.query}' (Top K: {request.top_k})")
    
    try:
        # Execute query
        logger.debug("Executing query against RAG engine...")
        result = await rag_state.rag.aquery(request.query, retrieval=HybridMixRetrieval())
        logger.info("Query executed successfully.")
        
        # Parse result based on whether we want context only or full answer
        if request.only_need_context:
            # Result is context chunks
            logger.debug("Processing context-only response")
            contexts = []
            if isinstance(result, list):
                for item in result:
                    if isinstance(item, dict):
                        contexts.append(ContextChunk(
                            content=item.get("content", str(item)),
                            source=item.get("source"),
                            page=item.get("page"),
                            score=item.get("score"),
                            metadata=item.get("metadata")
                        ))
                    else:
                        contexts.append(ContextChunk(content=str(item)))
            elif isinstance(result, str):
                contexts.append(ContextChunk(content=result))
            
            return QueryResponse(
                success=True,
                query=request.query,
                answer=None,
                contexts=contexts
            )
        else:
            # Result is the generated answer
            logger.debug("Processing answer response")
            
            content_val = ""
            # Extract content from result
            if LibQueryResult and isinstance(result, LibQueryResult):
                content_val = result.content
            elif hasattr(result, "content"):
                content_val = result.content
            else:
                content_val = str(result)
            
            query_result = QueryResult(
                content=content_val,
                query=request.query,
                status="success"
            )
            
            return QueryResponse(
                success=True,
                query=request.query,
                answer=query_result,
                contexts=None
            )
        
    except Exception as e:
        logger.error(f"Error executing query: {e}", exc_info=True)
        return QueryResponse(
            success=False,
            query=request.query,
            error=str(e)
        )


@router.post("/stream")
async def query_stream(request: QueryRequest):
    """Stream query response using Server-Sent Events"""
    _check_initialized()
    
    logger.info(f"Received stream query: '{request.query}'")
    
    async def generate():
        try:
            # Check if streaming is supported
            if hasattr(rag_state.rag, 'aquery_stream'):
                logger.debug("Starting streaming response...")
                async for chunk in rag_state.rag.aquery_stream(request.query, retrieval=HybridMixRetrieval()):
                    yield {
                        "event": "token",
                        "data": json.dumps({"type": "token", "content": chunk})
                    }
                logger.debug("Streaming completed successfully.")
            else:
                # Fall back to non-streaming
                logger.warning("Streaming not supported by backend, falling back to standard query.")
                result = await rag_state.rag.aquery(request.query, retrieval=HybridMixRetrieval())
                yield {
                    "event": "token",
                    "data": json.dumps({"type": "token", "content": str(result)})
                }
            
            yield {
                "event": "done",
                "data": json.dumps({"type": "done"})
            }
            
        except Exception as e:
            logger.error(f"Error during streaming: {e}", exc_info=True)
            yield {
                "event": "error",
                "data": json.dumps({"type": "error", "content": str(e)})
            }
    
    return EventSourceResponse(generate())


@router.post("/context", response_model=QueryResponse)
async def get_context_only(request: QueryRequest):
    """Get only the retrieved context without LLM generation"""
    # Force only_need_context to True
    request.only_need_context = True
    return await query(request)
