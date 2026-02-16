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

## Betrieb auf dem Raspberry Pi

Die Anwendung ist komplett dockerisiert und dadurch auch auf einem Raspberry Pi (64-bit OS empfohlen) lauffähig. So gelingt die Einrichtung:

### Voraussetzungen
- Docker Engine inkl. Compose Plugin (`sudo apt install docker.io docker-compose-plugin`).
- Node.js 20+ auf dem Pi (nur benötigt, um das Frontend einmalig zu bauen).

### Schritte
1. **Quellcode kopieren** – z. B. per `scp -r JF-Kleiderkammer pi@raspberrypi.local:/home/pi/kleiderkammer`.
2. **Umgebungsvariablen setzen** – lege im Projektwurzelverzeichnis eine `.env` an (Werte bei Bedarf anpassen):

  ```env
  APP_ENV=production
  APP_DEBUG=0
  DB_NAME=kleiderkammer
  DB_USER=kleid
  DB_PASS=secret
  PGADMIN_EMAIL=admin@example.com
  PGADMIN_PASSWORD=admin
  ```

3. **Frontend bauen** – auf dem Pi im Ordner `frontend` einmalig `npm ci && npm run build` ausführen. Der Build landet in `src/public/app` und wird anschließend vom Apache-Container ausgeliefert.
4. **Container starten** – im Projektstamm `docker compose up --build -d` ausführen.
5. **Zugriff testen** –
  - UI: `http://<pi-ip>:8080/app/`
  - API/Health: `http://<pi-ip>:8080/health.php`
  - pgAdmin (optional): `http://<pi-ip>:8081/`

### Betrieb & Debugging
- Das Dashboard zeigt automatisch eine Debug-Benachrichtigung an, falls der Backend-Container keine Verbindung zur Datenbank herstellen kann. Ist die DB erreichbar, bleibt das Banner verborgen.
- Über `docker compose logs -f app` bzw. `docker compose logs -f db` lassen sich Fehler direkt am Pi prüfen.
- Nach UI-Änderungen muss `npm run build` erneut ausgeführt werden, damit die aktualisierte Oberfläche in `src/public/app` landet. Anschließend reicht `docker compose restart app`.