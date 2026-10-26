<?php

declare(strict_types=1);

// Gemeinsame Todo-Liste für Betreuer und Admins.
// Erledigte Todos werden einen Monat nach dem Erledigen automatisch gelöscht.

const TODO_MAX_LENGTH = 500;

function ensure_todo_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS todo (
            id               SERIAL PRIMARY KEY,
            text             TEXT NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by       INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
            created_by_email TEXT,
            done_at          TIMESTAMPTZ,
            done_by_email    TEXT
        )'
    );
}

function delete_expired_todos(PDO $pdo): void
{
    $pdo->exec("DELETE FROM todo WHERE done_at IS NOT NULL AND done_at < NOW() - INTERVAL '1 month'");
}

function transform_todo_row(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'text' => $row['text'],
        'createdAt' => $row['created_at'],
        'createdBy' => $row['created_by_email'],
        'doneAt' => $row['done_at'],
        'doneBy' => $row['done_by_email'],
        'deleteAt' => $row['delete_at'],
    ];
}

const TODO_COLUMNS = "id, text, created_at, created_by_email, done_at, done_by_email, done_at + INTERVAL '1 month' AS delete_at";

function list_todos(PDO $pdo): array
{
    delete_expired_todos($pdo);

    // Offene zuerst (älteste oben), danach erledigte (zuletzt erledigte oben)
    $statement = $pdo->query(
        'SELECT ' . TODO_COLUMNS . ' FROM todo
         ORDER BY done_at IS NOT NULL, CASE WHEN done_at IS NULL THEN created_at END ASC, done_at DESC'
    );

    return array_map('transform_todo_row', $statement->fetchAll());
}

function fetch_todo(PDO $pdo, int $todoId): array
{
    $statement = $pdo->prepare('SELECT ' . TODO_COLUMNS . ' FROM todo WHERE id = :id');
    $statement->execute([':id' => $todoId]);
    $row = $statement->fetch();

    if (!$row) {
        json_error('Todo wurde nicht gefunden.', 404);
    }

    return transform_todo_row($row);
}

function normalize_todo_text($value): string
{
    $text = trim((string) $value);

    if ($text === '') {
        json_error('Bitte einen Text eingeben.', 422);
    }

    if (mb_strlen($text) > TODO_MAX_LENGTH) {
        json_error('Text darf höchstens ' . TODO_MAX_LENGTH . ' Zeichen lang sein.', 422);
    }

    return $text;
}

function create_todo(PDO $pdo, array $user, array $payload): array
{
    $statement = $pdo->prepare(
        'INSERT INTO todo (text, created_by, created_by_email) VALUES (:text, :user_id, :email) RETURNING id'
    );
    $statement->execute([
        ':text' => normalize_todo_text($payload['text'] ?? ''),
        ':user_id' => $user['id'],
        ':email' => $user['email'],
    ]);

    return fetch_todo($pdo, (int) $statement->fetchColumn());
}

/**
 * Text ändern und/oder als erledigt bzw. wieder offen markieren.
 */
function update_todo(PDO $pdo, array $user, int $todoId, array $payload): array
{
    fetch_todo($pdo, $todoId);

    $sets = [];
    $params = [':id' => $todoId];

    if (array_key_exists('text', $payload)) {
        $sets[] = 'text = :text';
        $params[':text'] = normalize_todo_text($payload['text']);
    }

    if (array_key_exists('done', $payload)) {
        if (filter_var($payload['done'], FILTER_VALIDATE_BOOLEAN)) {
            $sets[] = 'done_at = COALESCE(done_at, NOW())';
            $sets[] = 'done_by_email = COALESCE(done_by_email, :email)';
            $params[':email'] = $user['email'];
        } else {
            $sets[] = 'done_at = NULL';
            $sets[] = 'done_by_email = NULL';
        }
    }

    if ($sets === []) {
        json_error('Keine Änderungen angegeben.', 422);
    }

    $pdo->prepare('UPDATE todo SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);

    return fetch_todo($pdo, $todoId);
}

function delete_todo(PDO $pdo, int $todoId): array
{
    $todo = fetch_todo($pdo, $todoId);
    $pdo->prepare('DELETE FROM todo WHERE id = :id')->execute([':id' => $todoId]);

    return $todo;
}
