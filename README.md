## Digitale Kleiderkammer – Jugendfeuerwehr

### Zweck
- Wer trägt welches Teil?
- Was liegt im Lager?
- Seit wann?
- Mit Nachweis für Eltern / Vorstand / Versicherung.

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
- Funktionen:
  - Suchen / Filtern (Typ, Größe, Status frei/vergeben)
  - Anlegen / Bearbeiten / Löschen
  - Warnung bei abgelaufenen Helmen

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
   - (bei Helm) Ablaufdatum.
3. Aktionen:
   - **an Kind geben**
   - **zurück ins Lager**
4. Jede Aktion schreibt automatisch einen Verlaufseintrag.
5. Wechsel Kind A → Kind B wird genauso gebucht.

---

### Scan (Handy)
- Kamera im Handy-Browser.
- Scan von Barcode / QR / Etikett → ergibt die ID des Teils.
- Direkt danach:
  - Falls Teil bekannt → Detailansicht + Aktionen.
  - Falls Teil neu → Maske „Teil anlegen“ (ID ist schon vorausgefüllt).

Ziel: Kein Tippen, keine Zettel, keine Regalsuche.

---

### CSV
#### Export
- Bestand als CSV
- Kinderliste als CSV
- kompletter Verlauf als CSV
- Nutzt du als Backup und als Nachweis.

#### Import (Standard)
- CSV mit Spalten z. B.:
  - `id`
  - `type`
  - `size`
  - `expiry_date`
  - `current_child_name`
- Für Ersterfassung und Korrekturen.
- Legt fehlende Kinder an, legt Teile an, setzt Zuweisungen, schreibt Verlauf.

#### Import (Sortly)
- Übernahme vorhandener Inventur-Daten.
- Versucht Typ, Größe, Zuordnung und Ablaufdatum (Helme) automatisch zu erkennen.
- Unsichere Zuordnung → Teil landet erstmal „frei im Lager“.

---

### Rechte / Zugriff
- Keine offene Registrierung.
- Nutzer werden intern angelegt.

Rollenidee:
- `admin`: alles (auch CSV-Import, Nutzerpflege)
- `editor`: Bestand pflegen, Kinder pflegen, Zuweisungen buchen
- `viewer`: nur lesen

Optional:
- Öffentliche Read-Only-Ansicht (z. B. „wer hat was gerade?“), ohne Login.

---

### Kontrolle / Nachweis
- Jede Übergabe wird protokolliert (mit Zeitstempel).
- Du kannst jederzeit sagen:
  - Wo ist Jacke `0000451` jetzt?
  - Wer hatte sie davor?
  - Seit wann liegt Helm `000072` wieder im Lager?
  - Ist der Helm abgelaufen?

---

### Ergebnis
- Du weißt immer, welches Kind welche Ausrüstung hat.
- Du findest Teile durch Scan in Sekunden.
- Du kannst bei Austritt alles sauber zurückbuchen.
- Du kannst belegen, wann ein Teil ausgegeben wurde.
- Helme mit Ablaufdatum laufen nicht „einfach weiter“, weil du die Frist siehst.
