-- 002_add_delete_event_type.sql
-- Migrationen für bestehende Datenbanken
-- Fügt 'delete' zu den erlaubten event_type Werten hinzu

-- Alte Constraint entfernen
ALTER TABLE bewegung DROP CONSTRAINT ck_bewegung_event_type;

-- Neue Constraint mit 'delete' hinzufügen
ALTER TABLE bewegung ADD CONSTRAINT ck_bewegung_event_type CHECK (
    event_type IS NULL OR event_type IN (
        'ausgabe',
        'ruecknahme',
        'transfer',
        'groesse_change',
        'notiz_change',
        'pruefung_update',
        'ablauf_update',
        'create',
        'update',
        'delete'
    )
);
