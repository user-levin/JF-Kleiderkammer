<?php

declare(strict_types=1);

// Verlauf der Ausgaben, Rückgaben und Neuanlagen mit Rückgängig-Funktion.
// Grundlage ist die Tabelle bewegung; jede Zeile merkt sich, wer sie ausgelöst hat
// (über die Session-Variablen app.user_id / app.user_email, siehe set_db_user()).

// Admins können Schritte dieses Alters rückgängig machen
const MOVEMENT_UNDO_DAYS = 28;
// Betreuer nur eigene Schritte, z. B. einen falschen Scan direkt bei der Ausgabe
const MOVEMENT_OWN_UNDO_HOURS = 24;
// Bewegungen, die den Ort eines Artikels ändern (nur diese erscheinen im Verlauf)
const LOCATION_EVENTS = "('create', 'transfer', 'delete', 'undo')";

function ensure_movement_schema(PDO $pdo): void
{
    $pdo->exec('ALTER TABLE bewegung ADD COLUMN IF NOT EXISTS user_email TEXT');
    $pdo->exec('ALTER TABLE bewegung ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ');
    $pdo->exec('ALTER TABLE bewegung ADD COLUMN IF NOT EXISTS undone_by TEXT');
    // Wer eine Bewegung auslöst, wird ohne Änderung an den einzelnen INSERTs mitgeschrieben
    $pdo->exec("ALTER TABLE bewegung ALTER COLUMN user_id SET DEFAULT NULLIF(current_setting('app.user_id', true), '')::INTEGER");
    $pdo->exec("ALTER TABLE bewegung ALTER COLUMN user_email SET DEFAULT NULLIF(current_setting('app.user_email', true), '')");
}

/**
 * Hinterlegt den angemeldeten Benutzer für diese Datenbankverbindung.
 */
function set_db_user(PDO $pdo, array $user): void
{
    $statement = $pdo->prepare("SELECT set_config('app.user_id', :id, false), set_config('app.user_email', :email, false)");
    $statement->execute([':id' => (string) $user['id'], ':email' => $user['email']]);
}

/**
 * Prüft, ob ein Schritt rückgängig gemacht werden kann. Liefert null oder den Grund, warum nicht.
 */
function movement_undo_blocker(array $movement, array $user, bool $isLatest): ?string
{
    if ($movement['undone_at'] !== null) {
        return 'Wurde bereits rückgängig gemacht.';
    }
    if (!in_array($movement['event_type'], ['create', 'transfer'], true)) {
        return 'Dieser Schritt kann nicht rückgängig gemacht werden.';
    }

    $age = time() - (strtotime((string) $movement['zeitpunkt']) ?: 0);
    if (user_can($user, 'movements.manage')) {
        if ($age > MOVEMENT_UNDO_DAYS * 86400) {
            return 'Älter als ' . (MOVEMENT_UNDO_DAYS / 7) . ' Wochen.';
        }
    } elseif ((int) ($movement['user_id'] ?? 0) !== $user['id'] || $age > MOVEMENT_OWN_UNDO_HOURS * 3600) {
        return 'Nur der Admin kann diesen Schritt rückgängig machen.';
    }

    if (!$isLatest || !normalize_bool($movement['aktiv']) || (int) $movement['aktueller_ort_id'] !== (int) $movement['nach_ort_id']) {
        return 'Artikel wurde seitdem verändert.';
    }

    return null;
}

function latest_location_movement_id(PDO $pdo, string $articleId): ?int
{
    $statement = $pdo->prepare('SELECT MAX(id) FROM bewegung WHERE artikel_id = :id AND event_type IN ' . LOCATION_EVENTS);
    $statement->execute([':id' => $articleId]);
    $id = $statement->fetchColumn();

    return $id === null || $id === false ? null : (int) $id;
}

/**
 * Macht eine Ausgabe/Rückgabe/Umbuchung oder eine Neuanlage rückgängig.
 * Ausgabe etc.: Artikel geht an den vorherigen Ort zurück. Neuanlage: Artikel wird ausgesondert.
 */
function undo_movement(PDO $pdo, array $user, int $movementId): array
{
    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare(
            'SELECT b.*, a.aktiv, a.aktueller_ort_id
             FROM bewegung b JOIN artikel a ON a.id = b.artikel_id
             WHERE b.id = :id FOR UPDATE OF b, a'
        );
        $statement->execute([':id' => $movementId]);
        $movement = $statement->fetch();

        if (!$movement) {
            rollback_if_needed($pdo);
            json_error('Schritt wurde nicht gefunden.', 404);
        }

        $isLatest = latest_location_movement_id($pdo, $movement['artikel_id']) === $movementId;
        $blocker = movement_undo_blocker($movement, $user, $isLatest);
        if ($blocker !== null) {
            rollback_if_needed($pdo);
            json_error($blocker, 409);
        }

        $currentOrt = (int) $movement['aktueller_ort_id'];
        $previousOrt = $movement['von_ort_id'] !== null ? (int) $movement['von_ort_id'] : null;

        if ($movement['event_type'] === 'create') {
            // Neu angelegt -> wieder aussondern (bei reaktivierten Artikeln zurück an den alten Ort)
            $pdo->prepare('UPDATE artikel SET aktiv = false, aktueller_ort_id = :ort, updated_at = NOW() WHERE id = :id')
                ->execute([':ort' => $previousOrt ?? $currentOrt, ':id' => $movement['artikel_id']]);
            $targetOrt = $previousOrt ?? $currentOrt;
        } else {
            $pdo->prepare('UPDATE artikel SET aktueller_ort_id = :ort, updated_at = NOW() WHERE id = :id')
                ->execute([':ort' => $previousOrt, ':id' => $movement['artikel_id']]);
            $targetOrt = $previousOrt;
        }

        $pdo->prepare(
            "INSERT INTO bewegung (artikel_id, von_ort_id, nach_ort_id, aktion, event_type, old_value)
             VALUES (:artikel_id, :von, :nach, 'rueckgaengig', 'undo', :old_value)"
        )->execute([
            ':artikel_id' => $movement['artikel_id'],
            ':von' => $currentOrt,
            ':nach' => $targetOrt,
            ':old_value' => json_encode(['undo_of' => $movementId], JSON_UNESCAPED_UNICODE),
        ]);

        $pdo->prepare('UPDATE bewegung SET undone_at = NOW(), undone_by = :email WHERE id = :id')
            ->execute([':email' => $user['email'], ':id' => $movementId]);

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return [
        'undone' => $movementId,
        'articleId' => $movement['artikel_id'],
        'eventType' => $movement['event_type'],
    ];
}

/**
 * Ortsänderungen der letzten Wochen, neueste zuerst, mit Angabe ob und warum nicht rückgängig.
 * Filter userId: eine Benutzer-ID, "me" für den angemeldeten Benutzer, leer für alle.
 */
function list_location_movements(PDO $pdo, array $user, array $query): array
{
    $limit = max(1, min(100, (int) ($query['limit'] ?? 25)));
    $offset = max(0, (int) ($query['offset'] ?? 0));
    $userFilter = (string) ($query['userId'] ?? '');
    $filterUserId = $userFilter === 'me' ? $user['id'] : (ctype_digit($userFilter) ? (int) $userFilter : null);

    $statement = $pdo->prepare(
        "SELECT b.id, b.artikel_id, b.zeitpunkt, b.aktion, b.event_type, b.user_id, b.undone_at, b.undone_by,
                b.von_ort_id, b.nach_ort_id,
                COALESCE(b.user_email, u.email) AS user_email,
                a.kategorie, a.groesse, a.aktiv, a.aktueller_ort_id,
                ov.typ AS von_typ, ov.name AS von_name, kv.vorname AS von_vorname, kv.nachname AS von_nachname,
                nv.typ AS nach_typ, nv.name AS nach_name, kn.vorname AS nach_vorname, kn.nachname AS nach_nachname,
                latest.id AS latest_id
         FROM bewegung b
         JOIN artikel a ON a.id = b.artikel_id
         LEFT JOIN app_user u ON u.id = b.user_id
         LEFT JOIN ort ov ON ov.id = b.von_ort_id
         LEFT JOIN kind kv ON kv.id = ov.kind_id
         LEFT JOIN ort nv ON nv.id = b.nach_ort_id
         LEFT JOIN kind kn ON kn.id = nv.kind_id
         LEFT JOIN LATERAL (
             SELECT MAX(id) AS id FROM bewegung
             WHERE artikel_id = b.artikel_id AND event_type IN " . LOCATION_EVENTS . "
         ) latest ON true
         WHERE b.event_type IN " . LOCATION_EVENTS . "
           AND b.zeitpunkt > NOW() - make_interval(days => :days)
           AND (CAST(:user_id AS INTEGER) IS NULL OR b.user_id = CAST(:user_id AS INTEGER))
         ORDER BY b.id DESC
         LIMIT :limit OFFSET :offset"
    );
    $statement->bindValue(':days', MOVEMENT_UNDO_DAYS, PDO::PARAM_INT);
    $statement->bindValue(':user_id', $filterUserId, $filterUserId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    $statement->bindValue(':limit', $limit + 1, PDO::PARAM_INT);
    $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
    $statement->execute();
    $rows = $statement->fetchAll();

    $hasMore = count($rows) > $limit;
    $rows = array_slice($rows, 0, $limit);

    $place = static function (?string $type, ?string $name, ?string $first, ?string $last): ?array {
        if ($type === null) {
            return null;
        }
        return [
            'type' => $type,
            'name' => $type === 'kind' ? trim(($first ?? '') . ' ' . ($last ?? '')) : ($name ?? 'Lager'),
        ];
    };

    $entries = array_map(static function (array $row) use ($user, $place): array {
        $blocker = in_array($row['event_type'], ['create', 'transfer'], true)
            ? movement_undo_blocker($row, $user, (int) $row['latest_id'] === (int) $row['id'])
            : null;

        return [
            'id' => (int) $row['id'],
            'articleId' => $row['artikel_id'],
            'category' => $row['kategorie'],
            'size' => $row['groesse'],
            'articleActive' => normalize_bool($row['aktiv']),
            'performedAt' => $row['zeitpunkt'],
            'eventType' => $row['event_type'],
            'action' => $row['aktion'],
            'userEmail' => $row['user_email'],
            'from' => $place($row['von_typ'], $row['von_name'], $row['von_vorname'], $row['von_nachname']),
            'to' => $place($row['nach_typ'], $row['nach_name'], $row['nach_vorname'], $row['nach_nachname']),
            'undoneAt' => $row['undone_at'],
            'undoneBy' => $row['undone_by'],
            'canUndo' => in_array($row['event_type'], ['create', 'transfer'], true) && $blocker === null,
            'undoBlockedReason' => in_array($row['event_type'], ['create', 'transfer'], true) ? $blocker : null,
        ];
    }, $rows);

    return ['entries' => $entries, 'hasMore' => $hasMore, 'days' => MOVEMENT_UNDO_DAYS];
}
