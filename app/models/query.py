"""Query Pydantic models"""
from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field


class Entity(BaseModel):
    """Entity in the knowledge graph"""
    name: str
    type: Optional[str] = None
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class Relationship(BaseModel):
    """Relationship between entities"""
    source: str
    target: str
    relation_type: Optional[str] = None
    description: Optional[str] = None
    weight: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


class Chunk(BaseModel):
    """Text chunk used in context"""
    id: Optional[str] = None
    content: str
    source: Optional[str] = None
    page: Optional[int] = None
    score: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


class Reference(BaseModel):
    """Reference source"""
    id: str
    title: Optional[str] = None
    url: Optional[str] = None
    page: Optional[int] = None
    chunk_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class QueryResult(BaseModel):
    """
    Unified query result data structure for all query modes.

    Attributes:
        content: Text content for non-streaming responses (LLM response)
        response_iterator: Streaming response iterator for streaming responses
        raw_data: Complete structured data including references and metadata (legacy dict)
        is_streaming: Whether this is a streaming result
        context: The context text used for the query
        entities: List of entities used
        relationships: List of relationships used
        chunks: List of text chunks used
        references: List of references
        metadata: Query metadata
        status: Operation status
        message: Operation message
    """

    content: Optional[str] = None
    response_iterator: Optional[Any] = Field(default=None, exclude=True)
    raw_data: Optional[Dict[str, Any]] = None
    is_streaming: bool = False
    
    # New structured fields
    query: str = ""
    system_prompt: str = ""
    user_prompt: str = ""
    context: Optional[str] = None
    entities: List[Entity] = Field(default_factory=list)
    relationships: List[Relationship] = Field(default_factory=list)
    chunks: List[Chunk] = Field(default_factory=list)
    references: List[Reference] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    status: Literal["success", "failure"] = "success"
    message: str = ""

    class Config:
        arbitrary_types_allowed = True


class QueryRequest(BaseModel):
    """Request for querying the knowledge base"""
    query: str = Field(..., description="Query text")
    only_need_context: bool = Field(
        default=False, 
        description="If true, return only context without LLM generation"
    )
    top_k: int = Field(default=10, description="Number of top results to retrieve")
    stream: bool = Field(default=False, description="Enable streaming response")
    include_references: bool = Field(default=True, description="Include references in response")
    query_decomposition: bool = Field(default=True, description="Enable query decomposition")
    conversation_history: Optional[List[Dict[str, Any]]] = Field(default=None, description="Conversation history")


class ContextChunk(BaseModel):
    """A context chunk returned from retrieval"""
    content: str
    source: Optional[str] = None
    page: Optional[int] = None
    score: Optional[float] = None
    metadata: Optional[dict] = None


class QueryResponse(BaseModel):
    """Response for query endpoints"""
    success: bool
    query: str
    answer: Optional[QueryResult] = None
    contexts: Optional[List[ContextChunk]] = None
    error: Optional[str] = None


class StreamChunk(BaseModel):
    """A chunk from streaming response"""
    type: Literal["context", "token", "done", "error"]
    content: Optional[str] = None
    metadata: Optional[dict] = None
