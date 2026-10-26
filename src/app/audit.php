<?php

declare(strict_types=1);

// Protokoll: wer hat wann was gemacht. Einträge werden nur angelegt, nie geändert oder gelöscht.
// Die E-Mail wird mitgespeichert, damit der Eintrag lesbar bleibt, auch wenn der Benutzer später
// umbenannt oder gelöscht wird.

const AUDIT_CATEGORIES = [
    'auth' => 'Anmeldung',
    'article' => 'Artikel',
    'child' => 'Kinder',
    'user' => 'Benutzer',
    'data' => 'Daten',
];

function ensure_audit_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS audit_log (
            id          BIGSERIAL PRIMARY KEY,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            user_id     INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
            user_email  TEXT,
            action      TEXT NOT NULL,
            entity_id   TEXT,
            summary     TEXT NOT NULL,
            details     JSONB,
            ip          TEXT
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)');
}

/**
 * Schreibt einen Protokolleintrag. $action hat die Form "<kategorie>.<was>", z. B. "article.assign".
 * $user ist der angemeldete Benutzer; ohne Angabe wird der aktuelle genommen.
 */
function audit(PDO $pdo, string $action, string $summary, ?string $entityId = null, array $details = [], ?array $user = null, ?string $email = null): void
{
    $user ??= current_user($pdo);

    try {
        $statement = $pdo->prepare(
            'INSERT INTO audit_log (user_id, user_email, action, entity_id, summary, details, ip)
             VALUES (:user_id, :user_email, :action, :entity_id, :summary, :details, :ip)'
        );
        $statement->execute([
            ':user_id' => $user['id'] ?? null,
            ':user_email' => $user['email'] ?? $email,
            ':action' => $action,
            ':entity_id' => $entityId,
            ':summary' => $summary,
            ':details' => $details === [] ? null : json_encode($details, JSON_UNESCAPED_UNICODE),
            ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
        ]);
    } catch (PDOException $exception) {
        // Ein fehlender Protokolleintrag darf die eigentliche Aktion nicht scheitern lassen
        error_log('Audit-Log fehlgeschlagen: ' . $exception->getMessage());
    }
}

function child_display_name(PDO $pdo, int $childId): string
{
    $statement = $pdo->prepare('SELECT vorname, nachname FROM kind WHERE id = :id');
    $statement->execute([':id' => $childId]);
    $row = $statement->fetch();

    return $row ? trim($row['vorname'] . ' ' . $row['nachname']) : "Kind #{$childId}";
}

function article_display_name(PDO $pdo, string $articleId): string
{
    $statement = $pdo->prepare('SELECT kategorie, groesse FROM artikel WHERE id = :id');
    $statement->execute([':id' => $articleId]);
    $row = $statement->fetch();

    if (!$row) {
        return "Artikel {$articleId}";
    }

    $size = $row['groesse'] ? ", {$row['groesse']}" : '';

    return "{$row['kategorie']} {$articleId}{$size}";
}

/**
 * Liste der Felder, die eine Änderungsanfrage berührt, mit deutschen Namen.
 */
function changed_field_labels(array $payload, array $labels): array
{
    $fields = [];
    foreach ($labels as $key => $label) {
        if (array_key_exists($key, $payload)) {
            $fields[] = $label;
        }
    }

    return $fields;
}

function list_audit_log(PDO $pdo, array $query): array
{
    $limit = max(1, min(200, (int) ($query['limit'] ?? 50)));
    $offset = max(0, (int) ($query['offset'] ?? 0));
    $where = [];
    $params = [];

    $category = (string) ($query['category'] ?? '');
    if ($category !== '' && isset(AUDIT_CATEGORIES[$category])) {
        $where[] = 'action LIKE :category';
        $params[':category'] = $category . '.%';
    }

    $userId = (string) ($query['userId'] ?? '');
    if ($userId !== '' && ctype_digit($userId)) {
        $where[] = 'user_id = :user_id';
        $params[':user_id'] = (int) $userId;
    }

    $search = trim((string) ($query['q'] ?? ''));
    if ($search !== '') {
        $where[] = '(summary ILIKE :search OR entity_id ILIKE :search OR user_email ILIKE :search)';
        $params[':search'] = '%' . addcslashes($search, '%_\\') . '%';
    }

    $whereSql = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);

    $statement = $pdo->prepare(
        "SELECT id, created_at, user_id, user_email, action, entity_id, summary, details, ip
         FROM audit_log {$whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT :limit OFFSET :offset"
    );
    foreach ($params as $key => $value) {
        $statement->bindValue($key, $value);
    }
    $statement->bindValue(':limit', $limit + 1, PDO::PARAM_INT);
    $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
    $statement->execute();
    $rows = $statement->fetchAll();

    $hasMore = count($rows) > $limit;
    $rows = array_slice($rows, 0, $limit);

    return [
        'entries' => array_map(static fn(array $row) => [
            'id' => (int) $row['id'],
            'createdAt' => $row['created_at'],
            'userId' => $row['user_id'] !== null ? (int) $row['user_id'] : null,
            'userEmail' => $row['user_email'],
            'action' => $row['action'],
            'entityId' => $row['entity_id'],
            'summary' => $row['summary'],
            'details' => $row['details'] !== null ? json_decode($row['details'], true) : null,
            'ip' => $row['ip'],
        ], $rows),
        'hasMore' => $hasMore,
        'categories' => AUDIT_CATEGORIES,
    ];
}
