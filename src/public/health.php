<?php

declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/../app/bootstrap.php';

$payload = [
	'app' => 'Digitale Kleiderkammer',
	'timestamp' => (new DateTimeImmutable())->format(DateTimeImmutable::ATOM),
];

try {
	$pdo = db();
	$pdo->query('SELECT 1');

	http_response_code(200);
	$payload['status'] = 'ok';
	$payload['db'] = 'ok';
} catch (Throwable $throwable) {
	http_response_code(503);
	$payload['status'] = 'error';
	$payload['db'] = 'down';
	$payload['message'] = 'Keine Verbindung zur Datenbank möglich.';
	$payload['detail'] = $throwable->getMessage();
}

echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
