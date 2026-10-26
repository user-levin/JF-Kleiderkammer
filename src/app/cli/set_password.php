<?php

declare(strict_types=1);

// Passwort eines Benutzers setzen oder einen neuen Benutzer anlegen.
//
//   docker exec -it kleiderkammer-app php /var/www/html/app/cli/set_password.php <email> [rollen]
//
// Gibt es die E-Mail noch nicht, wird der Benutzer mit den angegebenen Rollen angelegt
// (kommagetrennt, z. B. betreuer,datenbank; Standard: admin). Bei bestehenden Benutzern
// bleiben die Rollen unverändert. Das Passwort wird verdeckt abgefragt. Bestehende Sessions
// des Benutzers werden beendet.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../auth.php';
require_once __DIR__ . '/../audit.php';
require_once __DIR__ . '/../todos.php';

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
$roles = array_values(array_filter(array_map(
    static fn($role) => mb_strtolower(trim($role)),
    explode(',', (string) ($argv[2] ?? 'admin'))
)));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Aufruf: php set_password.php <email> [rollen]\n");
    exit(1);
}

if ($roles === [] || array_diff($roles, valid_roles()) !== []) {
    fwrite(STDERR, 'Rollen müssen aus ' . implode(', ', valid_roles()) . " bestehen.\n");
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
    $insert = $pdo->prepare('INSERT INTO app_user (email, password_hash, roles, active) VALUES (:email, :hash, :roles, TRUE)');
    $insert->execute([':email' => $email, ':hash' => $hash, ':roles' => roles_to_pg_array($roles)]);
    audit($pdo, 'user.create', sprintf('Benutzer angelegt über Konsole: %s (%s)', $email, implode(', ', $roles)), null, [], null, 'Konsole');
    fwrite(STDOUT, 'Benutzer ' . $email . ' mit Rollen ' . implode(', ', $roles) . " angelegt.\n");
    exit(0);
}

$update = $pdo->prepare('UPDATE app_user SET password_hash = :hash, active = TRUE WHERE id = :id');
$update->execute([':hash' => $hash, ':id' => $userId]);
$pdo->prepare('DELETE FROM app_session WHERE user_id = :id')->execute([':id' => $userId]);
audit($pdo, 'user.update', "Passwort für {$email} über Konsole gesetzt", (string) $userId, [], null, 'Konsole');
fwrite(STDOUT, "Passwort für {$email} gesetzt, alte Sessions beendet.\n");
