# Stage 1: Build Frontend
FROM node:18-alpine as frontend-build
WORKDIR /app-frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Final Image (Python + Nginx + Supervisor)
FROM python:3.11-slim

WORKDIR /app

# Installation de Nginx, Supervisor et dépendances système
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    apache2-utils \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Configuration Backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copie du code Backend
COPY app ./app
COPY .env.example .

# Copie des artefacts Frontend depuis le stage 1
COPY --from=frontend-build /app-frontend/dist /app/static

# Configuration Nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Configuration Supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# Création des répertoires pour les données persistantes
RUN mkdir -p rag_data documents

# Variables d'environnement par défaut
ENV EKR_WORKING_DIR=/app/rag_data
ENV EKR_SOURCE_DIR=/app/documents

# Expose le port 80 (Nginx)
EXPOSE 80

# Lancement via Supervisor
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord"]
