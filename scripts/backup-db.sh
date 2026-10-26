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
#
# Wiederherstellen siehe README, Abschnitt "Datenbank-Backup".

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/kleiderkammer-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DB_CONTAINER="${DB_CONTAINER:-kleiderkammer-db}"
DB_USER="${DB_USER:-kleid}"
DB_NAME="${DB_NAME:-kleiderkammer}"
COPY_TO="${COPY_TO:-}"

timestamp="$(date +%Y-%m-%d_%H%M)"
target="$BACKUP_DIR/kleiderkammer_${timestamp}.sql.gz"
partial="$target.partial"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "$BACKUP_DIR"
# Dumps enthalten personenbezogene Daten: nur für den eigenen Benutzer lesbar
chmod 700 "$BACKUP_DIR"
umask 077

trap 'rm -f "$partial"' EXIT

log "Starte Backup nach $target"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner | gzip -9 > "$partial"

# Ein vollständiger pg_dump endet mit dieser Zeile; fehlt sie, ist der Dump abgebrochen
if ! gzip -dc "$partial" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
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

deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name 'kleiderkammer_*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')"
if [ "$deleted" -gt 0 ]; then
  log "$deleted Backup(s) älter als $KEEP_DAYS Tage gelöscht"
fi
