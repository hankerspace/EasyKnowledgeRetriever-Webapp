"""Database access Pydantic models"""
from typing import Optional, List, Literal
from pydantic import BaseModel, Field


class GraphNode(BaseModel):
    """A node in the knowledge graph"""
    id: str
    label: str
    properties: Optional[dict] = None


class GraphEdge(BaseModel):
    """An edge in the knowledge graph"""
    id: Optional[str] = None
    source: str
    target: str
    label: str
    properties: Optional[dict] = None


class GraphSearchRequest(BaseModel):
    """Request for searching the graph"""
    query: str = Field(..., description="Search query for entities/relationships")
    search_type: Literal["nodes", "edges", "both"] = Field(default="both", description="Search type")
    limit: int = Field(default=50, description="Maximum number of results")


class GraphSearchResponse(BaseModel):
    """Response for graph search"""
    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
    total_nodes: int = 0
    total_edges: int = 0


class GraphExportRequest(BaseModel):
    """Request for exporting the graph"""
    format: Literal["json", "graphml", "cypher"] = Field(default="json", description="Export format")


class GraphExportResponse(BaseModel):
    """Response for graph export"""
    success: bool
    format: str
    data: str  # Serialized graph data
    node_count: int
    edge_count: int


class VectorSearchRequest(BaseModel):
    """Request for searching the vector store"""
    query: str = Field(..., description="Search query")
    top_k: int = Field(default=10, description="Number of results")
    threshold: float = Field(default=0.0, description="Minimum similarity threshold")


class VectorSearchResponse(BaseModel):
    """Response for vector search"""
    results: List[dict]
    total: int


class KVListResponse(BaseModel):
    """Response for listing KV keys"""
    keys: List[str]
    total: int


class KVValueResponse(BaseModel):
    """Response for getting a KV value"""
    key: str
    value: Optional[str] = None
    exists: bool


