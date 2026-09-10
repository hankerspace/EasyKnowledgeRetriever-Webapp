"""Application configuration using pydantic-settings"""
from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app import __version__

# Extensions the library can actually ingest. Anything else is rejected early
# by EasyKnowledgeRetriever.ingest() rather than failing inside MinerU.
SUPPORTED_EXTENSIONS = (".pdf", ".txt", ".md", ".markdown")


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    model_config = SettingsConfigDict(
        env_prefix="EKR_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    app_name: str = "EasyKnowledgeRetriever API"
    debug: bool = False

    # Working directory
    working_dir: str = "./rag_data"

    # Source directory for automatic ingestion
    source_dir: str = "./documents"

    # Ingest the source directory on startup (in the background).
    auto_ingest: bool = True

    # Optional PDF page range (0-based). None = whole document. Useful to
    # measure ingestion cost on a slice before committing to a long document.
    ingest_start_page: Optional[int] = None
    ingest_end_page: Optional[int] = None

    # Allowed CORS origins, comma-separated. Empty = no CORS middleware, which
    # is correct when the app is served same-origin behind nginx.
    cors_origins: str = ""

    # Expose /docs, /redoc, /openapi.json. Off by default in production.
    enable_docs: bool = False

    # LLM defaults
    llm_model: str = "gpt-4o"
    llm_api_key: Optional[str] = None
    llm_base_url: str = "https://api.openai.com/v1"

    # Embedding defaults
    embedding_model: str = "text-embedding-3-small"
    embedding_api_key: Optional[str] = None
    embedding_base_url: str = "https://api.openai.com/v1"
    embedding_dim: int = 1536

    # Reranker (optional). Scores retrieved chunks against the query with a
    # cross-encoder before generation. base_url is the FULL endpoint, path
    # included -- the library POSTs to it directly.
    reranker_model: Optional[str] = None
    reranker_api_key: Optional[str] = None
    reranker_base_url: Optional[str] = None

    # Generation temperature. 0 = the same question gets the same answer.
    llm_temperature: float = 0.0

    # Knowledge-graph extraction language and chunking. Take effect on the next
    # ingestion only: an existing index keeps the entities and chunks it was built with.
    language: str = "French"
    chunk_token_size: int = 600
    chunk_overlap_token_size: int = 80
    # Optional section marker: chunks never straddle it (e.g. "\nArticle " for legal texts).
    # In a .env, write a newline as the two characters \n.
    chunk_split_marker: Optional[str] = None

    # Supported files for ingestion
    allowed_extensions: str = ".pdf,.txt,.md"

    @field_validator("ingest_start_page", "ingest_end_page", mode="before")
    @classmethod
    def _empty_string_is_none(cls, v):
        """`EKR_INGEST_START_PAGE=` in a .env must mean "unset", not a parse error."""
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @property
    def app_version(self) -> str:
        """Single source of truth: app/__init__.py."""
        return __version__

    @property
    def extension_list(self) -> List[str]:
        """Parsed, normalised, and filtered against what the library supports."""
        requested = [
            ext.strip().lower()
            for ext in self.allowed_extensions.split(",")
            if ext.strip()
        ]
        return [ext for ext in requested if ext in SUPPORTED_EXTENSIONS]

    @property
    def unsupported_extensions(self) -> List[str]:
        """Configured extensions the library cannot ingest -- warn, don't crash."""
        requested = [
            ext.strip().lower()
            for ext in self.allowed_extensions.split(",")
            if ext.strip()
        ]
        return [ext for ext in requested if ext not in SUPPORTED_EXTENSIONS]

    @property
    def reranker_enabled(self) -> bool:
        return bool(self.reranker_model and self.reranker_base_url)

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
