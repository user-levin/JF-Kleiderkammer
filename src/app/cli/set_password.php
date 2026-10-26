<?php

declare(strict_types=1);

// Passwort eines Benutzers setzen oder einen neuen Benutzer anlegen.
//
//   docker exec -it kleiderkammer-app php /var/www/html/app/cli/set_password.php <email> [rolle]
//
// Gibt es die E-Mail noch nicht, wird der Benutzer mit der angegebenen Rolle angelegt
// (Standard: admin). Das Passwort wird verdeckt abgefragt. Bestehende Sessions des
// Benutzers werden beendet.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../auth.php';

function normalize_bool($value): bool
{
    return filter_var($value, FILTER_VALIDATE_BOOLEAN);
}

function prompt_hidden(string $label): string
{
    fwrite(STDOUT, $label);
    $interactive = function_exists('posix_isatty') ? posix_isatty(STDIN) : true;
    if ($interactive) {
        shell_exec('stty -echo');
    }
    $value = rtrim((string) fgets(STDIN), "\r\n");
    if ($interactive) {
        shell_exec('stty echo');
        fwrite(STDOUT, PHP_EOL);
    }

    return $value;
}

$email = mb_strtolower(trim((string) ($argv[1] ?? '')));
$role = mb_strtolower(trim((string) ($argv[2] ?? 'admin')));
$validRoles = ['leser', 'verwalter', 'admin'];

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Aufruf: php set_password.php <email> [rolle]\n");
    exit(1);
}

if (!in_array($role, $validRoles, true)) {
    fwrite(STDERR, 'Rolle muss eine von ' . implode(', ', $validRoles) . " sein.\n");
    exit(1);
}

$pdo = db();
ensure_schema($pdo);

$password = prompt_hidden('Neues Passwort: ');
if (strlen($password) < 8) {
    fwrite(STDERR, "Passwort muss mindestens 8 Zeichen haben.\n");
    exit(1);
}
if (prompt_hidden('Passwort wiederholen: ') !== $password) {
    fwrite(STDERR, "Passwörter stimmen nicht überein.\n");
    exit(1);
}

$hash = password_hash($password, PASSWORD_BCRYPT);

$find = $pdo->prepare('SELECT id FROM app_user WHERE email = :email');
$find->execute([':email' => $email]);
$userId = $find->fetchColumn();

if ($userId === false) {
    $insert = $pdo->prepare('INSERT INTO app_user (email, password_hash, role, active) VALUES (:email, :hash, :role, TRUE)');
    $insert->execute([':email' => $email, ':hash' => $hash, ':role' => $role]);
    fwrite(STDOUT, "Benutzer {$email} mit Rolle {$role} angelegt.\n");
    exit(0);
}

$update = $pdo->prepare('UPDATE app_user SET password_hash = :hash, active = TRUE WHERE id = :id');
$update->execute([':hash' => $hash, ':id' => $userId]);
$pdo->prepare('DELETE FROM app_session WHERE user_id = :id')->execute([':id' => $userId]);
fwrite(STDOUT, "Passwort für {$email} gesetzt, alte Sessions beendet.\n");
