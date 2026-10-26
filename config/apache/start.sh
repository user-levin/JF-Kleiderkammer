#!/bin/sh
# Startet Apache mit dem eigenen Zertifikat aus config/ssl (siehe scripts/create-local-ca.sh),
# falls vorhanden – sonst mit dem beim Bauen erzeugten selbstsignierten Zertifikat.
set -e

CUSTOM_DIR=/etc/kleiderkammer-ssl

if [ -f "$CUSTOM_DIR/server.crt" ] && [ -f "$CUSTOM_DIR/server.key" ]; then
  export SSL_CERT_FILE="$CUSTOM_DIR/server.crt"
  export SSL_KEY_FILE="$CUSTOM_DIR/server.key"
  echo "SSL: nutze eigenes Zertifikat aus config/ssl"
else
  export SSL_CERT_FILE=/etc/ssl/certs/self-signed.crt
  export SSL_KEY_FILE=/etc/ssl/private/self-signed.key
  echo "SSL: kein eigenes Zertifikat gefunden, nutze selbstsigniertes"
fi

exec apache2-foreground
