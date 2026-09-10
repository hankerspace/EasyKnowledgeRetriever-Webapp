"""Query API router: one-shot JSON answers and a streamed SSE variant."""
import json
import time
from dataclasses import asdict, is_dataclass
from typing import Any, AsyncIterator, Dict, List

from easy_knowledge_retriever import QueryParam
from easy_knowledge_retriever.retrieval import HybridMixRetrieval
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.logger import get_logger
from app.models.query import ContextChunk, QueryRequest, QueryResponse, QueryResult
from app.state import rag_state

router = APIRouter(prefix="/query", tags=["Query & Retrieval"])
logger = get_logger(__name__)


def _check_initialized():
    """Check if RAG is initialized"""
    if not rag_state.is_initialized:
        raise HTTPException(
            status_code=400,
            detail="RAG is not initialized. Check GET /health and GET /rag/ingest/status.",
        )


def _build_param(request: QueryRequest, stream: bool) -> QueryParam:
    return QueryParam(
        top_k=request.top_k,
        only_need_context=request.only_need_context,
        stream=stream,
        include_references=request.include_references,
        query_decomposition=request.query_decomposition,
        conversation_history=request.conversation_history,
        mode="hybrid_mix",
    )


def _to_dicts(items: Any) -> List[Dict[str, Any]]:
    """Library dataclasses (Chunk, Reference, ...) or dicts -> plain dicts."""
    out = []
    for item in items or []:
        if is_dataclass(item):
            out.append(asdict(item))
        elif isinstance(item, dict):
            out.append(item)
    return out


def _serialize_result(result: Any) -> Dict[str, Any]:
    """Flatten whatever the library returned into the fields the UI needs."""
    get = lambda name, default: getattr(result, name, default)  # noqa: E731
    chunks = [
        {
            "chunk_id": c.get("chunk_id"),
            "reference_id": str(c.get("reference_id") or ""),
            "file_path": c.get("file_path") or "",
            "page_start": c.get("page_start"),
            "page_end": c.get("page_end"),
            "content": c.get("content") or "",
        }
        for c in _to_dicts(get("chunks", []))
    ]
    references = [
        {"reference_id": str(r.get("reference_id") or ""), "file_path": r.get("file_path") or ""}
        for r in _to_dicts(get("references", []))
    ]
    return {
        "content": get("content", None) or "",
        "system_prompt": get("system_prompt", "") or "",
        "user_prompt": get("user_prompt", "") or "",
        "metadata": get("metadata", {}) or {},
        "chunks": chunks,
        "references": references,
        "entities": len(get("entities", []) or []),
        "relationships": len(get("relationships", []) or []),
    }


def _sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("", response_model=QueryResponse)
async def query(request: QueryRequest):
    """Query the knowledge base"""
    _check_initialized()
    logger.info(f"Received query: '{request.query}' (Top K: {request.top_k})")

    try:
        param = _build_param(request, stream=False)
        result = await rag_state.rag.aquery(request.query, param=param, retrieval=HybridMixRetrieval())
        logger.info("Query executed successfully.")

        if request.only_need_context:
            contexts = []
            if isinstance(result, list):
                for item in result:
                    if isinstance(item, dict):
                        contexts.append(ContextChunk(
                            content=item.get("content", str(item)),
                            source=item.get("source"),
                            page=item.get("page"),
                            score=item.get("score"),
                            metadata=item.get("metadata"),
                        ))
                    else:
                        contexts.append(ContextChunk(content=str(item)))
            elif isinstance(result, str):
                contexts.append(ContextChunk(content=result))
            return QueryResponse(success=True, query=request.query, answer=None, contexts=contexts)

        data = _serialize_result(result) if not isinstance(result, str) else {"content": result}

        # An empty answer means the pipeline failed somewhere and the
        # error was swallowed. Reporting success here is how a broken
        # deployment looks fine from the outside.
        if not str(data.get("content", "")).strip():
            logger.error("Query produced an empty answer for: %r", request.query)
            return QueryResponse(
                success=False,
                query=request.query,
                error="The query returned an empty answer. Check the API logs, "
                      "the LLM credentials and that documents have been ingested.",
            )

        query_result = QueryResult(
            content=data["content"],
            query=request.query,
            system_prompt=data.get("system_prompt", ""),
            user_prompt=data.get("user_prompt", ""),
            metadata=data.get("metadata", {}),
            chunks=data.get("chunks", []),
            references=data.get("references", []),
            status="success",
        )
        return QueryResponse(success=True, query=request.query, answer=query_result, contexts=None)

    except Exception as e:
        logger.error(f"Error executing query: {e}", exc_info=True)
        return QueryResponse(success=False, query=request.query, error=str(e))


async def _stream_events(request: QueryRequest) -> AsyncIterator[str]:
    """SSE body: status -> context -> token* -> done | error."""
    started = time.monotonic()
    yield _sse("status", {"stage": "retrieving"})
    try:
        param = _build_param(request, stream=True)
        result = await rag_state.rag.aquery(request.query, param=param, retrieval=HybridMixRetrieval())
        if getattr(result, "status", "success") == "failure":
            # The library swallows retrieval/LLM errors into a failure result;
            # its message is the only trace the user gets.
            yield _sse("error", {"message": getattr(result, "message", "") or "Query failed"})
            return
        data = _serialize_result(result)
        data["retrieval_seconds"] = round(time.monotonic() - started, 2)
        content = data.pop("content", "")
        yield _sse("context", {k: data[k] for k in ("chunks", "references", "entities", "relationships",
                                                    "metadata", "retrieval_seconds")})
        yield _sse("status", {"stage": "generating"})

        iterator = getattr(result, "response_iterator", None)
        parts: List[str] = []
        if iterator is not None:
            async for token in iterator:
                if not token:
                    continue
                parts.append(token)
                yield _sse("token", {"text": token})
        elif content:
            parts.append(content)
            yield _sse("token", {"text": content})

        full = "".join(parts)
        if not full.strip():
            yield _sse("error", {"message": "The query returned an empty answer. Check the API logs, "
                                            "the LLM credentials and that documents have been ingested."})
            return
        yield _sse("done", {
            "content": full,
            "system_prompt": data["system_prompt"],
            "user_prompt": data["user_prompt"],
            "metadata": data["metadata"],
            "total_seconds": round(time.monotonic() - started, 2),
        })
    except Exception as e:  # headers are already out: report in-band
        logger.error(f"Error while streaming query: {e}", exc_info=True)
        yield _sse("error", {"message": str(e)})


@router.post("/stream")
async def query_stream(request: QueryRequest):
    """Streamed variant of POST /query, as Server-Sent Events.

    Events: `status` {stage}, `context` {chunks, references, entities,
    relationships, metadata}, `token` {text}, `done` {content, prompts,
    metadata}, `error` {message}.
    """
    _check_initialized()
    logger.info(f"Received streamed query: '{request.query}'")
    return StreamingResponse(
        _stream_events(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/context", response_model=QueryResponse)
async def get_context_only(request: QueryRequest):
    """Get only the retrieved context without LLM generation"""
    request.only_need_context = True
    return await query(request)
