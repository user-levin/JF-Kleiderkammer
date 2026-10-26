<?php

declare(strict_types=1);

// Anmeldung über ein Session-Cookie. Die Sessions liegen in der Tabelle app_session,
// im Cookie steht nur ein zufälliges Token, in der Datenbank nur dessen SHA-256-Hash.

const SESSION_COOKIE = 'kk_session';
// Ohne "Angemeldet bleiben": abgemeldet nach 12 Stunden ohne Aktivität, Cookie endet mit dem Browser
const SESSION_IDLE_SECONDS = 12 * 60 * 60;
// Mit "Angemeldet bleiben": 30 Tage, wird bei Nutzung verlängert
const SESSION_REMEMBER_SECONDS = 30 * 24 * 60 * 60;
// Ablaufzeit höchstens alle 5 Minuten in die Datenbank schreiben
const SESSION_TOUCH_SECONDS = 5 * 60;

function ensure_auth_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS app_session (
            id           SERIAL PRIMARY KEY,
            token_hash   TEXT NOT NULL UNIQUE,
            user_id      INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
            remember     BOOLEAN NOT NULL DEFAULT FALSE,
            expires_at   TIMESTAMPTZ NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            user_agent   TEXT
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_app_session_user ON app_session(user_id)');
    $pdo->exec('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ');
}

function session_lifetime(bool $remember): int
{
    return $remember ? SESSION_REMEMBER_SECONDS : SESSION_IDLE_SECONDS;
}

function request_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }

    return strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function set_session_cookie(string $token, bool $remember): void
{
    setcookie(SESSION_COOKIE, $token, [
        // Ohne "Angemeldet bleiben" ein reines Browser-Session-Cookie
        'expires' => $remember ? time() + SESSION_REMEMBER_SECONDS : 0,
        'path' => '/',
        'secure' => request_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clear_session_cookie(): void
{
    setcookie(SESSION_COOKIE, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => request_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function session_token_hash(string $token): string
{
    return hash('sha256', $token);
}

function public_user(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'email' => $row['email'],
        'role' => $row['role'],
    ];
}

/**
 * Liefert den angemeldeten Benutzer oder null. Verlängert dabei die Session.
 */
function current_user(PDO $pdo): ?array
{
    static $resolved = false;
    static $user = null;

    if ($resolved) {
        return $user;
    }
    $resolved = true;

    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token === '' || strlen($token) > 128) {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT s.id AS session_id, s.remember, s.last_seen_at, u.id, u.email, u.role
         FROM app_session s
         JOIN app_user u ON u.id = s.user_id
         WHERE s.token_hash = :hash AND s.expires_at > NOW() AND u.active = TRUE'
    );
    $statement->execute([':hash' => session_token_hash($token)]);
    $row = $statement->fetch();

    if (!$row) {
        clear_session_cookie();
        return null;
    }

    $remember = normalize_bool($row['remember']);
    $lastSeen = strtotime((string) $row['last_seen_at']) ?: 0;

    if (time() - $lastSeen >= SESSION_TOUCH_SECONDS) {
        $touch = $pdo->prepare(
            "UPDATE app_session
             SET last_seen_at = NOW(), expires_at = NOW() + make_interval(secs => :lifetime)
             WHERE id = :id"
        );
        $touch->execute([':lifetime' => session_lifetime($remember), ':id' => $row['session_id']]);

        if ($remember) {
            set_session_cookie($token, true);
        }
    }

    $user = public_user($row);

    return $user;
}

function require_login(PDO $pdo): array
{
    $user = current_user($pdo);

    if ($user === null) {
        json_error('Nicht angemeldet.', 401);
    }

    return $user;
}

/**
 * Schreibende Anfragen müssen den Header X-Requested-With tragen. Ein normales Formular
 * oder ein Link von einer fremden Seite kann ihn nicht setzen (Schutz gegen CSRF).
 */
function require_ajax_header(): void
{
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'XMLHttpRequest') {
        json_error('Ungültige Anfrage.', 403);
    }
}

function login(PDO $pdo, array $payload): array
{
    $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
    $password = (string) ($payload['password'] ?? '');
    $remember = filter_var($payload['remember'] ?? false, FILTER_VALIDATE_BOOLEAN);

    if ($email === '' || $password === '') {
        json_error('E-Mail und Passwort angeben.', 422);
    }

    $statement = $pdo->prepare('SELECT id, email, role, password_hash, active FROM app_user WHERE email = :email');
    $statement->execute([':email' => $email]);
    $row = $statement->fetch();

    // Auch ohne Treffer ein Hash prüfen, damit die Antwortzeit nicht verrät, ob es die E-Mail gibt
    $hash = $row ? (string) $row['password_hash'] : '$2y$10$2mI192ajfIfjboVJcAJWwuQ960G1XL/RvxVyN26pgdKF5Vyd4jND2';
    $valid = password_verify($password, $hash);

    if (!$row || !$valid || !normalize_bool($row['active'])) {
        usleep(400000);
        json_error('E-Mail oder Passwort falsch.', 401);
    }

    if (password_needs_rehash($hash, PASSWORD_BCRYPT)) {
        $rehash = $pdo->prepare('UPDATE app_user SET password_hash = :hash WHERE id = :id');
        $rehash->execute([':hash' => password_hash($password, PASSWORD_BCRYPT), ':id' => $row['id']]);
    }

    $token = bin2hex(random_bytes(32));
    $insert = $pdo->prepare(
        "INSERT INTO app_session (token_hash, user_id, remember, expires_at, user_agent)
         VALUES (:hash, :user_id, :remember, NOW() + make_interval(secs => :lifetime), :user_agent)"
    );
    $insert->execute([
        ':hash' => session_token_hash($token),
        ':user_id' => $row['id'],
        ':remember' => $remember ? 'true' : 'false',
        ':lifetime' => session_lifetime($remember),
        ':user_agent' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
    ]);

    $pdo->prepare('UPDATE app_user SET last_login_at = NOW() WHERE id = :id')->execute([':id' => $row['id']]);
    // Abgelaufene Sessions bei Gelegenheit aufräumen
    $pdo->exec('DELETE FROM app_session WHERE expires_at < NOW()');

    set_session_cookie($token, $remember);

    return public_user($row);
}

function logout(PDO $pdo): void
{
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');

    if ($token !== '') {
        $statement = $pdo->prepare('DELETE FROM app_session WHERE token_hash = :hash');
        $statement->execute([':hash' => session_token_hash($token)]);
    }

    clear_session_cookie();
}
