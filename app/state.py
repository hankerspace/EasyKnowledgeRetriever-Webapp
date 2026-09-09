"""Global state management for RAG instance"""
from typing import Optional
import asyncio


class RAGState:
    """Manages the global RAG instance and its configuration"""
    
    def __init__(self):
        self._rag_instance = None
        self._llm_service = None
        self._embedding_service = None
        self._kv_storage = None
        self._vector_storage = None
        self._graph_storage = None
        self._doc_status_storage = None
        self._reranker_service = None
        self._working_dir: Optional[str] = None
        self._initialized: bool = False
        self._startup_error: Optional[str] = None
        self._lock = asyncio.Lock()
        
        # Store configurations
        self._llm_config: Optional[dict] = None
        self._embedding_config: Optional[dict] = None
        self._kv_config: Optional[dict] = None
        self._vector_config: Optional[dict] = None
        self._graph_config: Optional[dict] = None
        self._reranker_config: Optional[dict] = None
    
    @property
    def is_initialized(self) -> bool:
        return self._initialized

    @property
    def startup_error(self) -> Optional[str]:
        """Why initialization failed, or None. Surfaced on /health."""
        return self._startup_error

    def record_startup_error(self, exc: BaseException) -> None:
        self._startup_error = f"{type(exc).__name__}: {exc}"
    
    @property
    def rag(self):
        return self._rag_instance
    
    def set_llm_config(self, config: dict):
        """Set LLM configuration"""
        self._llm_config = config
    
    def set_embedding_config(self, config: dict):
        """Set embedding configuration"""
        self._embedding_config = config
    
    def set_kv_config(self, config: dict):
        """Set KV storage configuration"""
        self._kv_config = config
    
    def set_vector_config(self, config: dict):
        """Set vector storage configuration"""
        self._vector_config = config
    
    def set_graph_config(self, config: dict):
        """Set graph storage configuration"""
        self._graph_config = config

    def set_reranker_config(self, config: Optional[dict]):
        """Set reranker configuration. None disables reranking."""
        self._reranker_config = config
    
    @staticmethod
    def missing_credentials(settings) -> list:
        """Required settings that are absent. Empty list means good to go."""
        missing = []
        if not settings.llm_api_key:
            missing.append("EKR_LLM_API_KEY")
        return missing

    def configure_from_settings(self, settings):
        """Configure RAG state from application settings"""
        self.set_llm_config({
            "model": settings.llm_model,
            "api_key": settings.llm_api_key,
            "base_url": settings.llm_base_url
        })
        self.set_embedding_config({
            "model": settings.embedding_model,
            # Same provider in the common case: fall back to the LLM key
            # rather than silently embedding with no credentials.
            "api_key": settings.embedding_api_key or settings.llm_api_key,
            "base_url": settings.embedding_base_url,
            "embedding_dim": settings.embedding_dim
        })
        self.set_reranker_config({
            "model": settings.reranker_model,
            "api_key": settings.reranker_api_key or settings.llm_api_key,
            "base_url": settings.reranker_base_url,
        } if settings.reranker_enabled else None)

    def get_current_config(self) -> dict:
        """Get current configuration"""
        return {
            "working_dir": self._working_dir,
            "llm": self._llm_config,
            "embedding": self._embedding_config,
            "kv_storage": self._kv_config,
            "vector_storage": self._vector_config,
            "graph_storage": self._graph_config,
            "initialized": self._initialized
        }
    
    async def initialize(self, working_dir: str) -> bool:
        """Initialize the RAG instance with current configuration"""
        async with self._lock:
            try:
                from easy_knowledge_retriever import EasyKnowledgeRetriever
                from easy_knowledge_retriever.llm.service import OpenAILLMService, OpenAIEmbeddingService
                from easy_knowledge_retriever.kg.kv_storage.json_kv_impl import JsonKVStorage
                from easy_knowledge_retriever.kg.vector_storage.nano_vector_db_impl import NanoVectorDBStorage
                from easy_knowledge_retriever.kg.graph_storage.networkx_impl import NetworkXStorage
                from easy_knowledge_retriever.kg.kv_storage.json_doc_status_impl import JsonDocStatusStorage
                
                self._working_dir = working_dir
                
                # Create LLM service
                if self._llm_config:
                    self._llm_service = OpenAILLMService(
                        model=self._llm_config.get("model", "gpt-4o"),
                        api_key=self._llm_config.get("api_key"),
                        base_url=self._llm_config.get("base_url", "https://api.openai.com/v1")
                    )
                
                # Create embedding service
                if self._embedding_config:
                    self._embedding_service = OpenAIEmbeddingService(
                        model=self._embedding_config.get("model", "text-embedding-3-small"),
                        api_key=self._embedding_config.get("api_key"),
                        base_url=self._embedding_config.get("base_url", "https://api.openai.com/v1"),
                        embedding_dim=self._embedding_config.get("embedding_dim", 1536)
                    )
                
                # Create storage backends
                self._kv_storage = self._create_kv_storage(working_dir)
                self._vector_storage = self._create_vector_storage(working_dir)
                self._graph_storage = self._create_graph_storage(working_dir)
                self._doc_status_storage = JsonDocStatusStorage(working_dir=working_dir)
                self._reranker_service = self._create_reranker()
                
                # Create RAG instance
                self._rag_instance = EasyKnowledgeRetriever(
                    working_dir=working_dir,
                    llm_service=self._llm_service,
                    embedding_service=self._embedding_service,
                    kv_storage=self._kv_storage,
                    vector_storage=self._vector_storage,
                    graph_storage=self._graph_storage,
                    doc_status_storage=self._doc_status_storage,
                    reranker_service=self._reranker_service,
                )
                
                await self._rag_instance.initialize_storages()
                self._initialized = True
                self._startup_error = None
                return True
                
            except Exception as e:
                self._initialized = False
                raise e
    
    def _create_kv_storage(self, working_dir: str):
        """Create KV storage based on configuration"""
        from easy_knowledge_retriever.kg.kv_storage.json_kv_impl import JsonKVStorage
        
        config = self._kv_config or {}
        storage_type = config.get("type", "json")
        
        if storage_type == "redis":
            # Not implemented in the library. Fail loudly rather than silently
            # handing back a JSON store the operator did not ask for.
            raise NotImplementedError(
                "Redis KV storage is not implemented. Use type='json'."
            )

        return JsonKVStorage(working_dir=working_dir)
    
    def _create_vector_storage(self, working_dir: str):
        """Create vector storage based on configuration"""
        from easy_knowledge_retriever.kg.vector_storage.nano_vector_db_impl import NanoVectorDBStorage
        
        config = self._vector_config or {}
        storage_type = config.get("type", "nano")
        
        if storage_type == "nano":
            return NanoVectorDBStorage(
                working_dir=working_dir,
                cosine_better_than_threshold=config.get("cosine_better_than_threshold", 0.2)
            )
        elif storage_type == "milvus":
            from easy_knowledge_retriever.kg.vector_storage.milvus_impl import MilvusStorage
            return MilvusStorage(
                uri=config.get("milvus_uri"),
                collection_name=config.get("milvus_collection", "easy_knowledge")
            )
        
        return NanoVectorDBStorage(working_dir=working_dir, cosine_better_than_threshold=0.2)
    
    def _create_graph_storage(self, working_dir: str):
        """Create graph storage based on configuration"""
        from easy_knowledge_retriever.kg.graph_storage.networkx_impl import NetworkXStorage
        
        config = self._graph_config or {}
        storage_type = config.get("type", "networkx")
        
        if storage_type == "networkx":
            return NetworkXStorage(working_dir=working_dir)
        elif storage_type == "neo4j":
            from easy_knowledge_retriever.kg.graph_storage.neo4j_impl import Neo4jStorage
            return Neo4jStorage(
                uri=config.get("neo4j_uri", "bolt://localhost:7687"),
                user=config.get("neo4j_user", "neo4j"),
                password=config.get("neo4j_password", "password")
            )
        
        return NetworkXStorage(working_dir=working_dir)
    
    def _create_reranker(self):
        """Build the reranker service, or None when not configured."""
        config = self._reranker_config
        if not config:
            return None

        from easy_knowledge_retriever.reranker.openai import OpenAIRerankerService

        return OpenAIRerankerService(
            model=config["model"],
            base_url=config["base_url"],
            api_key=config.get("api_key"),
        )

    async def finalize(self) -> bool:
        """Finalize and save storage state"""
        async with self._lock:
            if self._rag_instance and self._initialized:
                try:
                    await self._rag_instance.finalize_storages()
                    return True
                except Exception as e:
                    raise e
            return False
    
    def get_status(self) -> dict:
        """Get current RAG status"""
        return {
            "initialized": self._initialized,
            "working_dir": self._working_dir,
            "llm_model": self._llm_config.get("model") if self._llm_config else None,
            "embedding_model": self._embedding_config.get("model") if self._embedding_config else None,
            "kv_storage_type": self._kv_config.get("type", "json") if self._kv_config else "json",
            "vector_storage_type": self._vector_config.get("type", "nano") if self._vector_config else "nano",
            "graph_storage_type": self._graph_config.get("type", "networkx") if self._graph_config else "networkx",
            "reranker_model": self._reranker_config.get("model") if self._reranker_config else None,
        }


# Global state instance
rag_state = RAGState()
