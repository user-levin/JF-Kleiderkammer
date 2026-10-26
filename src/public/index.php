<?php

declare(strict_types=1);

// Global classes used within this front controller.

require_once __DIR__ . '/../app/bootstrap.php';
require_once __DIR__ . '/../app/auth.php';
require_once __DIR__ . '/../app/audit.php';
require_once __DIR__ . '/../app/todos.php';
require_once __DIR__ . '/../app/movements.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');

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

if ($method !== 'GET') {
    require_ajax_header();
}

// Anmeldung
switch (true) {
    case $method === 'POST' && $path === '/api/auth/login':
        json_response(['data' => login($pdo, read_json_body())]);

    case $method === 'POST' && $path === '/api/auth/logout':
        logout($pdo);
        json_response(['data' => null]);

    case $method === 'GET' && $path === '/api/auth/me':
        json_response(['data' => current_user($pdo)]);
}

// Rechte pro Route: siehe ROLE_PERMISSIONS in app/auth.php.
// Ohne Anmeldung (Public) nur lesender Zugriff auf Artikel, ohne Namen der Kinder.
switch (true) {
    case $method === 'GET' && $path === '/health':
    case $method === 'GET' && $path === '/':
        json_response([
            'app' => 'Digitale Kleiderkammer',
            'status' => 'ready',
            'timestamp' => (new DateTimeImmutable())->format(DateTimeImmutable::ATOM),
        ]);

    case $method === 'GET' && $path === '/api/children':
        require_permission($pdo, 'children.view');
        json_response(['data' => list_children($pdo)]);

    case $method === 'GET' && $path === '/api/children/export':
        require_permission($pdo, 'children.csv');
        audit($pdo, 'data.children_export', 'Kinderliste als CSV exportiert');
        export_children_csv($pdo);

    case $method === 'POST' && $path === '/api/children/import':
        require_permission($pdo, 'children.csv');
        $result = import_children_csv($pdo, read_json_body());
        audit($pdo, 'child.import', sprintf('CSV-Import: %d Kinder angelegt, %d übersprungen, %d fehlerhaft', $result['created'], $result['skipped'], count($result['errors'])), null, $result);
        json_response(['data' => $result]);

    case $method === 'GET' && preg_match('#^/api/children/([0-9]+)/articles$#', $path, $matches):
        require_permission($pdo, 'children.view');
        $childId = (int) $matches[1];
        json_response(['data' => list_child_articles($pdo, $childId)]);

    case $method === 'POST' && $path === '/api/children':
        require_permission($pdo, 'children.create');
        $body = read_json_body();
        $child = create_child($pdo, $body);
        audit($pdo, 'child.create', "Kind angelegt: {$child['firstName']} {$child['lastName']}", (string) $child['id']);
        json_response(['data' => $child], 201);

    case $method === 'GET' && $path === '/api/articles':
        $assignedOnly = isset($_GET['assigned']) ? filter_var($_GET['assigned'], FILTER_VALIDATE_BOOLEAN) : false;
        $articles = list_articles($pdo, ['assignedOnly' => $assignedOnly]);
        if (!user_can(current_user($pdo), 'children.view')) {
            $articles = array_map('anonymize_article', $articles);
        }
        json_response(['data' => $articles]);

    case $method === 'POST' && $path === '/api/articles/import':
        require_permission($pdo, 'inventory.import');
        $result = import_articles_csv($pdo, read_json_body());
        audit($pdo, 'article.import', sprintf('CSV-Import: %d Artikel angelegt, %d übersprungen, %d fehlerhaft', $result['created'], $result['skipped'], count($result['errors'])), null, $result);
        json_response(['data' => $result]);

    case $method === 'DELETE' && $path === '/api/articles':
        require_permission($pdo, 'articles.edit');
        $result = purge_articles($pdo);
        audit($pdo, 'article.purge', 'Alle Artikel gelöscht', null, $result);
        json_response(['data' => $result]);

    case $method === 'GET' && $path === '/api/users':
        require_permission($pdo, 'users.manage');
        json_response(['data' => list_users($pdo)]);

    case $method === 'GET' && $path === '/api/data/export':
        require_permission($pdo, 'data.backup');
        audit($pdo, 'data.export', 'Komplettes Backup exportiert');
        export_data($pdo);

    case $method === 'POST' && $path === '/api/data/import':
        require_permission($pdo, 'data.backup');
        $body = read_json_body();
        $result = import_data($pdo, $body);
        audit($pdo, 'data.import', 'Backup eingespielt (alle Daten ersetzt)', null, $result['counts'] ?? []);
        json_response(['data' => $result]);

    case $method === 'GET' && preg_match('#^/api/articles/([0-9]+)$#', $path, $matches):
        $articleId = sanitize_article_id($matches[1]);
        $article = fetch_article($pdo, $articleId);
        if (!user_can(current_user($pdo), 'children.view')) {
            $article = anonymize_article($article);
        }
        json_response(['data' => $article]);

    case $method === 'PATCH' && preg_match('#^/api/articles/([0-9]+)$#', $path, $matches):
        require_permission($pdo, 'articles.edit');
        $articleId = sanitize_article_id($matches[1]);
        $body = read_json_body();
        $before = fetch_article($pdo, $articleId);
        $label = article_display_name($pdo, $articleId);
        $article = update_article($pdo, $articleId, $body);
        $changes = article_changes($before, $article);
        if ($changes !== []) {
            audit($pdo, 'article.update', sprintf('%s geändert: %s', $label, implode(', ', array_keys($changes))), $articleId, $changes);
        }
        json_response(['data' => $article]);

    case $method === 'POST' && $path === '/api/articles':
        require_permission($pdo, 'articles.edit');
        $body = read_json_body();
        $article = create_article($pdo, $body);
        audit($pdo, 'article.create', 'Artikel angelegt: ' . article_display_name($pdo, $article['id']), $article['id']);
        json_response(['data' => $article], 201);

    case $method === 'POST' && $path === '/api/users':
        require_permission($pdo, 'users.manage');
        $body = read_json_body();
        $newUser = create_user($pdo, $body);
        audit($pdo, 'user.create', sprintf('Benutzer angelegt: %s (%s)', $newUser['email'], implode(', ', $newUser['roles'])), (string) $newUser['id']);
        json_response(['data' => $newUser], 201);

    case $method === 'PATCH' && preg_match('#^/api/users/([0-9]+)$#', $path, $matches):
        $currentUser = require_permission($pdo, 'users.manage');
        $body = read_json_body();
        $updatedUser = update_user($pdo, $currentUser, (int) $matches[1], $body);
        $what = [];
        if (array_key_exists('roles', $body)) {
            $what[] = 'Rollen: ' . implode(', ', $updatedUser['roles']);
        }
        if (array_key_exists('active', $body)) {
            $what[] = $updatedUser['active'] ? 'aktiviert' : 'deaktiviert';
        }
        if (array_key_exists('password', $body)) {
            $what[] = 'Passwort neu gesetzt';
        }
        audit($pdo, 'user.update', "Benutzer {$updatedUser['email']} geändert – " . implode('; ', $what), (string) $updatedUser['id']);
        json_response(['data' => $updatedUser]);

    case $method === 'PATCH' && preg_match('#^/api/articles/([0-9]+)/assignment$#', $path, $matches):
        require_permission($pdo, 'articles.assign');
        $articleId = sanitize_article_id($matches[1]);
        $body = read_json_body();
        $before = fetch_article($pdo, $articleId);
        $article = update_article_assignment($pdo, $articleId, $body);
        if ($before['location'] != $article['location']) {
            $target = $article['location']['type'] === 'kind' ? "an {$article['location']['name']} ausgegeben" : 'zurück ins Lager';
            audit($pdo, 'article.assign', article_display_name($pdo, $articleId) . " {$target}", $articleId, [
                'von' => $before['location']['name'],
                'nach' => $article['location']['name'],
            ]);
        }
        json_response(['data' => $article]);

    case $method === 'POST' && preg_match('#^/api/articles/([0-9]+)/helmet-check$#', $path, $matches):
        require_permission($pdo, 'articles.edit');
        $articleId = sanitize_article_id($matches[1]);
        $body = read_json_body();
        $article = complete_helmet_check($pdo, $articleId, $body);
        audit($pdo, 'article.helmet_check', 'Helmprüfung abgeschlossen: ' . article_display_name($pdo, $articleId) . ", nächste Prüfung {$article['helmetNextCheck']}", $articleId);
        json_response(['data' => $article]);

    case $method === 'DELETE' && preg_match('#^/api/articles/([0-9]+)$#', $path, $matches):
        require_permission($pdo, 'articles.edit');
        $articleId = sanitize_article_id($matches[1]);
        $label = article_display_name($pdo, $articleId);
        $result = delete_article($pdo, $articleId);
        audit($pdo, 'article.delete', "Artikel ausgesondert: {$label}", $articleId);
        json_response(['data' => $result]);

    case $method === 'PATCH' && preg_match('#^/api/children/([0-9]+)$#', $path, $matches):
        require_permission($pdo, 'children.edit');
        $childId = (int) $matches[1];
        $body = read_json_body();
        $beforeName = child_display_name($pdo, $childId);
        $child = update_child($pdo, $childId, $body);
        $afterName = trim($child['firstName'] . ' ' . $child['lastName']);
        $what = [];
        if ($afterName !== $beforeName) {
            $what[] = "umbenannt in {$afterName}";
        }
        if (array_key_exists('status', $body)) {
            $what[] = "Status {$child['status']}";
        }
        audit($pdo, 'child.update', "Kind {$beforeName} geändert" . ($what ? ': ' . implode(', ', $what) : ''), (string) $childId);
        json_response(['data' => $child]);

    case $method === 'DELETE' && preg_match('#^/api/children/([0-9]+)$#', $path, $matches):
        require_permission($pdo, 'children.edit');
        $childId = (int) $matches[1];
        $name = child_display_name($pdo, $childId);
        $result = delete_child($pdo, $childId);
        audit($pdo, 'child.delete', "Kind gelöscht: {$name}", (string) $childId);
        json_response(['data' => $result]);

    case $method === 'GET' && $path === '/api/movements':
        $currentUser = require_permission($pdo, 'movements.manage');
        json_response(['data' => list_location_movements($pdo, $currentUser, $_GET)]);

    case $method === 'POST' && preg_match('#^/api/movements/([0-9]+)/undo$#', $path, $matches):
        // Admin: alle Schritte der letzten Wochen; Betreuer: nur eigene, frische Schritte (Prüfung in undo_movement)
        $currentUser = require_permission($pdo, 'articles.assign');
        $result = undo_movement($pdo, $currentUser, (int) $matches[1]);
        $label = article_display_name($pdo, $result['articleId']);
        audit($pdo, 'article.undo', $result['eventType'] === 'create' ? "Neuanlage rückgängig gemacht: {$label}" : "Ausgabe/Rückgabe rückgängig gemacht: {$label}", $result['articleId'], ['Schritt' => $result['undone']]);
        json_response(['data' => $result]);

    case $method === 'GET' && $path === '/api/todos':
        require_permission($pdo, 'todos.manage');
        json_response(['data' => list_todos($pdo)]);

    case $method === 'POST' && $path === '/api/todos':
        $currentUser = require_permission($pdo, 'todos.manage');
        $todo = create_todo($pdo, $currentUser, read_json_body());
        audit($pdo, 'todo.create', "Todo angelegt: {$todo['text']}", (string) $todo['id']);
        json_response(['data' => $todo], 201);

    case $method === 'PATCH' && preg_match('#^/api/todos/([0-9]+)$#', $path, $matches):
        $currentUser = require_permission($pdo, 'todos.manage');
        $body = read_json_body();
        $before = fetch_todo($pdo, (int) $matches[1]);
        $todo = update_todo($pdo, $currentUser, (int) $matches[1], $body);
        if ($todo['text'] !== $before['text']) {
            audit($pdo, 'todo.update', "Todo geändert: {$todo['text']}", (string) $todo['id'], ['Text' => ['von' => $before['text'], 'nach' => $todo['text']]]);
        }
        if (($todo['doneAt'] === null) !== ($before['doneAt'] === null)) {
            audit($pdo, 'todo.done', ($todo['doneAt'] ? 'Todo erledigt: ' : 'Todo wieder offen: ') . $todo['text'], (string) $todo['id']);
        }
        json_response(['data' => $todo]);

    case $method === 'DELETE' && preg_match('#^/api/todos/([0-9]+)$#', $path, $matches):
        require_permission($pdo, 'todos.manage');
        $todo = delete_todo($pdo, (int) $matches[1]);
        audit($pdo, 'todo.delete', "Todo gelöscht: {$todo['text']}", (string) $todo['id']);
        json_response(['data' => ['deleted' => true, 'id' => $todo['id']]]);

    case $method === 'GET' && $path === '/api/audit':
        require_permission($pdo, 'audit.view');
        json_response(['data' => list_audit_log($pdo, $_GET)]);

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

        $existingStatement = $pdo->prepare('SELECT id, aktiv, aktueller_ort_id FROM artikel WHERE id = :id FOR UPDATE');
        $existingStatement->execute([':id' => $id]);
        $existingArticle = $existingStatement->fetch();

        if ($existingArticle && normalize_bool($existingArticle['aktiv'])) {
            rollback_if_needed($pdo);
            json_error('Artikelnummer ist bereits vergeben.', 409);
        }

        if ($existingArticle && !normalize_bool($existingArticle['aktiv'])) {
            $update = $pdo->prepare('UPDATE artikel SET kategorie = :kategorie, bezeichnung = :bezeichnung, groesse = :groesse, notizen = :notizen, ablaufdatum = :ablaufdatum, helm_herstellungsdatum = :helm_herstellungsdatum, aktueller_ort_id = :ort_id, aktiv = true, updated_at = NOW() WHERE id = :id');
            $update->execute([
                ':id' => $id,
                ':kategorie' => $category,
                ':bezeichnung' => $label,
                ':groesse' => $size,
                ':notizen' => $rawNotes ? append_note_entry($rawNotes, null) : null,
                ':ablaufdatum' => $expiryDate,
                ':helm_herstellungsdatum' => $helmetManufacturedAt,
                ':ort_id' => $targetOrtId,
            ]);

            $movement = $pdo->prepare('INSERT INTO bewegung (artikel_id, von_ort_id, nach_ort_id, aktion, event_type, new_value) VALUES (:artikel_id, :von_ort_id, :nach_ort_id, :aktion, :event_type, :new_value)');
            $movement->execute([
                ':artikel_id' => $id,
                ':von_ort_id' => $existingArticle['aktueller_ort_id'] !== null ? (int) $existingArticle['aktueller_ort_id'] : null,
                ':nach_ort_id' => $targetOrtId,
                ':aktion' => 'create',
                ':event_type' => 'create',
                ':new_value' => json_encode(['kategorie' => $category, 'groesse' => $size, 'reaktiviert' => true], JSON_UNESCAPED_UNICODE),
            ]);

            $pdo->commit();

            return fetch_article($pdo, $id);
        }

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
            $lagerOrtId = get_lager_ort_id($pdo);

            $count = $pdo->prepare('SELECT COUNT(*) FROM artikel WHERE aktueller_ort_id = :ort_id AND aktiv = true');
            $count->execute([':ort_id' => $ort['id']]);
            if ((int) $count->fetchColumn() > 0) {
                rollback_if_needed($pdo);
                json_error('Dem Kind sind noch Artikel zugeordnet.', 409);
            }

            // Inaktive Artikel können noch auf den Kind-Ort zeigen und das Löschen blockieren.
            $pdo->prepare('UPDATE artikel SET aktueller_ort_id = :lager_id, updated_at = NOW() WHERE aktueller_ort_id = :ort_id')
                ->execute([
                    ':lager_id' => $lagerOrtId,
                    ':ort_id' => $ort['id'],
                ]);

            // Historische Bewegungen referenzieren Ort-IDs per FK und müssen vor dem Löschen umgebogen werden.
            $pdo->prepare('UPDATE bewegung SET von_ort_id = :lager_id WHERE von_ort_id = :ort_id')
                ->execute([
                    ':lager_id' => $lagerOrtId,
                    ':ort_id' => $ort['id'],
                ]);

            $pdo->prepare('UPDATE bewegung SET nach_ort_id = :lager_id WHERE nach_ort_id = :ort_id')
                ->execute([
                    ':lager_id' => $lagerOrtId,
                    ':ort_id' => $ort['id'],
                ]);
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
    $statement = $pdo->query('SELECT id, email, array_to_json(roles) AS roles_json, active, created_at, last_login_at FROM app_user ORDER BY lower(email)');

    return array_map('transform_user_row', $statement->fetchAll());
}

function transform_user_row(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'email' => $row['email'],
        'roles' => decode_roles($row['roles_json']),
        'active' => normalize_bool($row['active']),
        'createdAt' => $row['created_at'],
        'lastLoginAt' => $row['last_login_at'] ?? null,
    ];
}

function create_user(PDO $pdo, array $payload): array
{
    $email = mb_strtolower(trim((string)($payload['email'] ?? '')));
    $password = (string)($payload['password'] ?? '');
    $roles = normalize_roles($payload['roles'] ?? []);
    $activeInput = $payload['active'] ?? true;
    $active = filter_var($activeInput, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    $active = $active === null ? true : $active;

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_error('E-Mail ist ungültig.', 422);
    }

    if (trim($password) === '' || strlen($password) < 8) {
        json_error('Passwort muss mindestens 8 Zeichen enthalten.', 422);
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);

    try {
        $statement = $pdo->prepare('INSERT INTO app_user (email, password_hash, roles, active) VALUES (:email, :password_hash, :roles, :active) RETURNING id, email, array_to_json(roles) AS roles_json, active, created_at, last_login_at');
        $statement->execute([
            ':email' => $email,
            ':password_hash' => $hash,
            ':roles' => roles_to_pg_array($roles),
            ':active' => $active ? 'true' : 'false',
        ]);

        return transform_user_row($statement->fetch());
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23505') {
            json_error('E-Mail ist bereits vergeben.', 422);
        }

        throw $exception;
    }
}

/**
 * Rollen, Aktiv-Status oder Passwort eines Benutzers ändern.
 * Ein Admin kann sich selbst weder deaktivieren noch die Admin-Rolle entziehen.
 */
function update_user(PDO $pdo, array $currentUser, int $userId, array $payload): array
{
    $find = $pdo->prepare('SELECT id FROM app_user WHERE id = :id');
    $find->execute([':id' => $userId]);
    if ($find->fetchColumn() === false) {
        json_error('Benutzer wurde nicht gefunden.', 404);
    }

    $isSelf = $userId === $currentUser['id'];
    $sets = [];
    $params = [':id' => $userId];
    $endSessions = false;

    if (array_key_exists('roles', $payload)) {
        $roles = normalize_roles($payload['roles']);
        if ($isSelf && !in_array('admin', $roles, true)) {
            json_error('Du kannst dir die Admin-Rolle nicht selbst entziehen.', 422);
        }
        $sets[] = 'roles = :roles';
        $params[':roles'] = roles_to_pg_array($roles);
    }

    if (array_key_exists('active', $payload)) {
        $active = filter_var($payload['active'], FILTER_VALIDATE_BOOLEAN);
        if ($isSelf && !$active) {
            json_error('Du kannst dich nicht selbst deaktivieren.', 422);
        }
        $sets[] = 'active = :active';
        $params[':active'] = $active ? 'true' : 'false';
        $endSessions = $endSessions || !$active;
    }

    if (array_key_exists('password', $payload)) {
        $password = (string) $payload['password'];
        if (strlen($password) < 8) {
            json_error('Passwort muss mindestens 8 Zeichen enthalten.', 422);
        }
        $sets[] = 'password_hash = :password_hash';
        $params[':password_hash'] = password_hash($password, PASSWORD_BCRYPT);
        $endSessions = !$isSelf;
    }

    if ($sets === []) {
        json_error('Keine Änderungen angegeben.', 422);
    }

    $statement = $pdo->prepare('UPDATE app_user SET ' . implode(', ', $sets) . ' WHERE id = :id RETURNING id, email, array_to_json(roles) AS roles_json, active, created_at, last_login_at');
    $statement->execute($params);
    $row = $statement->fetch();

    if ($endSessions) {
        $pdo->prepare('DELETE FROM app_session WHERE user_id = :id')->execute([':id' => $userId]);
    }

    return transform_user_row($row);
}

/**
 * Für Besucher ohne Anmeldung: Namen der Kinder entfernen.
 */
function anonymize_article(array $article): array
{
    $hideChild = static function (?array $location): ?array {
        if ($location === null || ($location['type'] ?? null) !== 'kind') {
            return $location;
        }

        return array_merge($location, ['name' => 'Ausgegeben', 'kindId' => null]);
    };

    $article['location'] = $hideChild($article['location']);

    if (isset($article['movementHistory'])) {
        $article['movementHistory'] = array_map(static function (array $movement) use ($hideChild): array {
            $movement['from'] = $hideChild($movement['from']);
            $movement['to'] = $hideChild($movement['to']);
            return $movement;
        }, $article['movementHistory']);
    }

    return $article;
}

function export_children_csv(PDO $pdo): void
{
    $rows = $pdo->query('SELECT id, vorname, nachname, status FROM kind ORDER BY lower(nachname), lower(vorname)')->fetchAll();

    $handle = fopen('php://temp', 'r+');
    // BOM, damit Excel Umlaute als UTF-8 liest; Semikolon für deutsches Excel
    fwrite($handle, "\xEF\xBB\xBF");
    fputcsv($handle, ['ID', 'Vorname', 'Nachname', 'Status'], ';', '"', '');
    foreach ($rows as $row) {
        fputcsv($handle, [$row['id'], csv_safe($row['vorname']), csv_safe($row['nachname']), $row['status']], ';', '"', '');
    }
    rewind($handle);
    $csv = stream_get_contents($handle);
    fclose($handle);

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="kinder_' . date('Y-m-d') . '.csv"');
    echo $csv;
    exit;
}

function csv_safe(?string $value): string
{
    $text = (string) $value;

    // Verhindert, dass Excel Werte wie "=..." als Formel ausführt
    return preg_match('/^[=+@\t]/', $text) === 1 ? "'" . $text : $text;
}

/**
 * Zerlegt eine CSV-Datei (Semikolon oder Komma, optional mit BOM) in Kopfzeile und Datenzeilen.
 * Die Kopfzeile wird kleingeschrieben zurückgegeben.
 */
function parse_csv_upload(string $csv): array
{
    $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv) ?? $csv;

    if (trim($csv) === '') {
        json_error('Die CSV-Datei ist leer.', 422);
    }

    // Zeilenweise mit fgetcsv lesen, damit Zeilenumbrüche in Anführungszeichen (Notizen) erhalten bleiben
    $handle = fopen('php://temp', 'r+');
    fwrite($handle, $csv);
    rewind($handle);
    $firstLine = (string) fgets($handle);
    $delimiter = substr_count($firstLine, ';') >= substr_count($firstLine, ',') ? ';' : ',';
    rewind($handle);

    $header = null;
    $rows = [];
    $lineNumber = 0;
    while (($cells = fgetcsv($handle, 0, $delimiter, '"', '')) !== false) {
        $lineNumber++;
        if ($header === null) {
            $header = array_map(static fn($cell) => mb_strtolower(trim((string) $cell)), $cells);
            continue;
        }
        if ($cells === [null] || implode('', array_map('trim', array_map('strval', $cells))) === '') {
            continue;
        }
        $rows[] = ['line' => $lineNumber, 'cells' => $cells];
    }
    fclose($handle);

    return [$header ?? [], $rows];
}

/**
 * Sucht die Spalte zu einem Feld; mehrere Schreibweisen der Kopfzeile sind erlaubt.
 */
function csv_column_index(array $header, array $names): ?int
{
    foreach ($names as $name) {
        $index = array_search($name, $header, true);
        if ($index !== false) {
            return $index;
        }
    }

    return null;
}

/**
 * Legt Artikel aus einer CSV-Datei an (gleiches Format wie der Export).
 * Pflicht: Inventarnummer, Kategorie; bei Helmen das Herstellungsdatum.
 * Ort "Kind" + Name in "Kind / Lagerort" gibt den Artikel direkt an dieses Kind aus, sonst Lager.
 * Bereits vorhandene Inventarnummern werden übersprungen, nichts wird überschrieben.
 */
function import_articles_csv(PDO $pdo, array $payload): array
{
    [$header, $rows] = parse_csv_upload((string) ($payload['csv'] ?? ''));

    $columns = [
        'id' => csv_column_index($header, ['inventarnummer', 'artikelnummer', 'id']),
        'category' => csv_column_index($header, ['kategorie']),
        'label' => csv_column_index($header, ['bezeichnung']),
        'size' => csv_column_index($header, ['größe', 'groesse']),
        'location' => csv_column_index($header, ['ort']),
        'child' => csv_column_index($header, ['kind / lagerort', 'kind']),
        'expiry' => csv_column_index($header, ['ablaufdatum']),
        'manufactured' => csv_column_index($header, ['herstellungsdatum', 'herstellungsdatum (helm)']),
        'notes' => csv_column_index($header, ['notiz', 'notizen']),
    ];

    if ($columns['id'] === null || $columns['category'] === null) {
        json_error('Die erste Zeile muss mindestens die Spalten "Inventarnummer" und "Kategorie" enthalten.', 422);
    }

    $children = [];
    foreach ($pdo->query('SELECT id, vorname, nachname FROM kind')->fetchAll() as $child) {
        $children[mb_strtolower(trim($child['vorname'] . ' ' . $child['nachname']))] = (int) $child['id'];
    }

    $activeIds = array_flip($pdo->query('SELECT id FROM artikel WHERE aktiv = true')->fetchAll(PDO::FETCH_COLUMN));

    $cell = static fn(array $cells, ?int $index): string => $index === null ? '' : trim((string) ($cells[$index] ?? ''));
    // Nur 2030-02-28 oder 28.02.2030; liefert Y-m-d, '' für leer, null für ungültig
    $parseDate = static function (string $value): ?string {
        if ($value === '') {
            return '';
        }
        foreach (['!Y-m-d', '!d.m.Y'] as $format) {
            $date = DateTimeImmutable::createFromFormat($format, $value);
            if ($date !== false && $date->format(substr($format, 1)) === $value) {
                return $date->format('Y-m-d');
            }
        }
        return null;
    };

    $created = 0;
    $skipped = 0;
    $errors = [];
    $seen = [];

    foreach ($rows as ['line' => $line, 'cells' => $cells]) {
        $rawId = $cell($cells, $columns['id']);
        $id = sanitize_article_id($rawId);
        $category = $cell($cells, $columns['category']);

        if ($id === '' || $category === '') {
            $errors[] = ['line' => $line, 'message' => 'Inventarnummer oder Kategorie fehlt.'];
            continue;
        }

        if (isset($activeIds[$id]) || isset($seen[$id])) {
            $skipped++;
            continue;
        }

        $expiry = $parseDate($cell($cells, $columns['expiry']));
        $manufactured = $parseDate($cell($cells, $columns['manufactured']));
        if ($expiry === null || $manufactured === null) {
            $errors[] = ['line' => $line, 'message' => "Artikel {$id}: Datum ungültig (erlaubt: 28.02.2030 oder 2030-02-28)."];
            continue;
        }
        if (mb_strtolower($category) === 'helm' && $manufactured === '') {
            $errors[] = ['line' => $line, 'message' => "Artikel {$id}: Für Helme wird ein Herstellungsdatum benötigt."];
            continue;
        }

        $payloadRow = [
            'id' => $id,
            'category' => $category,
            'label' => $cell($cells, $columns['label']),
            'size' => $cell($cells, $columns['size']),
            'notes' => $cell($cells, $columns['notes']),
            'expiryDate' => $expiry,
            'helmetManufacturedAt' => $manufactured,
            'locationType' => 'lager',
        ];

        if (mb_strtolower($cell($cells, $columns['location'])) === 'kind') {
            $childName = mb_strtolower($cell($cells, $columns['child']));
            if (!isset($children[$childName])) {
                $errors[] = ['line' => $line, 'message' => "Artikel {$id}: Kind \"{$cell($cells, $columns['child'])}\" nicht gefunden."];
                continue;
            }
            $payloadRow['locationType'] = 'kind';
            $payloadRow['kindId'] = $children[$childName];
        }

        create_article($pdo, $payloadRow);
        $seen[$id] = true;
        $created++;
    }

    return ['created' => $created, 'skipped' => $skipped, 'errors' => $errors];
}

/**
 * Legt Kinder aus einer CSV-Datei an. Bestehende Kinder (gleicher Vor- und Nachname)
 * werden übersprungen, nichts wird geändert oder gelöscht.
 * Erwartet eine Kopfzeile mit mindestens "Vorname" und "Nachname"; "Status" ist optional.
 */
function import_children_csv(PDO $pdo, array $payload): array
{
    $csv = (string) ($payload['csv'] ?? '');
    $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv) ?? $csv;

    if (trim($csv) === '') {
        json_error('Die CSV-Datei ist leer.', 422);
    }

    $lines = preg_split('/\R/', trim($csv)) ?: [];
    $delimiter = substr_count($lines[0], ';') >= substr_count($lines[0], ',') ? ';' : ',';
    $header = array_map(static fn($cell) => mb_strtolower(trim((string) $cell)), str_getcsv($lines[0], $delimiter, '"', ''));

    $firstNameIndex = array_search('vorname', $header, true);
    $lastNameIndex = array_search('nachname', $header, true);
    $statusIndex = array_search('status', $header, true);

    if ($firstNameIndex === false || $lastNameIndex === false) {
        json_error('Die erste Zeile muss die Spalten "Vorname" und "Nachname" enthalten.', 422);
    }

    $existing = [];
    foreach ($pdo->query('SELECT lower(vorname) AS v, lower(nachname) AS n FROM kind')->fetchAll() as $row) {
        $existing[$row['v'] . "\n" . $row['n']] = true;
    }

    $insertChild = $pdo->prepare('INSERT INTO kind (vorname, nachname, status) VALUES (:vorname, :nachname, :status) RETURNING id');
    $insertOrt = $pdo->prepare("INSERT INTO ort (typ, name, kind_id) VALUES ('kind', :name, :kind_id)");

    $created = 0;
    $skipped = 0;
    $errors = [];

    $pdo->beginTransaction();

    try {
        foreach (array_slice($lines, 1) as $index => $line) {
            $lineNumber = $index + 2;
            if (trim($line) === '') {
                continue;
            }

            $cells = str_getcsv($line, $delimiter, '"', '');
            $firstName = trim((string) ($cells[$firstNameIndex] ?? ''));
            $lastName = trim((string) ($cells[$lastNameIndex] ?? ''));
            $status = $statusIndex !== false ? mb_strtolower(trim((string) ($cells[$statusIndex] ?? ''))) : '';
            $status = $status === '' ? 'aktiv' : $status;

            if ($firstName === '' || $lastName === '') {
                $errors[] = ['line' => $lineNumber, 'message' => 'Vorname oder Nachname fehlt.'];
                continue;
            }

            if (!in_array($status, ['aktiv', 'inaktiv'], true)) {
                $errors[] = ['line' => $lineNumber, 'message' => "Status \"{$status}\" ist ungültig (aktiv oder inaktiv)."];
                continue;
            }

            $key = mb_strtolower($firstName) . "\n" . mb_strtolower($lastName);
            if (isset($existing[$key])) {
                $skipped++;
                continue;
            }

            $insertChild->execute([':vorname' => $firstName, ':nachname' => $lastName, ':status' => $status]);
            $childId = (int) $insertChild->fetchColumn();
            $insertOrt->execute([':name' => sprintf('Kind %s %s', $firstName, $lastName), ':kind_id' => $childId]);

            $existing[$key] = true;
            $created++;
        }

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);
        throw $throwable;
    }

    return ['created' => $created, 'skipped' => $skipped, 'errors' => $errors];
}

function export_data(PDO $pdo): void
{
    $backup = build_backup_payload($pdo);
    $filename = sprintf('kleiderkammer-backup-%s.json', (new DateTimeImmutable())->format('Ymd-His'));

    header('Content-Type: application/json; charset=utf-8');
    header(sprintf('Content-Disposition: attachment; filename="%s"', $filename));

    echo json_encode($backup, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function import_data(PDO $pdo, array $payload): array
{
    $backup = $payload['backup'] ?? $payload;

    if (!is_array($backup)) {
        json_error('Import-Datei konnte nicht verarbeitet werden.', 422);
    }

    $format = (string) ($backup['format'] ?? '');
    $version = (int) ($backup['version'] ?? 0);
    $data = $backup['data'] ?? null;

    if ($format !== 'kleiderkammer-backup' || $version !== 1 || !is_array($data)) {
        json_error('Ungültiges Backup-Format.', 422);
    }

    $users = is_array($data['users'] ?? null) ? $data['users'] : null;
    $children = is_array($data['children'] ?? null) ? $data['children'] : null;
    $locations = is_array($data['locations'] ?? null) ? $data['locations'] : null;
    $articles = is_array($data['articles'] ?? null) ? $data['articles'] : null;
    $movements = is_array($data['movements'] ?? null) ? $data['movements'] : null;

    if ($users === null || $children === null || $locations === null || $articles === null || $movements === null) {
        json_error('Backup enthält nicht alle benötigten Datenbereiche.', 422);
    }

    $hasLager = false;
    foreach ($locations as $location) {
        if (is_array($location) && ($location['typ'] ?? null) === 'lager') {
            $hasLager = true;
            break;
        }
    }

    if (!$hasLager) {
        json_error('Backup enthält keinen Lager-Ort.', 422);
    }

    $pdo->beginTransaction();

    try {
        $pdo->exec('TRUNCATE TABLE bewegung, artikel, ort, kind, app_user RESTART IDENTITY CASCADE');

        $insertUser = $pdo->prepare('INSERT INTO app_user (id, email, password_hash, roles, active, created_at) VALUES (:id, :email, :password_hash, :roles, :active, :created_at)');
        foreach ($users as $user) {
            if (!is_array($user)) {
                throw new RuntimeException('Ungültiger Benutzer-Datensatz im Backup.');
            }

            $insertUser->execute([
                ':id' => (int) ($user['id'] ?? 0),
                ':email' => (string) ($user['email'] ?? ''),
                ':password_hash' => (string) ($user['password_hash'] ?? ''),
                ':roles' => roles_to_pg_array(backup_user_roles($user)),
                ':active' => normalize_bool($user['active'] ?? true),
                ':created_at' => (string) ($user['created_at'] ?? (new DateTimeImmutable())->format(DateTimeInterface::ATOM)),
            ]);
        }

        $insertChild = $pdo->prepare('INSERT INTO kind (id, vorname, nachname, status, created_at) VALUES (:id, :vorname, :nachname, :status, :created_at)');
        foreach ($children as $child) {
            if (!is_array($child)) {
                throw new RuntimeException('Ungültiger Kind-Datensatz im Backup.');
            }

            $insertChild->execute([
                ':id' => (int) ($child['id'] ?? 0),
                ':vorname' => (string) ($child['vorname'] ?? ''),
                ':nachname' => (string) ($child['nachname'] ?? ''),
                ':status' => (string) ($child['status'] ?? 'aktiv'),
                ':created_at' => (string) ($child['created_at'] ?? (new DateTimeImmutable())->format(DateTimeInterface::ATOM)),
            ]);
        }

        $insertLocation = $pdo->prepare('INSERT INTO ort (id, typ, name, kind_id) VALUES (:id, :typ, :name, :kind_id)');
        foreach ($locations as $location) {
            if (!is_array($location)) {
                throw new RuntimeException('Ungültiger Ort-Datensatz im Backup.');
            }

            $kindId = $location['kind_id'] ?? null;
            $insertLocation->execute([
                ':id' => (int) ($location['id'] ?? 0),
                ':typ' => (string) ($location['typ'] ?? ''),
                ':name' => $location['name'] ?? null,
                ':kind_id' => $kindId !== null ? (int) $kindId : null,
            ]);
        }

        $insertArticle = $pdo->prepare('INSERT INTO artikel (id, kategorie, bezeichnung, groesse, zustand, notizen, kaufdatum, ablaufdatum, helm_letzte_pruefung, helm_naechste_pruefung, helm_herstellungsdatum, aktiv, aktueller_ort_id, angelegt_am, updated_at) VALUES (:id, :kategorie, :bezeichnung, :groesse, :zustand, :notizen, :kaufdatum, :ablaufdatum, :helm_letzte_pruefung, :helm_naechste_pruefung, :helm_herstellungsdatum, :aktiv, :aktueller_ort_id, :angelegt_am, :updated_at)');
        foreach ($articles as $article) {
            if (!is_array($article)) {
                throw new RuntimeException('Ungültiger Artikel-Datensatz im Backup.');
            }

            $insertArticle->execute([
                ':id' => sanitize_article_id((string) ($article['id'] ?? '')),
                ':kategorie' => (string) ($article['kategorie'] ?? ''),
                ':bezeichnung' => (string) ($article['bezeichnung'] ?? ''),
                ':groesse' => $article['groesse'] ?? null,
                ':zustand' => $article['zustand'] ?? null,
                ':notizen' => $article['notizen'] ?? null,
                ':kaufdatum' => $article['kaufdatum'] ?? null,
                ':ablaufdatum' => $article['ablaufdatum'] ?? null,
                ':helm_letzte_pruefung' => $article['helm_letzte_pruefung'] ?? null,
                ':helm_naechste_pruefung' => $article['helm_naechste_pruefung'] ?? null,
                ':helm_herstellungsdatum' => $article['helm_herstellungsdatum'] ?? null,
                ':aktiv' => normalize_bool($article['aktiv'] ?? true),
                ':aktueller_ort_id' => (int) ($article['aktueller_ort_id'] ?? 0),
                ':angelegt_am' => (string) ($article['angelegt_am'] ?? (new DateTimeImmutable())->format(DateTimeInterface::ATOM)),
                ':updated_at' => (string) ($article['updated_at'] ?? (new DateTimeImmutable())->format(DateTimeInterface::ATOM)),
            ]);
        }

        $insertMovement = $pdo->prepare('INSERT INTO bewegung (id, artikel_id, von_ort_id, nach_ort_id, zeitpunkt, user_id, aktion, event_type, old_value, new_value, kommentar, created_at) VALUES (:id, :artikel_id, :von_ort_id, :nach_ort_id, :zeitpunkt, :user_id, :aktion, :event_type, CAST(:old_value AS jsonb), CAST(:new_value AS jsonb), :kommentar, :created_at)');
        foreach ($movements as $movement) {
            if (!is_array($movement)) {
                throw new RuntimeException('Ungültiger Bewegungs-Datensatz im Backup.');
            }

            $insertMovement->execute([
                ':id' => (int) ($movement['id'] ?? 0),
                ':artikel_id' => sanitize_article_id((string) ($movement['artikel_id'] ?? '')),
                ':von_ort_id' => isset($movement['von_ort_id']) ? (int) $movement['von_ort_id'] : null,
                ':nach_ort_id' => isset($movement['nach_ort_id']) ? (int) $movement['nach_ort_id'] : null,
                ':zeitpunkt' => (string) ($movement['zeitpunkt'] ?? (new DateTimeImmutable())->format(DateTimeInterface::ATOM)),
                ':user_id' => isset($movement['user_id']) ? (int) $movement['user_id'] : null,
                ':aktion' => (string) ($movement['aktion'] ?? ''),
                ':event_type' => $movement['event_type'] ?? null,
                ':old_value' => encode_import_json_field($movement['old_value'] ?? null),
                ':new_value' => encode_import_json_field($movement['new_value'] ?? null),
                ':kommentar' => $movement['kommentar'] ?? null,
                ':created_at' => (string) ($movement['created_at'] ?? (new DateTimeImmutable())->format(DateTimeInterface::ATOM)),
            ]);
        }

        reset_serial_sequence($pdo, 'app_user', 'id');
        reset_serial_sequence($pdo, 'kind', 'id');
        reset_serial_sequence($pdo, 'ort', 'id');
        reset_serial_sequence($pdo, 'bewegung', 'id');

        $pdo->commit();
    } catch (Throwable $throwable) {
        rollback_if_needed($pdo);

        if ($throwable instanceof RuntimeException) {
            json_error($throwable->getMessage(), 422);
        }

        throw $throwable;
    }

    return [
        'imported' => true,
        'counts' => [
            'users' => count($users),
            'children' => count($children),
            'locations' => count($locations),
            'articles' => count($articles),
            'movements' => count($movements),
        ],
    ];
}

function build_backup_payload(PDO $pdo): array
{
    return [
        'app' => 'Digitale Kleiderkammer',
        'format' => 'kleiderkammer-backup',
        'version' => 1,
        'exportedAt' => (new DateTimeImmutable())->format(DateTimeInterface::ATOM),
        'data' => [
            'users' => fetch_backup_users($pdo),
            'children' => fetch_backup_children($pdo),
            'locations' => fetch_backup_locations($pdo),
            'articles' => fetch_backup_articles($pdo),
            'movements' => fetch_backup_movements($pdo),
        ],
    ];
}

function fetch_backup_users(PDO $pdo): array
{
    $statement = $pdo->query('SELECT id, email, password_hash, array_to_json(roles) AS roles_json, active, created_at FROM app_user ORDER BY id');

    return array_map(static fn(array $row) => [
        'id' => (int) $row['id'],
        'email' => $row['email'],
        'password_hash' => $row['password_hash'],
        'roles' => decode_roles($row['roles_json']),
        'active' => normalize_bool($row['active']),
        'created_at' => $row['created_at'],
    ], $statement->fetchAll());
}

/**
 * Rollen aus einem Backup-Datensatz; ältere Backups haben noch eine einzelne Rolle.
 */
function backup_user_roles(array $user): array
{
    if (isset($user['roles']) && is_array($user['roles'])) {
        return array_values(array_intersect($user['roles'], valid_roles()));
    }

    return match ((string) ($user['role'] ?? '')) {
        'admin' => ['admin'],
        'verwalter' => ['betreuer', 'datenbank'],
        'leser' => ['betreuer'],
        default => [],
    };
}

function fetch_backup_children(PDO $pdo): array
{
    $statement = $pdo->query('SELECT id, vorname, nachname, status, created_at FROM kind ORDER BY id');
    return $statement->fetchAll();
}

function fetch_backup_locations(PDO $pdo): array
{
    $statement = $pdo->query('SELECT id, typ, name, kind_id FROM ort ORDER BY id');

    return array_map(static fn(array $row) => [
        'id' => (int) $row['id'],
        'typ' => $row['typ'],
        'name' => $row['name'],
        'kind_id' => $row['kind_id'] !== null ? (int) $row['kind_id'] : null,
    ], $statement->fetchAll());
}

function fetch_backup_articles(PDO $pdo): array
{
    $statement = $pdo->query('SELECT id, kategorie, bezeichnung, groesse, zustand, notizen, kaufdatum, ablaufdatum, helm_letzte_pruefung, helm_naechste_pruefung, helm_herstellungsdatum, aktiv, aktueller_ort_id, angelegt_am, updated_at FROM artikel ORDER BY id');

    return array_map(static fn(array $row) => [
        'id' => $row['id'],
        'kategorie' => $row['kategorie'],
        'bezeichnung' => $row['bezeichnung'],
        'groesse' => $row['groesse'],
        'zustand' => $row['zustand'],
        'notizen' => $row['notizen'],
        'kaufdatum' => $row['kaufdatum'],
        'ablaufdatum' => $row['ablaufdatum'],
        'helm_letzte_pruefung' => $row['helm_letzte_pruefung'],
        'helm_naechste_pruefung' => $row['helm_naechste_pruefung'],
        'helm_herstellungsdatum' => $row['helm_herstellungsdatum'],
        'aktiv' => normalize_bool($row['aktiv']),
        'aktueller_ort_id' => (int) $row['aktueller_ort_id'],
        'angelegt_am' => $row['angelegt_am'],
        'updated_at' => $row['updated_at'],
    ], $statement->fetchAll());
}

function fetch_backup_movements(PDO $pdo): array
{
    $statement = $pdo->query('SELECT id, artikel_id, von_ort_id, nach_ort_id, zeitpunkt, user_id, aktion, event_type, old_value, new_value, kommentar, created_at FROM bewegung ORDER BY id');

    return array_map(static fn(array $row) => [
        'id' => (int) $row['id'],
        'artikel_id' => $row['artikel_id'],
        'von_ort_id' => $row['von_ort_id'] !== null ? (int) $row['von_ort_id'] : null,
        'nach_ort_id' => $row['nach_ort_id'] !== null ? (int) $row['nach_ort_id'] : null,
        'zeitpunkt' => $row['zeitpunkt'],
        'user_id' => $row['user_id'] !== null ? (int) $row['user_id'] : null,
        'aktion' => $row['aktion'],
        'event_type' => $row['event_type'],
        'old_value' => decode_backup_json_field($row['old_value'] ?? null),
        'new_value' => decode_backup_json_field($row['new_value'] ?? null),
        'kommentar' => $row['kommentar'],
        'created_at' => $row['created_at'],
    ], $statement->fetchAll());
}

function fetch_article(PDO $pdo, string $articleId): array
{
    $statement = $pdo->prepare('SELECT a.id, a.kategorie, a.bezeichnung, a.groesse, a.notizen, a.ablaufdatum, a.helm_naechste_pruefung, a.helm_letzte_pruefung, a.helm_herstellungsdatum, a.updated_at, o.typ AS ort_typ, o.name AS ort_name, o.kind_id, k.vorname, k.nachname, mv.zeitpunkt AS letzte_bewegung FROM artikel a JOIN ort o ON o.id = a.aktueller_ort_id LEFT JOIN kind k ON k.id = o.kind_id LEFT JOIN LATERAL (SELECT zeitpunkt FROM bewegung WHERE artikel_id = a.id ORDER BY zeitpunkt DESC LIMIT 1) mv ON true WHERE a.id = :id AND a.aktiv = true');
    $statement->execute([':id' => $articleId]);
    $row = $statement->fetch();

    if (!$row) {
        json_error('Artikel wurde nicht gefunden.', 404);
    }

    $movements = fetch_article_movements($pdo, $articleId, 3);
    $noteEntries = extract_note_entries($row['notizen'] ?? null);

    return transform_article_row($row, true, $movements, $noteEntries);
}

/**
 * Geänderte Felder zwischen zwei Artikel-Ständen, mit deutschen Feldnamen.
 */
function article_changes(array $before, array $after): array
{
    $labels = [
        'category' => 'Kategorie',
        'label' => 'Bezeichnung',
        'size' => 'Größe',
        'notes' => 'Notiz',
        'expiryDate' => 'Ablaufdatum',
        'helmetManufacturedAt' => 'Herstellungsdatum',
        'helmetLastCheck' => 'Letzte Prüfung',
        'helmetNextCheck' => 'Nächste Prüfung',
    ];
    $changes = [];
    foreach ($labels as $key => $label) {
        if (($before[$key] ?? null) !== ($after[$key] ?? null)) {
            $changes[$label] = ['von' => $before[$key] ?? null, 'nach' => $after[$key] ?? null];
        }
    }

    return $changes;
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

function decode_backup_json_field($value)
{
    if ($value === null || $value === '') {
        return null;
    }

    if (is_array($value)) {
        return $value;
    }

    if (!is_string($value)) {
        return $value;
    }

    $decoded = json_decode($value, true);

    return json_last_error() === JSON_ERROR_NONE ? $decoded : $value;
}

function encode_import_json_field($value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }

    if (is_string($value)) {
        json_decode($value);
        if (json_last_error() === JSON_ERROR_NONE) {
            return $value;
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function reset_serial_sequence(PDO $pdo, string $table, string $column): void
{
    $allowed = [
        'app_user.id',
        'kind.id',
        'ort.id',
        'bewegung.id',
    ];

    if (!in_array(sprintf('%s.%s', $table, $column), $allowed, true)) {
        throw new RuntimeException('Ungültige Sequenz-Konfiguration.');
    }

    $pdo->query(sprintf(
        "SELECT setval(pg_get_serial_sequence('%s', '%s'), COALESCE(MAX(%s), 1), MAX(%s) IS NOT NULL) FROM %s",
        $table,
        $column,
        $column,
        $column,
        $table
    ));
}
