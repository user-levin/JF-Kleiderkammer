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

**Backup im Browser herunterladen:** Als Admin unter *Konto → Datensicherung* auf
„Backup jetzt herunterladen" klicken. Das erzeugt sofort einen aktuellen Dump im selben Format
(`kleiderkammer_….sql.gz`), der sich genauso wiederherstellen lässt wie unten beschrieben.

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

**Automatisch auf einen FTP-/SFTP-Server hochladen** (z. B. Webspace oder NAS):

1. Zugangsdaten in `~/.netrc` auf dem Pi ablegen – so stehen sie weder im Skript noch in der Crontab:
   ```bash
   echo "machine ftp.example.de login BENUTZER password PASSWORT" >> ~/.netrc
   chmod 600 ~/.netrc
   ```
2. Ein Passwort für die Verschlüsselung erzeugen. **Gut aufheben** (z. B. in KeePass) – ohne diese
   Datei lassen sich die hochgeladenen Backups nicht mehr öffnen:
   ```bash
   openssl rand -base64 32 > ~/.kleiderkammer-backup.key
   chmod 600 ~/.kleiderkammer-backup.key
   ```
3. Einstellungen in `~/.kleiderkammer-backup.env` (wird vom Skript automatisch gelesen):
   ```bash
   UPLOAD_URL=ftps://ftp.example.de/kleiderkammer-backups/
   ENCRYPT_PASSFILE=/home/jf/.kleiderkammer-backup.key
   ```
   Möglich sind `ftps://…`, `ftp://…` (nur mit TLS, unverschlüsseltes FTP wird abgelehnt) und
   `sftp://…` (prüfen mit `curl -V | grep sftp`). Danach das Skript einmal von Hand starten.

Hochgeladen wird `kleiderkammer_….sql.gz.enc`; das lokale Backup bleibt unverschlüsselt auf dem Pi.
Alte Backups auf dem Server löscht das Skript nicht – bei Bedarf dort von Zeit zu Zeit aufräumen.
Schlägt der Upload fehl, steht das in `backup.log`, das lokale Backup ist trotzdem da.

Hochgeladenes Backup entschlüsseln:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in kleiderkammer_JJJJ-MM-TT_HHMM.sql.gz.enc -out kleiderkammer.sql.gz -pass file:$HOME/.kleiderkammer-backup.key
```

**Wiederherstellen** (ersetzt alle aktuellen Daten!):

```bash
docker exec kleiderkammer-db psql -U kleid -d kleiderkammer -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gzip -dc ~/kleiderkammer-backups/kleiderkammer_JJJJ-MM-TT_HHMM.sql.gz | docker exec -i kleiderkammer-db psql -U kleid -d kleiderkammer -v ON_ERROR_STOP=1
```

### HTTPS ohne Zertifikatswarnung (eigene lokale CA)
Mit einer eigenen Zertifizierungsstelle (CA) verschwindet die Warnung im Browser, und Browser bzw.
Passwortmanager bieten das Speichern des Logins an. Die CA ist nur auf euren Geräten gültig und darf
nur Zertifikate für die angegebenen Adressen ausstellen – für andere Webseiten taugt sie nicht.

1. **Zertifikat erzeugen** (auf dem Mac im Projektordner, einmalig):
   ```bash
   scripts/create-local-ca.sh 192.168.112.136
   ```
   Das legt die CA in `~/.kleiderkammer-ca/` an (`ca.key` bleibt auf dem Mac und wird nie
   weitergegeben) und das Server-Zertifikat in `config/ssl/`.
2. **Auf den Pi bringen** (zusammen mit dem restlichen Projekt oder einzeln) und neu starten:
   ```bash
   rsync -avz config/ssl/ jf@192.168.112.136:Documents/JF-Kleiderkammer/config/ssl/
   ssh jf@192.168.112.136 'cd ~/Documents/JF-Kleiderkammer && docker compose up -d --force-recreate app'
   ```
   `docker logs kleiderkammer-app` zeigt danach „SSL: nutze eigenes Zertifikat aus config/ssl".
3. **`~/.kleiderkammer-ca/ca.crt` auf jedem Gerät als vertrauenswürdig installieren:**
   - **Mac:** Doppelklick → Schlüsselbund „System" → Zertifikat öffnen → *Vertrauen* →
     „Immer vertrauen".
   - **iPhone/iPad:** Datei per AirDrop/Mail schicken → *Einstellungen → Profil geladen* →
     installieren → danach *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen*
     → für „Kleiderkammer Lokale CA" einschalten.
   - **Android:** *Einstellungen → Sicherheit → Verschlüsselung & Anmeldedaten → Zertifikat
     installieren → CA-Zertifikat*.
   - **Windows:** Doppelklick → *Zertifikat installieren* → Speicherort „Vertrauenswürdige
     Stammzertifizierungsstellen".
   - **Firefox** nutzt einen eigenen Speicher: *Einstellungen → Datenschutz & Sicherheit →
     Zertifikate anzeigen → Zertifizierungsstellen → Importieren*.
4. Seite neu laden – das Schloss erscheint ohne Warnung.

Das Server-Zertifikat ist 825 Tage gültig (Höchstwert für Apple-Geräte). Danach das Skript erneut
ausführen – es nutzt die vorhandene CA, auf den Geräten muss nichts neu installiert werden. Ohne
`config/ssl` startet die App weiterhin mit dem selbstsignierten Zertifikat.

Passkeys funktionieren damit noch nicht: Browser erlauben sie nur für Domainnamen, nicht für
IP-Adressen.

### Benutzer und Passwörter
Ersten Admin anlegen oder ein vergessenes Passwort setzen (Passwort wird verdeckt abgefragt):

```bash
docker exec -it kleiderkammer-app php /var/www/html/app/cli/set_password.php name@example.de admin
```
