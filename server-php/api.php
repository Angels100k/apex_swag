<?php
// api.php — single front controller for the Apex Swag backend.
// Routes by ?action=  ->  rp | predator | save | history | leaderboard
//
// Drop-in replacement for the old local proxy (server.js / proxy.exe):
//   - rp / predator  proxy apexlegendsapi.com using the server-side key
//   - save / history  cloud match history in MySQL (keyed by player+platform)
//   - leaderboard     global aggregate over recent matches

require __DIR__ . '/db.php';

// ---- CORS (Overwolf extension origin is overwolf-extension://<id>) ----
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-App-Token');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function fail(int $code, string $msg): void {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function ok($data): void {
    echo json_encode($data);
    exit;
}

// ---- Shared-secret gate (stops random abuse of our API key) ----
$cfg = apex_config();
$token = $_SERVER['HTTP_X_APP_TOKEN'] ?? '';
if (!hash_equals($cfg['app_secret'], $token)) {
    fail(401, 'Unauthorized');
}

$action = $_GET['action'] ?? '';

// ---- Upstream Apex API call (same shape the old proxy used) ----
function apex_get(string $path, array $query): array {
    $cfg = apex_config();
    $query['auth'] = $cfg['apex_api_key'];
    $query['version'] = $query['version'] ?? 5;
    $url = 'https://api.mozambiquehe.re/' . $path . '?' . http_build_query($query);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        return ['http' => 502, 'body' => json_encode(['error' => 'Upstream unreachable: ' . $err])];
    }
    return ['http' => $http ?: 502, 'body' => $body];
}

// ---- Resolve (and create) a player row ----
function player_id(string $name, string $platform): int {
    $pdo = db();
    $name = trim($name);
    $platform = strtoupper(trim($platform)) ?: 'PC';
    $sel = $pdo->prepare('SELECT id FROM players WHERE name = ? AND platform = ?');
    $sel->execute([$name, $platform]);
    $id = $sel->fetchColumn();
    if ($id) return (int)$id;
    $ins = $pdo->prepare('INSERT INTO players (name, platform) VALUES (?, ?)');
    $ins->execute([$name, $platform]);
    return (int)$pdo->lastInsertId();
}

function to_dt(?string $iso): ?string {
    if (!$iso) return null;
    $t = strtotime($iso);
    return $t ? date('Y-m-d H:i:s', $t) : null;
}

switch ($action) {

    // ---------------- API proxy ----------------
    case 'rp': {
        $player = $_GET['player'] ?? '';
        $platform = $_GET['platform'] ?? 'PC';
        if ($player === '') fail(400, 'Missing player');
        $r = apex_get('bridge', ['player' => $player, 'platform' => $platform]);
        http_response_code($r['http']);
        echo $r['body'];
        exit;
    }

    case 'predator': {
        $r = apex_get('predator', []);
        http_response_code($r['http']);
        echo $r['body'];
        exit;
    }

    // ---------------- Cloud history: write ----------------
    case 'save': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST required');
        $payload = json_decode(file_get_contents('php://input'), true);
        if (!is_array($payload)) fail(400, 'Invalid JSON');

        $name = $payload['player'] ?? ($payload['current']['playerName'] ?? '');
        $platform = $payload['platform'] ?? ($payload['current']['platform'] ?? 'PC');
        if ($name === '') fail(400, 'Missing player');

        $pdo = db();
        $pid = player_id($name, $platform);

        // Collect every session (past + current) into one list to upsert.
        $sessions = $payload['sessions'] ?? [];
        if (!empty($payload['current'])) $sessions[] = $payload['current'];

        $upSession = $pdo->prepare(
            'INSERT INTO sessions (player_id, session_start, session_end, start_rp, current_rp, predator_rp)
             VALUES (:pid, :ss, :se, :srp, :crp, :prp)
             ON DUPLICATE KEY UPDATE
               session_end = VALUES(session_end),
               start_rp    = VALUES(start_rp),
               current_rp  = VALUES(current_rp),
               predator_rp = VALUES(predator_rp),
               id = LAST_INSERT_ID(id)'
        );
        $upMatch = $pdo->prepare(
            'INSERT INTO matches (player_id, session_id, ts, rp_before, rp_after, delta, rank_name, rank_div, ladder_pos)
             VALUES (:pid, :sid, :ts, :rb, :ra, :d, :rn, :rd, :lp)
             ON DUPLICATE KEY UPDATE
               session_id = VALUES(session_id),
               rp_before  = VALUES(rp_before),
               rp_after   = VALUES(rp_after),
               delta      = VALUES(delta),
               rank_name  = VALUES(rank_name),
               rank_div   = VALUES(rank_div),
               ladder_pos = VALUES(ladder_pos)'
        );

        $savedMatches = 0;
        $pdo->beginTransaction();
        try {
            foreach ($sessions as $s) {
                $ss = to_dt($s['sessionStart'] ?? null);
                if (!$ss) continue; // session_start is the dedup key; skip if absent
                $upSession->execute([
                    ':pid' => $pid,
                    ':ss'  => $ss,
                    ':se'  => to_dt($s['sessionEnd'] ?? null),
                    ':srp' => $s['startRP']     ?? null,
                    ':crp' => $s['currentRP']   ?? null,
                    ':prp' => $s['predatorRP']  ?? null,
                ]);
                $sid = (int)$pdo->lastInsertId();
                foreach (($s['matches'] ?? []) as $m) {
                    $ts = to_dt($m['timestamp'] ?? null);
                    if (!$ts) continue;
                    $upMatch->execute([
                        ':pid' => $pid,
                        ':sid' => $sid,
                        ':ts'  => $ts,
                        ':rb'  => $m['rpBefore'] ?? null,
                        ':ra'  => $m['rpAfter']  ?? null,
                        ':d'   => $m['delta']    ?? null,
                        ':rn'  => $m['rankName'] ?? null,
                        ':rd'  => isset($m['rankDiv']) ? (string)$m['rankDiv'] : null,
                        ':lp'  => $m['ladderPos'] ?? null,
                    ]);
                    $savedMatches++;
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail(500, 'Save failed');
        }
        ok(['ok' => true, 'player_id' => $pid, 'matches' => $savedMatches]);
    }

    // ---------------- Cloud history: read ----------------
    case 'history': {
        $name = $_GET['player'] ?? '';
        $platform = $_GET['platform'] ?? 'PC';
        if ($name === '') fail(400, 'Missing player');

        $pdo = db();
        $platform = strtoupper(trim($platform)) ?: 'PC';
        $sel = $pdo->prepare('SELECT id FROM players WHERE name = ? AND platform = ?');
        $sel->execute([trim($name), $platform]);
        $pid = $sel->fetchColumn();
        if (!$pid) ok(['sessions' => []]);

        $sStmt = $pdo->prepare(
            'SELECT id, session_start, session_end, start_rp, current_rp, predator_rp
             FROM sessions WHERE player_id = ? ORDER BY session_start ASC'
        );
        $sStmt->execute([$pid]);
        $sessions = $sStmt->fetchAll();

        $mStmt = $pdo->prepare(
            'SELECT session_id, ts, rp_before, rp_after, delta, rank_name, rank_div, ladder_pos
             FROM matches WHERE player_id = ? ORDER BY ts ASC'
        );
        $mStmt->execute([$pid]);
        $bySession = [];
        foreach ($mStmt->fetchAll() as $m) {
            $bySession[(int)$m['session_id']][] = [
                'timestamp' => date('c', strtotime($m['ts'])),
                'rpBefore'  => $m['rp_before'] !== null ? (int)$m['rp_before'] : null,
                'rpAfter'   => $m['rp_after']  !== null ? (int)$m['rp_after']  : null,
                'delta'     => $m['delta']     !== null ? (int)$m['delta']     : null,
                'rankName'  => $m['rank_name'],
                'rankDiv'   => $m['rank_div'],
                'ladderPos' => $m['ladder_pos'] !== null ? (int)$m['ladder_pos'] : null,
            ];
        }

        $out = [];
        foreach ($sessions as $s) {
            $out[] = [
                'sessionStart' => date('c', strtotime($s['session_start'])),
                'sessionEnd'   => $s['session_end'] ? date('c', strtotime($s['session_end'])) : null,
                'startRP'      => $s['start_rp']   !== null ? (int)$s['start_rp']   : null,
                'currentRP'    => $s['current_rp'] !== null ? (int)$s['current_rp'] : null,
                'predatorRP'   => $s['predator_rp']!== null ? (int)$s['predator_rp']: null,
                'playerName'   => trim($name),
                'platform'     => $platform,
                'matches'      => $bySession[(int)$s['id']] ?? [],
            ];
        }
        ok(['sessions' => $out]);
    }

    // ---------------- Global leaderboard ----------------
    case 'leaderboard': {
        $window = $_GET['window'] ?? '24h';
        $since = match ($window) {
            '24h'   => date('Y-m-d H:i:s', time() - 86400),
            '7d'    => date('Y-m-d H:i:s', time() - 7 * 86400),
            default => '1970-01-01 00:00:00',
        };
        $pdo = db();
        $stmt = $pdo->prepare(
            'SELECT p.name, p.platform,
                    SUM(m.delta)  AS net_rp,
                    COUNT(*)      AS matches,
                    MAX(m.rp_after) AS peak_rp
             FROM matches m
             JOIN players p ON p.id = m.player_id
             WHERE m.ts >= ?
             GROUP BY m.player_id
             ORDER BY net_rp DESC
             LIMIT 50'
        );
        $stmt->execute([$since]);
        $rows = array_map(fn($r) => [
            'name'     => $r['name'],
            'platform' => $r['platform'],
            'netRP'    => (int)$r['net_rp'],
            'matches'  => (int)$r['matches'],
            'peakRP'   => $r['peak_rp'] !== null ? (int)$r['peak_rp'] : null,
        ], $stmt->fetchAll());
        ok(['window' => $window, 'players' => $rows]);
    }

    default:
        fail(400, 'Unknown action');
}
