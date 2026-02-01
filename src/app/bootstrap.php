<?php

declare(strict_types=1);

function env_string(string $key, ?string $default = null): string
{
    $value = getenv($key);
    if ($value === false) {
        if ($default === null) {
            throw new RuntimeException("Missing environment variable: {$key}");
        }
        return $default;
    }

    return $value;
}

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = env_string('DB_HOST', 'localhost');
    $port = env_string('DB_PORT', '5432');
    $name = env_string('DB_NAME', 'kleiderkammer');
    $user = env_string('DB_USER', 'kleid');
    $pass = env_string('DB_PASS', 'secret');

    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port, $name);

    try {
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (PDOException $exception) {
        throw new RuntimeException('Failed to connect to database: ' . $exception->getMessage(), (int) $exception->getCode(), $exception);
    }

    return $pdo;
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(string $message, int $status = 400, array $context = []): void
{
    $payload = array_merge(['error' => $message], $context);
    json_response($payload, $status);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');

    if ($raw === false || $raw === '') {
        return [];
    }

    $decoded = json_decode($raw, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        json_error('Invalid JSON payload', 400, ['detail' => json_last_error_msg()]);
    }

    return is_array($decoded) ? $decoded : [];
}

function sanitize_article_id(string $value): string
{
    $digits = preg_replace('/[^0-9]/', '', $value) ?? '';

    if ($digits === '') {
        return '';
    }

    $normalized = substr($digits, -9);

    return str_pad($normalized, 9, '0', STR_PAD_LEFT);
}

function ensure_schema(PDO $pdo): void
{
    static $ensured = false;

    if ($ensured) {
        return;
    }

    $statements = [
        "ALTER TABLE artikel ADD COLUMN IF NOT EXISTS notizen TEXT",
        "ALTER TABLE artikel ADD COLUMN IF NOT EXISTS ablaufdatum DATE",
        "ALTER TABLE artikel ADD COLUMN IF NOT EXISTS helm_letzte_pruefung DATE",
        "ALTER TABLE artikel ADD COLUMN IF NOT EXISTS helm_naechste_pruefung DATE",
        "ALTER TABLE artikel ADD COLUMN IF NOT EXISTS helm_herstellungsdatum DATE",
        "ALTER TABLE artikel ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "ALTER TABLE bewegung ADD COLUMN IF NOT EXISTS event_type TEXT",
        "ALTER TABLE bewegung ADD COLUMN IF NOT EXISTS old_value JSONB",
        "ALTER TABLE bewegung ADD COLUMN IF NOT EXISTS new_value JSONB",
        "ALTER TABLE artikel DROP CONSTRAINT IF EXISTS ck_artikel_id_numeric",
        "ALTER TABLE artikel ADD CONSTRAINT ck_artikel_id_numeric CHECK (id ~ '^[0-9]{9}$') NOT VALID",
    ];

    foreach ($statements as $sql) {
        $pdo->exec($sql);
    }

    $ensured = true;
}

function today(): DateTimeImmutable
{
    return new DateTimeImmutable('today');
}

function in_days(DateTimeImmutable $date, int $days): DateTimeImmutable
{
    return $date->modify("+{$days} days");
}
