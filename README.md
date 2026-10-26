# Digitale Kleiderkammer – Jugendfeuerwehr

## Zweck
- Wer trägt welches Teil?
- Was liegt im Lager?
- Seit wann?
- PSA-Status (inkl. Helm-Ablaufdatum + Helmprüfung).
- Nachweisfähig gegenüber Eltern / Vorstand / Versicherung.

---

### Module

#### Bestand
- Alle Ausrüstungsteile (Jacken, Hosen, Helme, Handschuhe, Stiefel …).
- Jedes Teil hat eine feste ID (z. B. `0000451`, inkl. führender Nullen).
- Gespeicherte Felder pro Teil:
  - Typ
  - Größe
  - Notiz / Zustand
  - aktuell bei Kind X **oder** frei im Lager
  - Ablaufdatum (Pflicht bei Helmen / PSA mit Ablauf)
  - Helmprüfung:
    - letztes Prüfdatum
    - nächstes fälliges Prüfdatum
- Funktionen:
  - Suchen / Filtern (Typ, Größe, Status frei/vergeben)
  - Filtern nach „abgelaufen“ / „Prüfung fällig“
  - Anlegen / Bearbeiten / Löschen
  - Warnung bei:
    - Helm abgelaufen
    - Helmprüfung überfällig

#### Kinder
- Liste aller Kinder.
- Kind anlegen.
- Status: aktiv / nicht mehr aktiv (wird nicht gelöscht).
- Ansicht pro Kind:
  - „Welche Teile trägt dieses Kind gerade?“
  - „Seit wann?“

#### Verlauf
- Lückenlose Historie aller Übergaben.
- Für jede Bewegung wird gespeichert:
  - Teil-ID
  - von wem → zu wem
  - Zeitstempel
- Filter:
  - nach Kind
  - nach Teil
  - nach Zeitraum
- Nutzen:
  - „Wer hatte Jacke 0000451?“
  - „Was hat Kind XY alles bekommen?“

---

### Übergabe / Rückgabe Workflow
1. Teil suchen oder Etikett scannen.
2. App zeigt:
   - aktueller Träger ODER „frei im Lager“
   - Helmstatus (Ablaufdatum + Prüfstatus)
3. Aktionen:
   - **an Kind geben**
   - **zurück ins Lager**
4. Jede Aktion schreibt automatisch einen Verlaufseintrag.
5. Wechsel Kind A → Kind B wird genauso gebucht.

Niemand muss den Verlauf manuell pflegen.

---

### Scan (Handy)
- Kamera im Handy-Browser.
- Scan von Barcode / QR / Etikett → ergibt die ID des Teils (z. B. `0000451`).
- Direkt danach:
  - Falls Teil bekannt → Detailansicht + Aktionen.
  - Falls Teil neu → Maske „Teil anlegen“:
    - ID ist vorausgefüllt
    - Typ (Jacke / Helm / …)
    - Größe
    - Ablaufdatum (bei Helm)
    - Helmprüfung (letzte Prüfung / nächste fällig)
    - Speichern → fertig

Ziel: kein Tippen, keine Zettel, keine Regalsuche.

---

### CSV

#### Export
- Bestand als CSV  
  (ID, Typ, Größe, Ablaufdatum, Helmprüfstatus, aktueller Träger/Frei)
- Kinderliste als CSV
- kompletter Verlauf als CSV
- Nutzt du als Backup, Dokumentation, Übergabe an Vorstand.

#### Import (Standard)
- CSV mit Spalten z. B.:
  - `id`
  - `type`
  - `size`
  - `expiry_date`
  - `helmet_last_check` (letzte Helmprüfung)
  - `helmet_next_check` (nächste fällige Prüfung)
  - `current_child_name`
- Für Ersterfassung und Korrekturen.
- Verhalten beim Import:
  - legt fehlende Kinder an
  - legt Teile an / aktualisiert Teile
  - setzt aktuelle Zuordnung („trägt gerade …“)
  - schreibt Verlaufseintrag („ausgegeben an …“)

#### Import (Sortly)
- Übernahme vorhandener Inventur-Daten (Sortly-Export).
- Automatische Zuordnung:
  - ID / Inventarnummer
  - Typ (Jacke / Helm / …)
  - Größe (aus Beschreibung)
  - ggf. aktueller Träger
  - Ablaufdatum (bei Helmen)
  - Prüfdaten (falls im Export vorhanden)
- Falls unklar → Teil landet als „frei im Lager“.

---

### Rechte / Zugriff
- Keine offene Registrierung.
- Nutzer werden intern angelegt.

Rollen:
- `admin`
  - alles (Bestand, Kinder, Übergaben, CSV-Import/Export, Nutzerverwaltung)
- `editor`
  - Bestand pflegen, Kinder pflegen, Zuweisungen buchen
- `viewer`
  - nur lesen

Optional:
- Öffentliche Read-Only-Ansicht (nur „wer hat was gerade?“ / Lagerbestand), ohne Login.

---

### Kontrolle / Nachweis
- Jede Übergabe eines Teils erzeugt einen Verlaufseintrag mit Zeitstempel.
- Du kannst jederzeit sagen:
  - Wo ist Jacke `0000451` jetzt?
  - Wer hatte sie davor?
  - Seit wann liegt Helm `000072` wieder im Lager?
  - Ist der Helm abgelaufen?
  - Ist die Helmprüfung fällig?

---

### Ergebnis
- Du weißt, welches Kind was trägt.
- Du findest Teile in Sekunden per Scan.
- Du buchst Ausgaben und Rückgaben direkt am Handy beim Dienst.
- Du kannst beim Austritt sauber alles zurückholen.
- Du kannst Sicherheit (Helm gültig? Helm geprüft?) sofort belegen.
---

## Betrieb

### Datenbank-Backup
Das Skript `scripts/backup-db.sh` sichert die Datenbank als komprimierten SQL-Dump nach
`~/kleiderkammer-backups/` und löscht Backups, die älter als 30 Tage sind. Ein abgebrochener
Dump wird erkannt und verworfen; die Dateien sind nur für den eigenen Benutzer lesbar
(sie enthalten Namen der Kinder).

**Einrichten auf dem Pi** (einmalig, als Benutzer `jf`):

```bash
chmod +x ~/Documents/JF-Kleiderkammer/scripts/backup-db.sh
~/Documents/JF-Kleiderkammer/scripts/backup-db.sh   # einmal von Hand testen
crontab -e
```

In der Crontab diese Zeile ergänzen (jeden Tag um 2:30 Uhr):

```
30 2 * * * /home/jf/Documents/JF-Kleiderkammer/scripts/backup-db.sh >> /home/jf/kleiderkammer-backups/backup.log 2>&1
```

Optional über Umgebungsvariablen vor dem Skript: `KEEP_DAYS=60` (länger aufheben) oder
`COPY_TO=/media/jf/USB` (zusätzliche Kopie auf USB-Stick/NAS). Liegen die Backups nur auf der
SD-Karte des Pi, sind sie bei einem Defekt mit weg – regelmäßig eine Kopie woanders ablegen,
z. B. vom Mac aus:

```bash
rsync -avz jf@192.168.112.136:kleiderkammer-backups/ ~/Documents/Kleiderkammer-Backups/
```

**Wiederherstellen** (ersetzt alle aktuellen Daten!):

```bash
docker exec kleiderkammer-db psql -U kleid -d kleiderkammer -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gzip -dc ~/kleiderkammer-backups/kleiderkammer_JJJJ-MM-TT_HHMM.sql.gz | docker exec -i kleiderkammer-db psql -U kleid -d kleiderkammer -v ON_ERROR_STOP=1
```

### Benutzer und Passwörter
Ersten Admin anlegen oder ein vergessenes Passwort setzen (Passwort wird verdeckt abgefragt):

```bash
docker exec -it kleiderkammer-app php /var/www/html/app/cli/set_password.php name@example.de admin
```
