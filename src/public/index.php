<?php

declare(strict_types=1);

// Global classes used within this front controller.

require_once __DIR__ . '/../app/bootstrap.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

set_exception_handler(static function (Throwable $throwable): void {
    error_log($throwable->getMessage());
    json_error('Internal Server Error', 500);
});

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = rtrim($path, '/') ?: '/';
$pdo = db();
ensure_schema($pdo);

switch (true) {
    case $method === 'GET' && $path === '/health':
    case $method === 'GET' && $path === '/':
        json_response([
            'app' => 'Digitale Kleiderkammer',
            'status' => 'ready',
            'timestamp' => (new DateTimeImmutable())->format(DateTimeImmutable::ATOM),
        ]);

    case $method === 'GET' && $path === '/api/children':
        json_response(['data' => list_children($pdo)]);

    case $method === 'GET' && preg_match('#^/api/children/([0-9]+)/articles$#', $path, $matches):
        $childId = (int) $matches[1];
        json_response(['data' => list_child_articles($pdo, $childId)]);

    case $method === 'POST' && $path === '/api/children':
        $body = read_json_body();
        json_response(['data' => create_child($pdo, $body)], 201);

    case $method === 'GET' && $path === '/api/articles':
        $assignedOnly = isset($_GET['assigned']) ? filter_var($_GET['assigned'], FILTER_VALIDATE_BOOLEAN) : false;
        json_response(['data' => list_articles($pdo, ['assignedOnly' => $assignedOnly])]);

    case $method === 'DELETE' && $path === '/api/articles':
        json_response(['data' => purge_articles($pdo)]);

    case $method === 'GET' && $path === '/api/users':
        json_response(['data' => list_users($pdo)]);

    case $method === 'GET' && preg_match('#^/api/articles/([0-9]+)$#', $path, $matches):
        $articleId = sanitize_article_id($matches[1]);
        json_response(['data' => fetch_article($pdo, $articleId)]);

    case $method === 'PATCH' && preg_match('#^/api/articles/([0-9]+)$#', $path, $matches):
        $articleId = sanitize_article_id($matches[1]);
        $body = read_json_body();
        json_response(['data' => update_article($pdo, $articleId, $body)]);

    case $method === 'POST' && $path === '/api/articles':
        $body = read_json_body();
        json_response(['data' => create_article($pdo, $body)], 201);

    case $method === 'POST' && $path === '/api/users':
        $body = read_json_body();
        json_response(['data' => create_user($pdo, $body)], 201);

    case $method === 'PATCH' && preg_match('#^/api/articles/([0-9]+)/assignment$#', $path, $matches):
        $articleId = $matches[1];
        $body = read_json_body();
        json_response(['data' => update_article_assignment($pdo, $articleId, $body)]);

    case $method === 'POST' && preg_match('#^/api/articles/([0-9]+)/helmet-check$#', $path, $matches):
        $articleId = $matches[1];
        $body = read_json_body();
        json_response(['data' => complete_helmet_check($pdo, $articleId, $body)]);

    case $method === 'DELETE' && preg_match('#^/api/articles/([0-9]+)$#', $path, $matches):
        $articleId = $matches[1];
        json_response(['data' => delete_article($pdo, $articleId)]);

    case $method === 'PATCH' && preg_match('#^/api/children/([0-9]+)$#', $path, $matches):
        $childId = (int) $matches[1];
        $body = read_json_body();
        json_response(['data' => update_child($pdo, $childId, $body)]);

    case $method === 'DELETE' && preg_match('#^/api/children/([0-9]+)$#', $path, $matches):
        $childId = (int) $matches[1];
        json_response(['data' => delete_child($pdo, $childId)]);

    default:
        json_error('Not Found', 404);
}

function list_children(PDO $pdo): array
{
    $query = <<<SQL
        SELECT
            k.id,
            k.vorname,
            k.nachname,
            k.status,
            k.created_at,
            COALESCE(ac.article_count, 0) AS article_count
        FROM kind k
        LEFT JOIN (
            SELECT o.kind_id, COUNT(*) AS article_count
            FROM artikel a
            JOIN ort o ON o.id = a.aktueller_ort_id
            WHERE a.aktiv = true AND o.typ = 'kind' AND o.kind_id IS NOT NULL
            GROUP BY o.kind_id
        ) ac ON ac.kind_id = k.id
        ORDER BY lower(k.nachname), lower(k.vorname)
    SQL;

    $statement = $pdo->query($query);

    return array_map(static fn(array $row) => [
        'id' => (int) $row['id'],
        'firstName' => $row['vorname'],
        'lastName' => $row['nachname'],
        'status' => $row['status'],
        'createdAt' => $row['created_at'],
        'articleCount' => (int) $row['article_count'],
    ], $statement->fetchAll());
}

function list_child_articles(PDO $pdo, int $childId): array
{
    fetch_child($pdo, $childId);

    $statement = $pdo->prepare(<<<SQL
        SELECT
            a.id,
            a.kategorie,
            a.bezeichnung,
            a.groesse,
            a.notizen,
            a.ablaufdatum,
            a.helm_naechste_pruefung,
            a.helm_letzte_pruefung,
            a.helm_herstellungsdatum,
            a.updated_at,
            o.typ AS ort_typ,
            o.name AS ort_name,
            o.kind_id,
            k.vorname,
            k.nachname,
            mv.zeitpunkt AS letzte_bewegung
        FROM artikel a
        JOIN ort o ON o.id = a.aktueller_ort_id
        LEFT JOIN kind k ON k.id = o.kind_id
        LEFT JOIN LATERAL (
            SELECT zeitpunkt
            FROM bewegung b
            WHERE b.artikel_id = a.id
            ORDER BY zeitpunkt DESC
            LIMIT 1
        ) mv ON true
        WHERE a.aktiv = true AND o.typ = 'kind' AND o.kind_id = :child_id
        ORDER BY a.id
    SQL);

    $statement->execute([':child_id' => $childId]);

    return array_map('transform_article_row', $statement->fetchAll());
}

function fetch_child(PDO $pdo, int $childId): array
{
    $statement = $pdo->prepare('SELECT id, vorname, nachname, status, created_at FROM kind WHERE id = :id');
    $statement->execute([':id' => $childId]);
    $row = $statement->fetch();

    if (!$row) {
        json_error('Kind wurde nicht gefunden.', 404);
    }

    return [
        'id' => (int) $row['id'],
        'firstName' => $row['vorname'],
        'lastName' => $row['nachname'],
        'status' => $row['status'],
        'createdAt' => $row['created_at'],
    ];
}

function create_child(PDO $pdo, array $payload): array
{
    $firstName = trim((string)($payload['firstName'] ?? ''));
    $lastName = trim((string)($payload['lastName'] ?? ''));

    if ($firstName === '' || $lastName === '') {
        json_error('Vorname und Nachname werden benötigt.', 422);
    }

    $pdo->beginTransaction();

    try {
        $insertChild = $pdo->prepare('INSERT INTO kind (vorname, nachname) VALUES (:vorname, :nachname) RETURNING id, status, created_at');
        $insertChild->execute([':vorname' => $firstName, ':nachname' => $lastName]);
        $newChild = $insertChild->fetch();

        $pdo->prepare("INSERT INTO ort (typ, name, kind_id) VALUES ('kind', :name, :kind_id)")
            ->execute([
                ':name' => sprintf('Kind %s %s', $firstName, $lastName),
                ':kind_id' => $newChild['id'],
            ]);

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return [
        'id' => (int) $newChild['id'],
        'firstName' => $firstName,
        'lastName' => $lastName,
        'status' => $newChild['status'],
        'createdAt' => $newChild['created_at'],
    ];
}

function update_child(PDO $pdo, int $childId, array $payload): array
{
    $haveFirstName = array_key_exists('firstName', $payload);
    $haveLastName = array_key_exists('lastName', $payload);
    $haveStatus = array_key_exists('status', $payload);

    $firstName = $haveFirstName ? trim((string) $payload['firstName']) : null;
    $lastName = $haveLastName ? trim((string) $payload['lastName']) : null;
    $status = $haveStatus ? trim((string) $payload['status']) : null;

    if ($haveFirstName && $firstName === '') {
        json_error('Vorname darf nicht leer sein.', 422);
    }

    if ($haveLastName && $lastName === '') {
        json_error('Nachname darf nicht leer sein.', 422);
    }

    if ($haveStatus && !in_array($status, ['aktiv', 'inaktiv'], true)) {
        json_error('Ungültiger Status.', 422);
    }

    if (!$haveFirstName && !$haveLastName && !$haveStatus) {
        json_error('Keine Änderungen übermittelt.', 422);
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare('SELECT id, vorname, nachname FROM kind WHERE id = :id FOR UPDATE');
        $statement->execute([':id' => $childId]);
        $current = $statement->fetch();

        if (!$current) {
            rollback_if_needed($pdo);
            json_error('Kind wurde nicht gefunden.', 404);
        }

        $fields = [];
        if ($haveFirstName) {
            $fields['vorname'] = $firstName;
        }
        if ($haveLastName) {
            $fields['nachname'] = $lastName;
        }
        if ($haveStatus) {
            $fields['status'] = $status;
        }

        $setParts = [];
        $params = [':id' => $childId];
        foreach ($fields as $column => $value) {
            $param = ':' . $column;
            $setParts[] = sprintf('%s = %s', $column, $param);
            $params[$param] = $value;
        }

        $sql = sprintf('UPDATE kind SET %s WHERE id = :id', implode(', ', $setParts));
        $pdo->prepare($sql)->execute($params);

        if ($haveFirstName || $haveLastName) {
            $newFirst = $haveFirstName ? $firstName : $current['vorname'];
            $newLast = $haveLastName ? $lastName : $current['nachname'];
            $pdo->prepare("UPDATE ort SET name = :name WHERE typ = 'kind' AND kind_id = :kind_id")
                ->execute([
                    ':name' => sprintf('Kind %s %s', $newFirst, $newLast),
                    ':kind_id' => $childId,
                ]);
        }

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return fetch_child($pdo, $childId);
}

function list_articles(PDO $pdo, array $options = []): array
{
    $assignedOnly = (bool)($options['assignedOnly'] ?? false);

    $query = <<<SQL
        SELECT
            a.id,
            a.kategorie,
            a.bezeichnung,
            a.groesse,
            a.notizen,
            a.ablaufdatum,
            a.helm_naechste_pruefung,
            a.helm_letzte_pruefung,
            a.helm_herstellungsdatum,
            a.updated_at,
            o.typ AS ort_typ,
            o.name AS ort_name,
            o.kind_id,
            k.vorname,
            k.nachname,
            mv.zeitpunkt AS letzte_bewegung
        FROM artikel a
        JOIN ort o ON o.id = a.aktueller_ort_id
        LEFT JOIN kind k ON k.id = o.kind_id
        LEFT JOIN LATERAL (
            SELECT zeitpunkt
            FROM bewegung b
            WHERE b.artikel_id = a.id
            ORDER BY zeitpunkt DESC
            LIMIT 1
        ) mv ON true
        WHERE a.aktiv = true
    SQL;

    if ($assignedOnly) {
        $query .= " AND o.typ = 'kind'";
    }

    $query .= ' ORDER BY a.id';

    $statement = $pdo->query($query);
    $rows = $statement->fetchAll();

    return array_map('transform_article_row', $rows);
}

function create_article(PDO $pdo, array $payload): array
{
    $id = sanitize_article_id((string)($payload['id'] ?? $payload['articleNumber'] ?? ''));
    $category = trim((string)($payload['category'] ?? ''));
    $label = trim((string)($payload['label'] ?? ''));
    $size = trim((string)($payload['size'] ?? '')) ?: null;
    $rawNotes = trim((string)($payload['notes'] ?? '')) ?: null;
    $locationType = $payload['locationType'] ?? 'lager';
    $kindId = isset($payload['kindId']) ? (int) $payload['kindId'] : null;
    $categoryKey = mb_strtolower($category);
    $helmetManufacturedAt = null;
    $expiryDate = normalize_date_input($payload['expiryDate'] ?? null, 'Ablaufdatum');

    if ($id === '' || $category === '') {
        json_error('Artikelnummer und Kategorie werden benötigt.', 422);
    }

    if ($label === '') {
        $label = $category;
    }

    if ($categoryKey === 'helm') {
        $helmetManufacturedAt = normalize_date_input($payload['helmetManufacturedAt'] ?? null, 'Herstellungsdatum');

        if ($helmetManufacturedAt === null) {
            json_error('Für Helme wird ein Herstellungsdatum benötigt.', 422);
        }

        $expiryDate = (new DateTimeImmutable($helmetManufacturedAt))->modify('+10 years')->format('Y-m-d');
    }

    $pdo->beginTransaction();

    try {
        $targetOrtId = $locationType === 'kind'
            ? get_kind_ort_id($pdo, $kindId)
            : get_lager_ort_id($pdo);

        $insert = $pdo->prepare('INSERT INTO artikel (id, kategorie, bezeichnung, groesse, notizen, ablaufdatum, helm_herstellungsdatum, aktueller_ort_id) VALUES (:id, :kategorie, :bezeichnung, :groesse, :notizen, :ablaufdatum, :helm_herstellungsdatum, :ort_id)');
        $insert->execute([
            ':id' => $id,
            ':kategorie' => $category,
            ':bezeichnung' => $label,
            ':groesse' => $size,
            ':notizen' => $rawNotes ? append_note_entry($rawNotes, null) : null,
            ':ablaufdatum' => $expiryDate,
            ':helm_herstellungsdatum' => $helmetManufacturedAt,
            ':ort_id' => $targetOrtId,
        ]);

        $movement = $pdo->prepare('INSERT INTO bewegung (artikel_id, nach_ort_id, aktion, event_type, new_value) VALUES (:artikel_id, :nach_ort_id, :aktion, :event_type, :new_value)');
        $movement->execute([
            ':artikel_id' => $id,
            ':nach_ort_id' => $targetOrtId,
            ':aktion' => 'create',
            ':event_type' => 'create',
            ':new_value' => json_encode(['kategorie' => $category, 'groesse' => $size], JSON_UNESCAPED_UNICODE),
        ]);

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return fetch_article($pdo, $id);
}

function update_article(PDO $pdo, string $articleId, array $payload): array
{
    $articleId = sanitize_article_id($articleId);

    $stringMap = [
        'category' => 'kategorie',
        'label' => 'bezeichnung',
        'size' => 'groesse',
    ];

    $dateMap = [
        'expiryDate' => ['column' => 'ablaufdatum', 'label' => 'Ablaufdatum'],
        'helmetNextCheck' => ['column' => 'helm_naechste_pruefung', 'label' => 'Nächste Prüfung'],
        'helmetLastCheck' => ['column' => 'helm_letzte_pruefung', 'label' => 'Letzte Prüfung'],
        'helmetManufacturedAt' => ['column' => 'helm_herstellungsdatum', 'label' => 'Herstellungsdatum'],
    ];

    $fields = [];

    foreach ($stringMap as $payloadKey => $column) {
        if (!array_key_exists($payloadKey, $payload)) {
            continue;
        }

        $value = trim((string) $payload[$payloadKey]);

        if (in_array($payloadKey, ['category', 'label'], true) && $value === '') {
            json_error(sprintf('%s darf nicht leer sein.', ucfirst($payloadKey)), 422);
        }

        if (in_array($payloadKey, ['size', 'notes'], true) && $value === '') {
            $value = null;
        }

        $fields[$column] = $value;
    }

    foreach ($dateMap as $payloadKey => $meta) {
        if (!array_key_exists($payloadKey, $payload)) {
            continue;
        }

        $fields[$meta['column']] = normalize_date_input($payload[$payloadKey], $meta['label']);
    }

    if (!$fields) {
        json_error('Keine Änderungen übermittelt.', 422);
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare('SELECT id, kategorie, bezeichnung, groesse, notizen, ablaufdatum, helm_naechste_pruefung, helm_letzte_pruefung, helm_herstellungsdatum, aktueller_ort_id FROM artikel WHERE id = :id FOR UPDATE');
        $statement->execute([':id' => $articleId]);
        $current = $statement->fetch();

        if (!$current) {
            rollback_if_needed($pdo);
            json_error('Artikel wurde nicht gefunden.', 404);
        }

        $resultingCategory = $fields['kategorie'] ?? $current['kategorie'];
        $resultingManufacturedAt = array_key_exists('helm_herstellungsdatum', $fields)
            ? $fields['helm_herstellungsdatum']
            : $current['helm_herstellungsdatum'];

        if (mb_strtolower((string) $resultingCategory) === 'helm' && !$resultingManufacturedAt) {
            rollback_if_needed($pdo);
            json_error('Für Helme wird ein Herstellungsdatum benötigt.', 422);
        }

        if (mb_strtolower((string) $resultingCategory) === 'helm') {
            $helmetExpiry = (new DateTimeImmutable($resultingManufacturedAt))->modify('+10 years')->format('Y-m-d');
            $fields['ablaufdatum'] = $helmetExpiry;
        }

        $noteProvided = array_key_exists('notes', $payload);
        $noteValue = $noteProvided ? trim((string) $payload['notes']) : null;

        if ($noteProvided && $noteValue !== '') {
            $existingNotes = $current['notizen'] ?? null;
            $fields['notizen'] = append_note_entry($noteValue, $existingNotes ? (string) $existingNotes : null);
        }

        $setParts = [];
        $params = [':id' => $articleId];

        foreach ($fields as $column => $value) {
            $param = ':' . $column;
            $setParts[] = sprintf('%s = %s', $column, $param);
            $params[$param] = $value;
        }

        $sql = sprintf('UPDATE artikel SET %s, updated_at = NOW() WHERE id = :id', implode(', ', $setParts));
        $pdo->prepare($sql)->execute($params);

        [$oldPayload, $newPayload] = build_article_change_payload($fields, $current);

        if ($oldPayload || $newPayload) {
            $movement = $pdo->prepare('INSERT INTO bewegung (artikel_id, von_ort_id, nach_ort_id, aktion, event_type, old_value, new_value) VALUES (:artikel_id, :von, :nach, :aktion, :event_type, :old_value, :new_value)');
            $movement->execute([
                ':artikel_id' => $articleId,
                ':von' => $current['aktueller_ort_id'],
                ':nach' => $current['aktueller_ort_id'],
                ':aktion' => 'update',
                ':event_type' => 'update',
                ':old_value' => json_encode($oldPayload, JSON_UNESCAPED_UNICODE),
                ':new_value' => json_encode($newPayload, JSON_UNESCAPED_UNICODE),
            ]);
        }

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return fetch_article($pdo, $articleId);
}

function update_article_assignment(PDO $pdo, string $articleId, array $payload): array
{
    $targetType = $payload['targetType'] ?? null;
    $kindId = isset($payload['kindId']) ? (int) $payload['kindId'] : null;

    if ($targetType !== 'lager' && $targetType !== 'kind') {
        json_error('Ungültiger Zieltyp.', 422);
    }

    $pdo->beginTransaction();

    try {
        $article = $pdo->prepare('SELECT aktueller_ort_id FROM artikel WHERE id = :id FOR UPDATE');
        $article->execute([':id' => $articleId]);
        $current = $article->fetch();

        if (!$current) {
            rollback_if_needed($pdo);
            json_error('Artikel wurde nicht gefunden.', 404);
        }

        $targetOrtId = $targetType === 'kind'
            ? get_kind_ort_id($pdo, $kindId)
            : get_lager_ort_id($pdo);

        if ((int) $current['aktueller_ort_id'] === $targetOrtId) {
            rollback_if_needed($pdo);
            return fetch_article($pdo, $articleId);
        }

        $update = $pdo->prepare('UPDATE artikel SET aktueller_ort_id = :ort_id, updated_at = NOW() WHERE id = :id');
        $update->execute([':ort_id' => $targetOrtId, ':id' => $articleId]);

        $movement = $pdo->prepare('INSERT INTO bewegung (artikel_id, von_ort_id, nach_ort_id, aktion, event_type) VALUES (:artikel_id, :von, :nach, :aktion, :event_type)');
        $movement->execute([
            ':artikel_id' => $articleId,
            ':von' => $current['aktueller_ort_id'],
            ':nach' => $targetOrtId,
            ':aktion' => $targetType === 'kind' ? 'ausgabe' : 'rueckgabe',
            ':event_type' => 'transfer',
        ]);

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return fetch_article($pdo, $articleId);
}

function complete_helmet_check(PDO $pdo, string $articleId, array $payload): array
{
    $performedInput = normalize_date_input($payload['date'] ?? null, 'Prüfdatum');
    $performedAt = $performedInput !== null ? new DateTimeImmutable($performedInput) : today();
    $nextCheck = $performedAt->modify('+2 years');

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare('SELECT kategorie, helm_letzte_pruefung, helm_naechste_pruefung, aktueller_ort_id FROM artikel WHERE id = :id FOR UPDATE');
        $statement->execute([':id' => $articleId]);
        $row = $statement->fetch();

        if (!$row) {
            rollback_if_needed($pdo);
            json_error('Artikel wurde nicht gefunden.', 404);
        }

        if (mb_strtolower((string) $row['kategorie']) !== 'helm') {
            rollback_if_needed($pdo);
            json_error('Prüfungen können nur für Helme dokumentiert werden.', 422);
        }

        $update = $pdo->prepare('UPDATE artikel SET helm_letzte_pruefung = :last, helm_naechste_pruefung = :next, updated_at = NOW() WHERE id = :id');
        $update->execute([
            ':last' => $performedAt->format('Y-m-d'),
            ':next' => $nextCheck->format('Y-m-d'),
            ':id' => $articleId,
        ]);

        $movement = $pdo->prepare('INSERT INTO bewegung (artikel_id, von_ort_id, nach_ort_id, aktion, event_type, old_value, new_value) VALUES (:artikel_id, :von, :nach, :aktion, :event_type, :old_value, :new_value)');
        $movement->execute([
            ':artikel_id' => $articleId,
            ':von' => $row['aktueller_ort_id'],
            ':nach' => $row['aktueller_ort_id'],
            ':aktion' => 'pruefung_update',
            ':event_type' => 'pruefung_update',
            ':old_value' => json_encode([
                'helm_letzte_pruefung' => $row['helm_letzte_pruefung'],
                'helm_naechste_pruefung' => $row['helm_naechste_pruefung'],
            ], JSON_UNESCAPED_UNICODE),
            ':new_value' => json_encode([
                'helm_letzte_pruefung' => $performedAt->format('Y-m-d'),
                'helm_naechste_pruefung' => $nextCheck->format('Y-m-d'),
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return fetch_article($pdo, $articleId);
}

function delete_article(PDO $pdo, string $articleId): array
{
    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare('SELECT aktueller_ort_id, aktiv FROM artikel WHERE id = :id FOR UPDATE');
        $statement->execute([':id' => $articleId]);
        $row = $statement->fetch();

        if (!$row || !$row['aktiv']) {
            rollback_if_needed($pdo);
            json_error('Artikel wurde nicht gefunden.', 404);
        }

        $pdo->prepare('UPDATE artikel SET aktiv = false, updated_at = NOW() WHERE id = :id')
            ->execute([':id' => $articleId]);

        $movement = $pdo->prepare('INSERT INTO bewegung (artikel_id, von_ort_id, nach_ort_id, aktion, event_type) VALUES (:artikel_id, :von, :nach, :aktion, :event_type)');
        $movement->execute([
            ':artikel_id' => $articleId,
            ':von' => $row['aktueller_ort_id'],
            ':nach' => $row['aktueller_ort_id'],
            ':aktion' => 'delete',
            ':event_type' => 'delete',
        ]);

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return ['deleted' => true, 'id' => $articleId];
}

function delete_child(PDO $pdo, int $childId): array
{
    $pdo->beginTransaction();

    try {
        $child = $pdo->prepare('SELECT id FROM kind WHERE id = :id FOR UPDATE');
        $child->execute([':id' => $childId]);

        if (!$child->fetch()) {
            rollback_if_needed($pdo);
            json_error('Kind wurde nicht gefunden.', 404);
        }

        $ortStatement = $pdo->prepare("SELECT id FROM ort WHERE typ = 'kind' AND kind_id = :kind_id");
        $ortStatement->execute([':kind_id' => $childId]);
        $ort = $ortStatement->fetch();

        if ($ort) {
            $count = $pdo->prepare('SELECT COUNT(*) FROM artikel WHERE aktueller_ort_id = :ort_id AND aktiv = true');
            $count->execute([':ort_id' => $ort['id']]);
            if ((int) $count->fetchColumn() > 0) {
                rollback_if_needed($pdo);
                json_error('Dem Kind sind noch Artikel zugeordnet.', 409);
            }
        }

        $pdo->prepare('DELETE FROM kind WHERE id = :id')->execute([':id' => $childId]);

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return ['deleted' => true, 'id' => $childId];
}

function list_users(PDO $pdo): array
{
    $statement = $pdo->query('SELECT id, email, role, active, created_at FROM app_user ORDER BY lower(email)');

    return array_map(static fn(array $row) => [
        'id' => (int) $row['id'],
        'email' => $row['email'],
        'role' => $row['role'],
        'active' => normalize_bool($row['active']),
        'createdAt' => $row['created_at'],
    ], $statement->fetchAll());
}

function create_user(PDO $pdo, array $payload): array
{
    $email = mb_strtolower(trim((string)($payload['email'] ?? '')));
    $password = (string)($payload['password'] ?? '');
    $role = mb_strtolower(trim((string)($payload['role'] ?? 'leser')));
    $activeInput = $payload['active'] ?? true;
    $active = filter_var($activeInput, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    $active = $active === null ? true : $active;
    $validRoles = ['leser', 'verwalter', 'admin'];

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_error('E-Mail ist ungültig.', 422);
    }

    if (!in_array($role, $validRoles, true)) {
        json_error('Rolle ist ungültig.', 422);
    }

    if (trim($password) === '' || strlen($password) < 8) {
        json_error('Passwort muss mindestens 8 Zeichen enthalten.', 422);
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);

    if ($hash === false) {
        json_error('Passwort konnte nicht verarbeitet werden.', 500);
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->prepare('INSERT INTO app_user (email, password_hash, role, active) VALUES (:email, :password_hash, :role, :active) RETURNING id, email, role, active, created_at');
        $statement->execute([
            ':email' => $email,
            ':password_hash' => $hash,
            ':role' => $role,
            ':active' => $active,
        ]);

        $row = $statement->fetch();
        $pdo->commit();

        return [
            'id' => (int) $row['id'],
            'email' => $row['email'],
            'role' => $row['role'],
            'active' => normalize_bool($row['active']),
            'createdAt' => $row['created_at'],
        ];
    } catch (PDOException $exception) {
        rollback_if_needed($pdo);

        if ($exception->getCode() === '23505') {
            json_error('E-Mail ist bereits vergeben.', 422);
        }

        throw $exception;
    }
}

function fetch_article(PDO $pdo, string $articleId): array
{
    $statement = $pdo->prepare('SELECT a.id, a.kategorie, a.bezeichnung, a.groesse, a.notizen, a.ablaufdatum, a.helm_naechste_pruefung, a.helm_letzte_pruefung, a.helm_herstellungsdatum, a.updated_at, o.typ AS ort_typ, o.name AS ort_name, o.kind_id, k.vorname, k.nachname, mv.zeitpunkt AS letzte_bewegung FROM artikel a JOIN ort o ON o.id = a.aktueller_ort_id LEFT JOIN kind k ON k.id = o.kind_id LEFT JOIN LATERAL (SELECT zeitpunkt FROM bewegung WHERE artikel_id = a.id ORDER BY zeitpunkt DESC LIMIT 1) mv ON true WHERE a.id = :id');
    $statement->execute([':id' => $articleId]);
    $row = $statement->fetch();

    if (!$row) {
        json_error('Artikel wurde nicht gefunden.', 404);
    }

    $movements = fetch_article_movements($pdo, $articleId, 3);
    $noteEntries = extract_note_entries($row['notizen'] ?? null);

    return transform_article_row($row, true, $movements, $noteEntries);
}

function transform_article_row(array $row, bool $includeHistory = false, array $movementHistory = [], array $noteEntries = []): array
{
    $locationType = $row['ort_typ'];
    $isHelmet = mb_strtolower($row['kategorie']) === 'helm';
    $status = $locationType === 'kind' ? 'ausgegeben' : 'frei';
    $warning = null;
    $today = today();
    $warningWindow = in_days($today, 30);

    if ($isHelmet) {
        if (!empty($row['helm_naechste_pruefung'])) {
            $nextCheck = new DateTimeImmutable($row['helm_naechste_pruefung']);
            if ($nextCheck <= $warningWindow) {
                $status = 'warnung';
                $warning = [
                    'type' => 'pruefung',
                    'date' => $row['helm_naechste_pruefung'],
                    'windowDays' => 30,
                ];
            }
        }

        if (!empty($row['ablaufdatum'])) {
            $expiry = new DateTimeImmutable($row['ablaufdatum']);
            if ($expiry <= $warningWindow) {
                $status = 'warnung';
                $warning = [
                    'type' => 'ablauf',
                    'date' => $row['ablaufdatum'],
                    'windowDays' => 30,
                ];
            }
        }
    }

    $locationName = $locationType === 'kind'
        ? trim(($row['vorname'] ?? '') . ' ' . ($row['nachname'] ?? ''))
        : ($row['ort_name'] ?? 'Lager');

    $article = [
        'id' => $row['id'],
        'category' => $row['kategorie'],
        'label' => $row['bezeichnung'],
        'size' => $row['groesse'],
        'notes' => $row['notizen'],
        'status' => $status,
        'location' => [
            'type' => $locationType,
            'name' => $locationName,
            'kindId' => $row['kind_id'] ? (int) $row['kind_id'] : null,
        ],
        'assignedAt' => $row['letzte_bewegung'] ?? $row['updated_at'],
        'expiryDate' => $row['ablaufdatum'],
        'helmetNextCheck' => $row['helm_naechste_pruefung'],
        'helmetLastCheck' => $row['helm_letzte_pruefung'],
        'helmetManufacturedAt' => $row['helm_herstellungsdatum'],
        'warning' => $warning,
    ];

    if ($includeHistory) {
        $article['movementHistory'] = $movementHistory;
        $article['noteEntries'] = $noteEntries;
    }

    return $article;
}

function fetch_article_movements(PDO $pdo, string $articleId, int $limit = 3): array
{
    $statement = $pdo->prepare('SELECT b.id, b.zeitpunkt, b.aktion, b.event_type, ov.typ AS von_typ, ov.name AS von_name, ov.kind_id AS von_kind_id, nv.typ AS nach_typ, nv.name AS nach_name, nv.kind_id AS nach_kind_id FROM bewegung b LEFT JOIN ort ov ON ov.id = b.von_ort_id LEFT JOIN ort nv ON nv.id = b.nach_ort_id WHERE b.artikel_id = :artikel_id ORDER BY b.zeitpunkt DESC LIMIT :limit');
    $statement->bindValue(':artikel_id', $articleId);
    $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
    $statement->execute();

    $rows = $statement->fetchAll();

    return array_map('transform_movement_row', $rows);
}

function transform_movement_row(array $row): array
{
    $from = null;
    if (!empty($row['von_typ'])) {
        $from = [
            'type' => $row['von_typ'],
            'name' => $row['von_name'],
            'kindId' => $row['von_kind_id'] ? (int) $row['von_kind_id'] : null,
        ];
    }

    $to = null;
    if (!empty($row['nach_typ'])) {
        $to = [
            'type' => $row['nach_typ'],
            'name' => $row['nach_name'],
            'kindId' => $row['nach_kind_id'] ? (int) $row['nach_kind_id'] : null,
        ];
    }

    return [
        'id' => (int) $row['id'],
        'action' => $row['aktion'],
        'eventType' => $row['event_type'],
        'performedAt' => $row['zeitpunkt'],
        'from' => $from,
        'to' => $to,
    ];
}

function extract_note_entries(?string $notes): array
{
    if ($notes === null) {
        return [];
    }

    $trimmed = trim($notes);

    if ($trimmed === '') {
        return [];
    }

    $lines = preg_split('/\R/', $trimmed) ?: [];
    $entries = [];

    foreach ($lines as $index => $line) {
        $clean = trim($line);

        if ($clean === '') {
            continue;
        }

        if (preg_match('/^\[(.+?)\]\s*(.+)$/u', $clean, $matches)) {
            $label = $matches[1];
            $text = $matches[2];
            $parsed = DateTimeImmutable::createFromFormat('d.m.Y H:i', $label);

            $entries[] = [
                'id' => sprintf('note-%d', $index),
                'timestamp' => $parsed ? $parsed->format(DateTimeInterface::ATOM) : null,
                'label' => $label,
                'text' => $text,
            ];

            continue;
        }

        $entries[] = [
            'id' => sprintf('note-%d', $index),
            'timestamp' => null,
            'label' => null,
            'text' => $clean,
        ];
    }

    return $entries;
}

function build_article_change_payload(array $fields, array $current): array
{
    if (!$fields) {
        return [[], []];
    }

    $map = [
        'kategorie' => 'category',
        'bezeichnung' => 'label',
        'groesse' => 'size',
        'notizen' => 'notes',
        'ablaufdatum' => 'expiryDate',
        'helm_naechste_pruefung' => 'helmetNextCheck',
        'helm_letzte_pruefung' => 'helmetLastCheck',
        'helm_herstellungsdatum' => 'helmetManufacturedAt',
    ];

    $old = [];
    $new = [];

    foreach ($fields as $column => $value) {
        $key = $map[$column] ?? $column;
        $old[$key] = $current[$column] ?? null;
        $new[$key] = $value;
    }

    return [$old, $new];
}

function append_note_entry(string $note, ?string $existing): string
{
    $trimmed = trim($note);

    if ($trimmed === '') {
        return $existing ?? '';
    }

    $timestamp = (new DateTimeImmutable())->format('d.m.Y H:i');
    $entry = sprintf('[%s] %s', $timestamp, $trimmed);

    if ($existing && trim($existing) !== '') {
        return $entry . PHP_EOL . ltrim($existing);
    }

    return $entry;
}

function normalize_date_input($value, string $fieldLabel): ?string
{
    if ($value === null) {
        return null;
    }

    $raw = trim((string) $value);

    if ($raw === '') {
        return null;
    }

    try {
        $date = new DateTimeImmutable($raw);
    } catch (Throwable $throwable) {
        json_error(sprintf('Ungültiges Datum für %s.', $fieldLabel), 422);
    }

    return $date->format('Y-m-d');
}

function normalize_bool($value): bool
{
    return $value === true
        || $value === 1
        || $value === '1'
        || $value === 't'
        || $value === 'true'
        || $value === 'on';
}

function get_kind_ort_id(PDO $pdo, ?int $kindId): int
{
    if (!$kindId) {
        rollback_if_needed($pdo);
        json_error('Kind-ID wird benötigt.', 422);
    }

    $statement = $pdo->prepare("SELECT id FROM ort WHERE typ = 'kind' AND kind_id = :kind_id");
    $statement->execute([':kind_id' => $kindId]);
    $row = $statement->fetch();

    if (!$row) {
        rollback_if_needed($pdo);
        json_error('Kind wurde nicht gefunden.', 404);
    }

    return (int) $row['id'];
}

function get_lager_ort_id(PDO $pdo): int
{
    $statement = $pdo->query("SELECT id FROM ort WHERE typ = 'lager' ORDER BY id ASC LIMIT 1");
    $row = $statement->fetch();

    if (!$row) {
        json_error('Kein Lager-Ort gefunden.', 500);
    }

    return (int) $row['id'];
}

function rollback_if_needed(PDO $pdo): void
{
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
