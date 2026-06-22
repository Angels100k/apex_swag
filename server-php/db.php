<?php
// db.php — PDO connection helper. Loaded by api.php.

function apex_config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $path = __DIR__ . '/config.php';
        if (!is_file($path)) {
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Server not configured (missing config.php)']);
            exit;
        }
        $cfg = require $path;
    }
    return $cfg;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = apex_config();
        $dsn = "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4";
        $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}
