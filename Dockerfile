# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app-frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Final Image (Python + Nginx + Supervisor)
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    apache2-utils \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# MinerU/HuggingFace model cache. Mount a volume here (see docker-compose.yml)
# or the multi-GB download restarts every time the container is recreated.
ENV HF_HOME=/app/models/huggingface \
    MINERU_MODEL_SOURCE=huggingface \
    PYTHONUNBUFFERED=1
RUN mkdir -p /app/models/huggingface

# Escape hatch for installing the library from somewhere other than PyPI,
# e.g. a git ref while iterating on both repos:
#   docker compose build --build-arg EKR_PACKAGE="easy-knowledge-retriever[pdf] @ git+https://github.com/hankerspace/EasyKnowledgeRetriever@main"
ARG EKR_PACKAGE=""
RUN if [ -n "$EKR_PACKAGE" ]; then pip install --no-cache-dir "$EKR_PACKAGE"; fi

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Optional: download the MinerU models at build time instead of on the first
# ingestion. Costs build time and image size, but makes the first run fast and
# works on hosts with no outbound access to HuggingFace at runtime.
#   docker compose build --build-arg PREFETCH_MINERU_MODELS=true
ARG PREFETCH_MINERU_MODELS=false
RUN if [ "$PREFETCH_MINERU_MODELS" = "true" ]; then \
        echo "Pre-fetching MinerU models..." && \
        (mineru-models-download -s huggingface -m all || \
         echo "WARNING: model prefetch failed; models will download on first use"); \
    fi

COPY app ./app
COPY .env.example .

COPY --from=frontend-build /app-frontend/dist /app/static

COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p rag_data documents

ENV EKR_WORKING_DIR=/app/rag_data \
    EKR_SOURCE_DIR=/app/documents

EXPOSE 80

# Liveness only. Readiness (RAG up AND ingestion finished) is /health/ready --
# using it here would mark the container unhealthy for the hours an initial
# ingestion legitimately takes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://127.0.0.1/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord"]
