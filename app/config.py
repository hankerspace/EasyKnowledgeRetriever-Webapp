"""Application configuration using pydantic-settings"""
from typing import List, Optional

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

    # Supported files for ingestion
    allowed_extensions: str = ".pdf,.txt,.md"

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
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
