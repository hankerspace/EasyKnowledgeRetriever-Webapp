"""Configuration Pydantic models"""
from typing import Optional, Literal
from pydantic import BaseModel, Field


class LLMConfig(BaseModel):
    """LLM service configuration"""
    model: str = Field(default="gpt-4o", description="Model name")
    api_key: str = Field(..., description="API key for the LLM service")
    base_url: str = Field(default="https://api.openai.com/v1", description="Base URL for the API")
    max_tokens: int = Field(default=4096, description="Maximum tokens for generation")
    temperature: float = Field(default=0.7, description="Temperature for generation")


class EmbeddingConfig(BaseModel):
    """Embedding service configuration"""
    model: str = Field(default="text-embedding-3-small", description="Embedding model name")
    api_key: str = Field(..., description="API key for the embedding service")
    base_url: str = Field(default="https://api.openai.com/v1", description="Base URL for the API")
    embedding_dim: int = Field(default=1536, description="Embedding dimensions")


class KVStorageConfig(BaseModel):
    """Key-Value storage configuration"""
    type: Literal["json", "redis"] = Field(default="json", description="Storage backend type")
    # JSON-specific
    working_dir: Optional[str] = Field(default=None, description="Working directory for JSON storage")
    # Redis-specific
    redis_url: Optional[str] = Field(default=None, description="Redis connection URL")


class VectorStorageConfig(BaseModel):
    """Vector storage configuration"""
    type: Literal["nano", "milvus"] = Field(default="nano", description="Storage backend type")
    # NanoVectorDB-specific
    cosine_better_than_threshold: float = Field(default=0.2, description="Similarity threshold")
    # Milvus-specific
    milvus_uri: Optional[str] = Field(default=None, description="Milvus connection URI")
    milvus_collection: Optional[str] = Field(default=None, description="Milvus collection name")


class GraphStorageConfig(BaseModel):
    """Graph storage configuration"""
    type: Literal["networkx", "neo4j"] = Field(default="networkx", description="Storage backend type")
    # Neo4j-specific
    neo4j_uri: Optional[str] = Field(default=None, description="Neo4j connection URI")
    neo4j_user: Optional[str] = Field(default=None, description="Neo4j username")
    neo4j_password: Optional[str] = Field(default=None, description="Neo4j password")


class RAGConfig(BaseModel):
    """Complete RAG configuration"""
    working_dir: str = Field(default="./rag_data", description="Working directory for RAG data")
    llm: LLMConfig
    embedding: EmbeddingConfig
    kv_storage: Optional[KVStorageConfig] = Field(default=None, description="KV storage configuration")
    vector_storage: Optional[VectorStorageConfig] = Field(default=None, description="Vector storage configuration")
    graph_storage: Optional[GraphStorageConfig] = Field(default=None, description="Graph storage configuration")


class ConfigResponse(BaseModel):
    """Response for configuration endpoints"""
    success: bool
    message: str
    config: Optional[dict] = None


class RAGStatusResponse(BaseModel):
    """Response for RAG status"""
    initialized: bool
    working_dir: Optional[str] = None
    llm_model: Optional[str] = None
    embedding_model: Optional[str] = None
    kv_storage_type: Optional[str] = None
    vector_storage_type: Optional[str] = None
    graph_storage_type: Optional[str] = None
    reranker_model: Optional[str] = None
