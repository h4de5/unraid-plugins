<?php

$wrappers = '/usr/local/emhttp/plugins/dynamix/include/Wrappers.php';
if (is_file($wrappers)) {
    require_once $wrappers;
}
require_once __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    uuz_json_response(false, null, 'METHOD_NOT_ALLOWED', 'POST required', 405);
}

if (!isset($var) || !is_array($var)) {
    $var = is_file('/var/local/emhttp/var.ini') ? @parse_ini_file('/var/local/emhttp/var.ini') : [];
}
$GLOBALS['var'] = $var;

$input = uuz_request_data();
$action = uuz_req($input, 'action', '');
if (!is_string($action) || $action === '') {
    uuz_fail('INVALID_REQUEST', 'Missing action', 400);
}

$cfg = uuz_cfg();
$seven = uuz_sevenzip($cfg);

function uuz_require_executable(?string $binary): void
{
    if ($binary === null) {
        uuz_fail('INTERNAL', '7-Zip binary not found. Check the advanced settings.', 500);
    }
}

function uuz_probe_or_fail(array $cfg, string $archive, string $password, bool $useSaved, ?string $target): array
{
    $probe = uuz_probe($cfg, $archive, $password, $useSaved, $target);
    if (isset($probe['error'])) {
        $error = $probe['error'];
        uuz_fail($error['code'] ?? 'INTERNAL', $error['message'] ?? 'Probe failed', 400);
    }
    return $probe;
}

function uuz_job_request(array $input, string $key, $default = null)
{
    return uuz_req($input, $key, $default);
}

try {
    switch ($action) {
        case 'probe':
        case 'list':
            $archiveInfo = uuz_validate_archive(uuz_job_request($input, 'archive', ''));
            if ($archiveInfo === null) {
                uuz_fail('INVALID_PATH', 'Archive path is not allowed or not readable');
            }
            $target = null;
            $targetInput = uuz_job_request($input, 'target', '');
            if (is_string($targetInput) && $targetInput !== '') {
                $target = uuz_validate_target($targetInput);
                if ($target === null) {
                    uuz_fail('INVALID_PATH', 'Target path is not allowed');
                }
            }
            $password = (string) uuz_job_request($input, 'password', '');
            if (strpos($password, "\0") !== false || preg_match('/[\r\n]/', $password)) {
                uuz_fail('INVALID_REQUEST', 'Invalid password');
            }
            $useSaved = uuz_bool(uuz_job_request($input, 'use_saved_passwords', true), true);
            uuz_require_executable($seven);
            $probe = uuz_probe_or_fail($cfg, $archiveInfo['path'], $password, $useSaved, $target);
            uuz_json_response(true, uuz_public_probe($probe));
            break;

        case 'start_extract':
            uuz_require_executable($seven);
            $archiveInfo = uuz_validate_archive(uuz_job_request($input, 'archive', ''));
            if ($archiveInfo === null) {
                uuz_fail('INVALID_PATH', 'Archive path is not allowed or not readable');
            }
            $targetInput = uuz_job_request($input, 'target', '');
            if (!is_string($targetInput) || trim($targetInput) === '') {
                $targetInput = dirname($archiveInfo['path']);
            }
            $target = uuz_validate_target($targetInput);
            if ($target === null) {
                uuz_fail('INVALID_PATH', 'Target path is not allowed');
            }
            $password = (string) uuz_job_request($input, 'password', '');
            if (strpos($password, "\0") !== false || preg_match('/[\r\n]/', $password)) {
                uuz_fail('INVALID_REQUEST', 'Invalid password');
            }
            $useSaved = uuz_bool(uuz_job_request($input, 'use_saved_passwords', true), true);
            $jobExcludes = uuz_normalize_list(uuz_job_request($input, 'excludes', []), false, true);
            if ($jobExcludes === null) {
                uuz_fail('INVALID_REQUEST', 'Invalid exclude list');
            }
            $excludes = array_values(array_unique(array_merge(uuz_read_list(uuz_exclude_file(), true), $jobExcludes)));
            if (count($excludes) > 1000) {
                uuz_fail('INVALID_REQUEST', 'Invalid exclude list');
            }
            $overwrite = uuz_enum((string) uuz_job_request($input, 'overwrite', $cfg['DEFAULT_OVERWRITE']), ['overwrite', 'skip', 'rename_existing', 'rename_new', 'ask'], $cfg['DEFAULT_OVERWRITE']);
            if ($overwrite === 'ask') {
                $overwrite = 'overwrite';
            }
            $strip = uuz_enum((string) uuz_job_request($input, 'strip_root', $cfg['STRIP_ROOT']), ['auto', 'always', 'never'], $cfg['STRIP_ROOT']);
            $preserve = uuz_bool(uuz_job_request($input, 'preserve_symlinks', $cfg['PRESERVE_SYMLINKS'] === 'yes'), $cfg['PRESERVE_SYMLINKS'] === 'yes');
            $warn = uuz_bool(uuz_job_request($input, 'warn_suspicious', $cfg['WARN_SUSPICIOUS_PATHS'] === 'yes'), $cfg['WARN_SUSPICIOUS_PATHS'] === 'yes');
            $confirmSuspicious = uuz_bool(uuz_job_request($input, 'confirm_suspicious', false), false);

            $probe = uuz_probe_or_fail($cfg, $archiveInfo['path'], $password, $useSaved, $target);
            if ($warn && $probe['suspicious'] !== [] && !$confirmSuspicious) {
                uuz_fail('CONFIRM_REQUIRED', 'The archive contains suspicious paths or links', 409, ['suspicious' => $probe['suspicious']]);
            }
            if ($probe['free_space'] !== null && $probe['total_size'] + UUZ_RESERVE_BYTES > $probe['free_space']) {
                uuz_fail('NO_SPACE', 'Not enough free space in the target filesystem', 409, [
                    'required' => $probe['total_size'] + UUZ_RESERVE_BYTES,
                    'available' => $probe['free_space'],
                ]);
            }
            if (uuz_active_job_count() >= (int) $cfg['MAX_JOBS']) {
                uuz_fail('BUSY', 'The maximum number of concurrent jobs is already running', 409);
            }
            $id = uuz_new_job_id();
            $staging = rtrim($target, '/') . '/.unraid-unzip.' . $id;
            $lockFile = uuz_lock_file($target);
            $env = '';
            $env .= uuz_job_env_line('JOB_ID', $id);
            $env .= uuz_job_env_line('JOB_KIND', 'extract');
            $env .= uuz_job_env_line('ARCHIVE', $archiveInfo['path']);
            $env .= uuz_job_env_line('TARGET', $target);
            $env .= uuz_job_env_line('STAGING', $staging);
            $env .= uuz_job_env_line('TYPE', $probe['archive_type']);
            $env .= uuz_job_env_line('PASSWORD', $probe['password']);
            $env .= uuz_job_env_line('TOTAL_BYTES', (string) $probe['total_size']);
            $env .= uuz_job_env_line('RESERVE_BYTES', (string) UUZ_RESERVE_BYTES);
            $env .= uuz_job_env_line('PHP_BIN', (string) (uuz_find_binary('php') ?? '/usr/bin/php'));
            $env .= uuz_job_env_line('PLUGIN_DIR', uuz_plugin_dir());
            $env .= uuz_job_env_line('WARNINGS_JSON', (string) json_encode($probe['suspicious'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            $env .= uuz_job_env_line('OVERWRITE', $overwrite);
            $env .= uuz_job_env_line('STRIP_ROOT', $strip);
            $env .= uuz_job_env_line('PRESERVE_SYMLINKS', $preserve ? 'yes' : 'no');
            $env .= uuz_job_env_line('SEVENZIP', (string) $seven);
            $env .= uuz_job_env_line('UNRAR', (string) (uuz_unrar($cfg) ?? ''));
            $env .= uuz_job_env_line('OWNER_UID', (string) $cfg['OWNER_UID']);
            $env .= uuz_job_env_line('OWNER_GID', (string) $cfg['OWNER_GID']);
            $env .= uuz_job_env_line('CONFIG_DIR', uuz_config_dir());
            $env .= uuz_job_env_line('HISTORY_FILE', uuz_history_file());
            $env .= uuz_job_env_line('HISTORY_LIMIT', (string) $cfg['HISTORY_LIMIT']);
            $env .= uuz_job_env_line('LOG_RETENTION_MIN', (string) $cfg['LOG_RETENTION_MIN']);
            $env .= uuz_job_env_line('LOCK_FILE', $lockFile);
            $env .= uuz_job_env_line('NOTIFY_ON_COMPLETE', $cfg['NOTIFY_ON_COMPLETE']);
            $env .= uuz_job_env_array('EXCLUDES', $excludes);
            uuz_cleanup_jobs($cfg);
            $status = [
                'archive' => $archiveInfo['path'],
                'target' => $target,
                'warnings' => $probe['suspicious'],
            ];
            $jobId = uuz_make_job($cfg, 'extract', $status, $env, $target, $id);
            if ($jobId === null) {
                uuz_fail('BUSY', 'Another job is already using this target', 409);
            }
            uuz_json_response(true, ['id' => $jobId]);
            break;

        case 'status':
            $id = (string) uuz_job_request($input, 'id', '');
            $dir = uuz_job_dir($id);
            if ($dir === null) {
                uuz_fail('INVALID_REQUEST', 'Invalid job id');
            }
            $status = uuz_job_status($dir);
            if ($status === null) {
                uuz_fail('NOT_FOUND', 'Job not found', 404);
            }
            $log = uuz_log_tail($dir . '/output.log', 100);
            $status['percent'] = uuz_progress_from_log($log, isset($status['percent']) ? (int) $status['percent'] : null);
            uuz_json_response(true, ['status' => $status, 'log_tail' => $log]);
            break;

        case 'cancel':
            $id = (string) uuz_job_request($input, 'id', '');
            $dir = uuz_job_dir($id);
            if ($dir === null) {
                uuz_fail('INVALID_REQUEST', 'Invalid job id');
            }
            $status = uuz_job_status($dir);
            if ($status === null) {
                uuz_fail('NOT_FOUND', 'Job not found', 404);
            }
            if (!in_array($status['state'] ?? '', ['queued', 'running'], true)) {
                uuz_json_response(true, ['cancelled' => false, 'state' => $status['state'] ?? '']);
            }
            $pgid = (int) ($status['pgid'] ?? 0);
            $pid = (int) ($status['pid'] ?? 0);
            $signalled = $pgid > 1 ? uuz_kill_group($pgid, 15) : ($pid > 1 ? uuz_kill_group($pid, 15) : false);
            uuz_json_response(true, ['cancelled' => $signalled]);
            break;

        case 'save':
            $raw = [];
            foreach (uuz_defaults() as $key => $_default) {
                $raw[$key] = uuz_req($input, $key, null);
            }
            if ($raw['DEFAULT_OVERWRITE'] === null) {
                $raw['DEFAULT_OVERWRITE'] = $cfg['DEFAULT_OVERWRITE'];
            }
            if ($raw['STRIP_ROOT'] === null) {
                $raw['STRIP_ROOT'] = $cfg['STRIP_ROOT'];
            }
            $saved = uuz_sanitize_cfg($raw);
            if (array_key_exists('passwords', $input)) {
                $passwords = uuz_normalize_list($input['passwords'], false, false);
                if ($passwords === null) {
                    uuz_fail('INVALID_REQUEST', 'Invalid password list');
                }
                if (!uuz_write_atomic(uuz_password_file(), implode("\n", $passwords) . ($passwords ? "\n" : ''), 0600)) {
                    uuz_fail('INTERNAL', 'Could not save the password list', 500);
                }
            }
            if (array_key_exists('excludes', $input)) {
                $excludes = uuz_normalize_list($input['excludes'], true, true);
                if ($excludes === null) {
                    uuz_fail('INVALID_REQUEST', 'Invalid exclude list');
                }
                if (!uuz_write_atomic(uuz_exclude_file(), implode("\n", $excludes) . ($excludes ? "\n" : ''), 0644)) {
                    uuz_fail('INTERNAL', 'Could not save the exclude list', 500);
                }
            }
            if (!uuz_save_cfg($saved)) {
                uuz_fail('INTERNAL', 'Could not save the settings', 500);
            }
            uuz_json_response(true, [
                'password_count' => count(uuz_read_list(uuz_password_file())),
                'exclude_count' => count(uuz_read_list(uuz_exclude_file(), true)),
            ]);
            break;

        case 'save_lists':
            $configDir = uuz_config_dir();
            if (!is_dir($configDir) && !@mkdir($configDir, 0755, true) && !is_dir($configDir)) {
                uuz_fail('INTERNAL', 'Cannot create the configuration directory', 500);
            }
            if (array_key_exists('passwords', $input)) {
                $passwords = uuz_normalize_list($input['passwords'], false, false);
                if ($passwords === null) {
                    uuz_fail('INVALID_REQUEST', 'Invalid password list');
                }
                if (!uuz_write_atomic(uuz_password_file(), implode("\n", $passwords) . ($passwords ? "\n" : ''), 0600)) {
                    uuz_fail('INTERNAL', 'Could not save the password list', 500);
                }
            }
            if (array_key_exists('excludes', $input)) {
                $excludes = uuz_normalize_list($input['excludes'], true, true);
                if ($excludes === null) {
                    uuz_fail('INVALID_REQUEST', 'Invalid exclude list');
                }
                if (!uuz_write_atomic(uuz_exclude_file(), implode("\n", $excludes) . ($excludes ? "\n" : ''), 0644)) {
                    uuz_fail('INTERNAL', 'Could not save the exclude list', 500);
                }
            }
            uuz_json_response(true, [
                'password_count' => count(uuz_read_list(uuz_password_file())),
                'exclude_count' => count(uuz_read_list(uuz_exclude_file(), true)),
            ]);
            break;

        case 'history':
            uuz_json_response(true, ['items' => uuz_read_history((int) $cfg['HISTORY_LIMIT'])]);
            break;

        case 'clear_history':
            if (!uuz_clear_history()) {
                uuz_fail('INTERNAL', 'Could not clear history', 500);
            }
            uuz_json_response(true, ['cleared' => true]);
            break;

        case 'diagnostics':
            uuz_json_response(true, uuz_diagnostics($cfg));
            break;

        default:
            uuz_fail('INVALID_REQUEST', 'Unknown action');
    }
} catch (Throwable $e) {
    uuz_exception_error($e);
}
