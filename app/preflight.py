"""Startup checks for things that only fail once real work begins.

PDF ingestion happens in a MinerU subprocess, minutes into a run, and a broken
image surfaces as a cryptic "Mineru failed: ImportError" per document. Checking
the toolchain at startup turns that into one clear message before any work (or
any LLM spend) starts.
"""
import subprocess
import sys
from typing import List, Optional

from app.logger import get_logger

logger = get_logger(__name__)

# Imported in a subprocess, exactly as the library invokes MinerU: cv2 links
# against X11/GL libraries that slim base images do not ship, and the failure
# is an ImportError at module load, not a runtime error.
_PDF_PROBE = (
    "import torch, torchvision, cv2; "
    "import doclayout_yolo.nn.tasks; "
    "from mineru.cli.client import main; "
    # Importing the CLI is not enough: MinerU's default backend only fails
    # once a document is parsed if the pipeline extra is missing. This module
    # is what actually needs it.
    "import mineru.backend.pipeline.pipeline_analyze"
)


def check_pdf_toolchain(timeout: int = 120) -> Optional[str]:
    """Return None when PDF ingestion can work, else a human-readable reason."""
    try:
        result = subprocess.run(
            [sys.executable, "-c", _PDF_PROBE],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return f"PDF toolchain probe timed out after {timeout}s"
    except Exception as exc:  # pragma: no cover - defensive
        return f"PDF toolchain probe could not run: {exc}"

    if result.returncode == 0:
        return None

    stderr = (result.stderr or "").strip()
    last = stderr.splitlines()[-1] if stderr else f"exit code {result.returncode}"

    hint = ""
    if "torchvision::nms does not exist" in stderr or "torchvision" in stderr and "operator" in stderr:
        hint = (
            " -- torch and torchvision come from different wheel builds. "
            "Install both from the same index "
            "(https://download.pytorch.org/whl/cpu for a CPU image)."
        )
    elif "libxcb" in stderr or "libGL" in stderr or "libgthread" in stderr:
        hint = (
            " -- OpenCV needs X11/GL system libraries that slim images omit. "
            "Install libgl1, libglib2.0-0, libxcb1, libsm6, libxext6, libxrender1."
        )
    elif "transformers" in stderr and "No module named" in stderr:
        hint = (
            " -- MinerU is installed without its local pipeline dependencies. "
            "The [pdf] extra must install mineru[core], not bare mineru "
            "(easy-knowledge-retriever >= 1.3.1)."
        )
    elif "No module named" in stderr:
        hint = (
            " -- the PDF extra is not installed. "
            'Install easy-knowledge-retriever with the [pdf] extra.'
        )
    return f"{last}{hint}"


def run_preflight(extensions: List[str]) -> Optional[str]:
    """Check only what this deployment actually needs. None means all good."""
    if ".pdf" not in extensions:
        logger.info("Preflight: PDF ingestion not enabled, skipping toolchain check.")
        return None

    logger.info("Preflight: checking the PDF toolchain (torch, cv2, mineru)...")
    problem = check_pdf_toolchain()
    if problem:
        logger.error("Preflight FAILED: PDF ingestion will not work: %s", problem)
    else:
        logger.info("Preflight: PDF toolchain OK.")
    return problem
