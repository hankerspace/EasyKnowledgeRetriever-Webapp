#!/bin/sh
set -e

# --- Frontend runtime config -------------------------------------------
echo "Generating frontend config..."
mkdir -p /app/static

# Escape double quotes so a title containing one cannot break out of the
# generated JS string.
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

cat <<EOJS > /app/static/config.js
window.env = {
  APP_TITLE: "$(esc "${APP_TITLE:-EasyRAG}")",
  APP_SUBTITLE: "$(esc "${APP_SUBTITLE:-Knowledge Retriever}")",
  APP_LANGUAGE: "$(esc "${APP_LANGUAGE:-en}")"
};
EOJS

# --- Nginx basic auth ---------------------------------------------------
NGINX_AUTH_CONF="/etc/nginx/auth_part.conf"

if [ -n "$AUTH_USER" ] && [ -n "$AUTH_PASSWORD" ]; then
    echo "Enabling Basic Auth for user: $AUTH_USER"
    htpasswd -b -c /etc/nginx/.htpasswd "$AUTH_USER" "$AUTH_PASSWORD"
    # nginx workers drop to www-data and must be able to read this file --
    # root-only 0640 makes every authenticated request fail with a 500.
    if chown root:www-data /etc/nginx/.htpasswd 2>/dev/null; then
        chmod 640 /etc/nginx/.htpasswd
    else
        chmod 644 /etc/nginx/.htpasswd
    fi

    echo 'auth_basic "Restricted Access";' > "$NGINX_AUTH_CONF"
    echo 'auth_basic_user_file /etc/nginx/.htpasswd;' >> "$NGINX_AUTH_CONF"
else
    echo "########################################################"
    echo "# WARNING: AUTH_USER/AUTH_PASSWORD unset.              #"
    echo "# The application is served WITHOUT authentication.     #"
    echo "########################################################"
    echo 'auth_basic off;' > "$NGINX_AUTH_CONF"
fi

# --- Fail fast on missing credentials -----------------------------------
if [ -z "$EKR_LLM_API_KEY" ]; then
    echo "ERROR: EKR_LLM_API_KEY is not set. The RAG cannot answer queries." >&2
    echo "       Set it in .env (see .env.example)." >&2
fi

exec "$@"
