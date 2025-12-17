"""Application configuration using pydantic-settings"""
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # Application
    app_name: str = "EasyKnowledgeRetriever API"
    app_version: str = "0.1.0"
    debug: bool = False
    
    # Working directory
    working_dir: str = "./rag_data"
    
    # Source directory for automatic ingestion
    source_dir: str = "./documents"
    
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
    allowed_extensions: str = ".pdf,.txt,.docx,.md"
    
    class Config:
        env_prefix = "EKR_"
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
