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
    UNIQUE (typ, kind_id)
);

-- Artikel
CREATE TABLE artikel (
    id               TEXT PRIMARY KEY, -- z.B. "0000451"
    kategorie        TEXT NOT NULL,
    bezeichnung      TEXT NOT NULL,
    groesse          TEXT,
    zustand          TEXT,
    aktiv            BOOLEAN NOT NULL DEFAULT TRUE,
    aktueller_ort_id INTEGER REFERENCES ort(id),
    angelegt_am      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    kommentar     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indizes & Constraints
CREATE INDEX idx_artikel_aktiv ON artikel(aktiv);
CREATE INDEX idx_artikel_kategorie_groesse ON artikel(kategorie, groesse);
CREATE INDEX idx_bewegung_artikel_zeitpunkt ON bewegung(artikel_id, zeitpunkt DESC);
CREATE INDEX idx_ort_kind ON ort(kind_id);

-- Default Lager-Ort
INSERT INTO ort (typ, name) VALUES ('lager', 'Hauptlager');

-- Beispiel-Admin (Passwort sp?ter setzen: bcrypt-Hash ersetzen)
INSERT INTO app_user (email, password_hash, role)
VALUES ('admin@example.com', '$2y$10$replace_with_real_bcrypt', 'admin');
