import logging
import sys
from app.config import settings

def setup_logging():
    """Configure logging for the application"""
    log_level = logging.DEBUG if settings.debug else logging.INFO
    
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    # Set lower level for third-party libraries if not debugging
    if not settings.debug:
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.error").setLevel(logging.WARNING)

def get_logger(name: str):
    """Get a logger instance with the specified name"""
    return logging.getLogger(name)
