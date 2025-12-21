#!/bin/sh
set -e

# Génération de la configuration frontend
echo "Generating frontend config..."
# Assurer que le répertoire existe (au cas où)
mkdir -p /app/static

cat <<EOF > /app/static/config.js
window.env = {
  APP_TITLE: "${APP_TITLE:-EasyRAG}",
  APP_SUBTITLE: "${APP_SUBTITLE:-Knowledge Retriever}"
};
EOF

# Configuration de l'authentification Nginx
NGINX_AUTH_CONF="/etc/nginx/auth_part.conf"

if [ -n "$AUTH_USER" ] && [ -n "$AUTH_PASSWORD" ]; then
    echo "Enabling Basic Auth for user: $AUTH_USER"
    htpasswd -b -c /etc/nginx/.htpasswd "$AUTH_USER" "$AUTH_PASSWORD"
    
    echo 'auth_basic "Restricted Access";' > "$NGINX_AUTH_CONF"
    echo 'auth_basic_user_file /etc/nginx/.htpasswd;' >> "$NGINX_AUTH_CONF"
else
    echo "Basic Auth disabled"
    echo 'auth_basic off;' > "$NGINX_AUTH_CONF"
fi

# Exécution de la commande
exec "$@"
