import os
from app.state import rag_state
from app.logger import get_logger

logger = get_logger(__name__)

async def ingest_source_directory(source_dir: str, allowed_extensions: str = ".pdf"):
    """
    Ingest all supported files from the source directory.
    """
    if not os.path.exists(source_dir):
        logger.warning(f"Source directory {source_dir} does not exist. Skipping auto-ingestion.")
        return

    logger.info(f"Scanning {source_dir} for documents to ingest...")
    
    extensions = [ext.strip().lower() for ext in allowed_extensions.split(",")]
    files_to_ingest = []
    
    for root, _, files in os.walk(source_dir):
        for file in files:
            if any(file.lower().endswith(ext) for ext in extensions):
                files_to_ingest.append(os.path.join(root, file))
    
    logger.info(f"Found {len(files_to_ingest)} documents.")
    
    for file_path in files_to_ingest:
        try:
            logger.info(f"Ingesting {file_path}...")
            await rag_state.rag.ingest(file_path)
            logger.info(f"Successfully ingested {file_path}")
        except Exception as e:
            logger.error(f"Failed to ingest {file_path}: {e}")
