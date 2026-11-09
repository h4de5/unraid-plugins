#!/usr/bin/php -q
<?php

require_once __DIR__ . '/../include/lib.php';

$command = $argv[1] ?? '';
$jobDir = isset($argv[2]) ? rtrim($argv[2], '/') : '';

if ($command === '' || $jobDir === '' || !uuz_safe_job_id(basename($jobDir)) || !is_dir($jobDir)) {
    fwrite(STDERR, "usage: job-helper.php status|history <job-dir> [history-file] [limit]\n");
    exit(64);
}

if ($command === 'status') {
    $data = uuz_job_status($jobDir) ?: [];
    $state = getenv('UUZ_STATE');
    $phase = getenv('UUZ_PHASE');
    $message = getenv('UUZ_MESSAGE');
    $percent = getenv('UUZ_PERCENT');
    $exitCode = getenv('UUZ_EXIT');
    $pid = getenv('UUZ_PID');
    $pgid = getenv('UUZ_PGID');
    $warnings = getenv('UUZ_WARNINGS');

    $data['state'] = $state !== false && $state !== '' ? $state : ($data['state'] ?? 'running');
    $data['phase'] = $phase !== false ? $phase : ($data['phase'] ?? '');
    $data['message'] = $message !== false ? $message : ($data['message'] ?? '');
    $data['percent'] = $percent !== false && $percent !== '' && is_numeric($percent) ? max(0, min(100, (int) $percent)) : ($data['percent'] ?? null);
    $data['exit_code'] = $exitCode !== false && $exitCode !== '' && is_numeric($exitCode) ? (int) $exitCode : ($data['exit_code'] ?? null);
    $data['pid'] = $pid !== false && $pid !== '' && is_numeric($pid) ? (int) $pid : ($data['pid'] ?? 0);
    $data['pgid'] = $pgid !== false && $pgid !== '' && is_numeric($pgid) ? (int) $pgid : ($data['pgid'] ?? 0);
    if ($warnings !== false && $warnings !== '') {
        $decoded = json_decode($warnings, true);
        $data['warnings'] = is_array($decoded) ? array_values($decoded) : [];
    }
    if (!isset($data['id'])) {
        $data['id'] = basename($jobDir);
    }
    if (empty($data['started'])) {
        $data['started'] = gmdate('c');
    }
    if (in_array($data['state'], ['done', 'error', 'cancelled'], true)) {
        if (empty($data['finished'])) {
            $data['finished'] = gmdate('c');
        }
    } else {
        $data['finished'] = null;
    }
    $data['updated'] = gmdate('c');
    exit(uuz_write_job_status($jobDir, $data) ? 0 : 70);
}

if ($command === 'history') {
    $historyFile = $argv[3] ?? uuz_history_file();
    $limit = isset($argv[4]) && is_numeric($argv[4]) ? (int) $argv[4] : 200;
    exit(uuz_append_history($jobDir . '/status.json', $historyFile, $limit) ? 0 : 70);
}

fwrite(STDERR, "unknown command\n");
exit(64);
