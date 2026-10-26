#!/usr/bin/env bash
# Erstellt eine eigene, lokale Zertifizierungsstelle (CA) und damit ein Server-Zertifikat für die
# Kleiderkammer. Wird die CA einmal auf jedem Gerät als vertrauenswürdig installiert, zeigt der
# Browser keine Warnung mehr und bietet das Speichern von Passwörtern an.
#
# Aufruf (auf dem Mac, im Projektordner):
#   scripts/create-local-ca.sh 192.168.112.136 [weitere IPs oder Hostnamen …]
#
# Ergebnis:
#   ~/.kleiderkammer-ca/ca.key      privater Schlüssel der CA – bleibt auf dem Mac, nie weitergeben
#   ~/.kleiderkammer-ca/ca.crt      CA-Zertifikat – auf allen Geräten installieren (siehe README)
#   config/ssl/server.crt|.key      Server-Zertifikat für den Pi (wird beim Start des Containers genutzt)
#
# Die CA darf nur für die angegebenen Adressen Zertifikate ausstellen (Name Constraints), damit sie
# auf den Geräten nicht für fremde Webseiten missbraucht werden kann. Erneuter Aufruf nutzt die
# vorhandene CA und erstellt nur ein neues Server-Zertifikat, z. B. für eine neue Adresse.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Aufruf: $0 <IP oder Hostname> [weitere …]" >&2
  exit 1
fi

CA_DIR="${CA_DIR:-$HOME/.kleiderkammer-ca}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/config/ssl"
SERVER_DAYS=825   # Höchstwert, den Apple-Geräte für Server-Zertifikate akzeptieren
CA_DAYS=3650

mkdir -p "$CA_DIR" "$OUT_DIR"
chmod 700 "$CA_DIR"
umask 077

# Adressen in subjectAltName und Name Constraints übersetzen
san=""
constraints=""
for name in "$@" localhost 127.0.0.1; do
  if [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    san+="IP:$name,"
    constraints+="permitted;IP:$name/255.255.255.255,"
  else
    san+="DNS:$name,"
    constraints+="permitted;DNS:$name,"
  fi
done
san="${san%,}"
constraints="${constraints%,}"

if [ ! -f "$CA_DIR/ca.key" ]; then
  echo "Erstelle neue CA in $CA_DIR …"
  openssl req -x509 -new -newkey rsa:4096 -nodes -sha256 -days "$CA_DAYS" \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.crt" \
    -subj "/CN=Kleiderkammer Lokale CA/O=Jugendfeuerwehr" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,$constraints"
  echo "CA erstellt. Wichtig: ca.crt auf allen Geräten installieren (siehe README)."
else
  echo "Nutze vorhandene CA aus $CA_DIR"
fi

echo "Erstelle Server-Zertifikat für: $san"
openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -keyout "$OUT_DIR/server.key" -out "$OUT_DIR/server.csr" \
  -subj "/CN=$1/O=Jugendfeuerwehr Kleiderkammer"

cat > "$OUT_DIR/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF

openssl x509 -req -in "$OUT_DIR/server.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" \
  -CAcreateserial -out "$OUT_DIR/server.crt" -days "$SERVER_DAYS" -sha256 -extfile "$OUT_DIR/server.ext"

rm -f "$OUT_DIR/server.csr" "$OUT_DIR/server.ext"
# Apache im Container muss Zertifikat und Schlüssel lesen können
chmod 644 "$OUT_DIR/server.crt" "$OUT_DIR/server.key"

echo
echo "Fertig:"
echo "  CA-Zertifikat zum Installieren: $CA_DIR/ca.crt"
echo "  Server-Zertifikat:              $OUT_DIR/server.crt (gültig $SERVER_DAYS Tage)"
echo "Danach auf den Pi hochladen und den App-Container neu starten (siehe README)."
