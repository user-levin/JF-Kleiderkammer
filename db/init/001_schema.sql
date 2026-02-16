-- 001_schema.sql
-- Digitale Kleiderkammer - Basis-Schema
-- Wird von Postgres beim ersten Container-Start ausgef?hrt (docker-entrypoint-initdb.d)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Benutzer
CREATE TABLE app_user (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('leser','verwalter','admin')),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kinder
CREATE TABLE kind (
    id          SERIAL PRIMARY KEY,
    vorname     TEXT NOT NULL,
    nachname    TEXT NOT NULL,  
    status      TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','inaktiv')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Orte (Lager oder Kind-Ort)
CREATE TABLE ort (
    id         SERIAL PRIMARY KEY,
    typ        TEXT NOT NULL CHECK (typ IN ('lager','kind')),
    name       TEXT,
    kind_id    INTEGER REFERENCES kind(id) ON DELETE CASCADE,
    CONSTRAINT ck_ort_kind_relation CHECK (
        (typ = 'kind'  AND kind_id IS NOT NULL) OR
        (typ = 'lager' AND kind_id IS NULL)
    ),
    CONSTRAINT ck_ort_lager_name CHECK (typ <> 'lager' OR name IS NOT NULL),
    UNIQUE (typ, kind_id)
);

-- Helper-Funktion fuer Standard-Lager-Referenzen
CREATE OR REPLACE FUNCTION get_default_lager_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT id
    FROM ort
    WHERE typ = 'lager'
    ORDER BY id
    LIMIT 1;
$$;

-- Artikel
CREATE TABLE artikel (
    id               TEXT PRIMARY KEY, -- z.B. "0000451"
    kategorie        TEXT NOT NULL,
    bezeichnung      TEXT NOT NULL,
    groesse          TEXT,
    zustand          TEXT,
    notizen          TEXT,
    kaufdatum        DATE,
    ablaufdatum      DATE,
    helm_letzte_pruefung   DATE,
    helm_naechste_pruefung DATE,
    aktiv            BOOLEAN NOT NULL DEFAULT TRUE,
    aktueller_ort_id INTEGER NOT NULL REFERENCES ort(id),
    angelegt_am      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_artikel_id_numeric CHECK (id ~ '^[0-9]{9}$')
);

-- Bewegungen / Historie
CREATE TABLE bewegung (
    id            BIGSERIAL PRIMARY KEY,
    artikel_id    TEXT NOT NULL REFERENCES artikel(id),
    von_ort_id    INTEGER REFERENCES ort(id),
    nach_ort_id   INTEGER NOT NULL REFERENCES ort(id),
    zeitpunkt     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id       INTEGER REFERENCES app_user(id),
    aktion        TEXT NOT NULL, -- z.B. ausgabe, ruecknahme, transfer
    event_type    TEXT,
    old_value     JSONB,
    new_value     JSONB,
    kommentar     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_bewegung_event_type CHECK (
        event_type IS NULL OR event_type IN (
            'ausgabe',
            'ruecknahme',
            'transfer',
            'groesse_change',
            'notiz_change',
            'pruefung_update',
            'ablauf_update',
            'create',
            'update'
        )
    )
);

ALTER TABLE artikel
    ALTER COLUMN aktueller_ort_id SET DEFAULT get_default_lager_id();

-- Indizes & Constraints
CREATE INDEX idx_artikel_aktiv ON artikel(aktiv);
CREATE INDEX idx_artikel_kategorie_groesse ON artikel(kategorie, groesse);
CREATE INDEX idx_artikel_ort ON artikel(aktueller_ort_id);
CREATE INDEX idx_artikel_ablauf ON artikel(ablaufdatum);
CREATE INDEX idx_artikel_helm_next ON artikel(helm_naechste_pruefung);
CREATE INDEX idx_bewegung_artikel_zeitpunkt ON bewegung(artikel_id, zeitpunkt DESC);
CREATE INDEX idx_bewegung_event_type ON bewegung(event_type);
CREATE INDEX idx_ort_kind ON ort(kind_id);
CREATE UNIQUE INDEX ux_ort_single_lager ON ort (typ) WHERE typ = 'lager';
CREATE UNIQUE INDEX ux_ort_single_kind ON ort (kind_id) WHERE typ = 'kind';

-- Default Lager-Ort
INSERT INTO ort (typ, name) VALUES ('lager', 'Hauptlager');

-- Beispiel-Admin (Passwort sp?ter setzen: bcrypt-Hash ersetzen)
--INSERT INTO app_user (email, password_hash, role)
--VALUES ('admin@example.com', 'admin', 'admin');

