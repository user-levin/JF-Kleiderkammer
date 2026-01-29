<?php
// Simple front controller placeholder for the future API
header('Content-Type: application/json');

echo json_encode([
    'app' => 'Digitale Kleiderkammer',
    'status' => 'ready',
    'timestamp' => gmdate('c'),
]);
