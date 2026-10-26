#!/usr/bin/env bash
# Sichert die Kleiderkammer-Datenbank als komprimierten SQL-Dump.
#
# Gedacht für einen täglichen Cronjob auf dem Pi, z. B.:
#   30 2 * * * /home/jf/Documents/JF-Kleiderkammer/scripts/backup-db.sh >> /home/jf/kleiderkammer-backups/backup.log 2>&1
#
# Einstellungen über Umgebungsvariablen (alle optional):
#   BACKUP_DIR      Zielordner                      (Standard: ~/kleiderkammer-backups)
#   KEEP_DAYS       wie viele Tage Backups bleiben  (Standard: 30)
#   DB_CONTAINER    Name des Postgres-Containers    (Standard: kleiderkammer-db)
#   DB_USER/DB_NAME Zugangsdaten der Datenbank      (Standard: kleid / kleiderkammer)
#   COPY_TO         zusätzlicher Ordner für eine Kopie, z. B. USB-Stick oder NAS (Standard: keiner)
#   UPLOAD_URL      Ordner auf einem Server, z. B. ftps://ftp.example.de/backups/ oder
#                   sftp://server.example.de/home/jf/backups/ (Standard: kein Upload).
#                   Benutzer und Passwort stehen in ~/.netrc, nicht im Skript oder in der Crontab.
#   ENCRYPT_PASSFILE Datei mit einem Passwort; ist sie gesetzt, wird der Upload mit AES-256
#                   verschlüsselt (.sql.gz.enc). Empfohlen, sobald die Daten das Haus verlassen.
#
# Die Variablen können auch in ~/.kleiderkammer-backup.env stehen (wird automatisch geladen).
#
# Wiederherstellen siehe README, Abschnitt "Datenbank-Backup".

set -euo pipefail

CONFIG_FILE="${BACKUP_CONFIG:-$HOME/.kleiderkammer-backup.env}"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
fi

BACKUP_DIR="${BACKUP_DIR:-$HOME/kleiderkammer-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DB_CONTAINER="${DB_CONTAINER:-kleiderkammer-db}"
DB_USER="${DB_USER:-kleid}"
DB_NAME="${DB_NAME:-kleiderkammer}"
COPY_TO="${COPY_TO:-}"
UPLOAD_URL="${UPLOAD_URL:-}"
ENCRYPT_PASSFILE="${ENCRYPT_PASSFILE:-}"

timestamp="$(date +%Y-%m-%d_%H%M)"
target="$BACKUP_DIR/kleiderkammer_${timestamp}.sql.gz"
partial="$target.partial"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "$BACKUP_DIR"
# Dumps enthalten personenbezogene Daten: nur für den eigenen Benutzer lesbar
chmod 700 "$BACKUP_DIR"
umask 077

encrypted="$target.enc"
trap 'rm -f "$partial" "$encrypted"' EXIT

log "Starte Backup nach $target"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner | gzip -9 > "$partial"

# Ein vollständiger pg_dump endet mit dieser Zeile; fehlt sie, ist der Dump abgebrochen
if ! gzip -dc "$partial" | tail -n 20 | grep -q "PostgreSQL database dump complete"; then
  log "FEHLER: Dump ist unvollständig, Backup verworfen."
  exit 1
fi

mv "$partial" "$target"
log "Backup fertig ($(du -h "$target" | cut -f1))"

if [ -n "$COPY_TO" ]; then
  if [ -d "$COPY_TO" ]; then
    cp "$target" "$COPY_TO/"
    log "Kopie abgelegt in $COPY_TO"
  else
    log "WARNUNG: Ordner $COPY_TO nicht gefunden (USB-Stick/NAS nicht eingebunden?), keine Kopie erstellt."
  fi
fi

if [ -n "$UPLOAD_URL" ]; then
  upload_file="$target"
  if [ -n "$ENCRYPT_PASSFILE" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -salt -in "$target" -out "$encrypted" -pass "file:$ENCRYPT_PASSFILE"
    upload_file="$encrypted"
  fi

  # Bei ftp:// trotzdem Verschlüsselung der Verbindung verlangen; Klartext-FTP wird abgelehnt
  ssl_flag=()
  case "$UPLOAD_URL" in
    ftp://*) ssl_flag=(--ssl-reqd) ;;
  esac

  if curl --silent --show-error --fail --netrc-optional --ftp-create-dirs ${ssl_flag[@]+"${ssl_flag[@]}"} \
       --retry 3 --retry-delay 30 --upload-file "$upload_file" "${UPLOAD_URL%/}/"; then
    log "Hochgeladen nach ${UPLOAD_URL%/}/$(basename "$upload_file")"
  else
    log "FEHLER: Upload nach $UPLOAD_URL fehlgeschlagen (lokales Backup ist trotzdem vorhanden)."
    upload_failed=1
  fi
  rm -f "$encrypted"
fi

deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name 'kleiderkammer_*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')"
if [ "$deleted" -gt 0 ]; then
  log "$deleted Backup(s) älter als $KEEP_DAYS Tage gelöscht"
fi

# Upload-Fehler erst am Ende melden, damit lokales Backup und Aufräumen trotzdem laufen
exit "${upload_failed:-0}"
