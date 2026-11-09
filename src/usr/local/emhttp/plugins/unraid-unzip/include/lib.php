<?php

define('UUZ_PLUGIN', 'unraid-unzip');
define('UUZ_VERSION', '2026.11.06.01');
define('UUZ_RESERVE_BYTES', 67108864);

function uuz_plugin_dir(): string
{
    return dirname(__DIR__);
}

function uuz_config_dir(): string
{
    $override = getenv('UNRAID_UNZIP_CONFIG_DIR');
    return $override !== false && $override !== '' ? $override : '/boot/config/plugins/' . UUZ_PLUGIN;
}

function uuz_job_root(): string
{
    $override = getenv('UNRAID_UNZIP_JOB_DIR');
    return $override !== false && $override !== '' ? $override : '/tmp/' . UUZ_PLUGIN;
}

function uuz_defaults(): array
{
    return [
        'DEFAULT_OVERWRITE' => 'ask',
        'STRIP_ROOT' => 'auto',
        'PRESERVE_SYMLINKS' => 'yes',
        'WARN_SUSPICIOUS_PATHS' => 'yes',
        'OWNER_UID' => 99,
        'OWNER_GID' => 100,
        'MAX_JOBS' => 2,
        'HISTORY_LIMIT' => 200,
        'LOG_RETENTION_MIN' => 60,
        'SEVENZIP_PATH' => '/usr/bin/7zzs',
        'UNRAR_PATH' => '',
        'NOTIFY_ON_COMPLETE' => 'yes',
    ];
}

function uuz_bool($value, bool $default): bool
{
    if (is_bool($value)) {
        return $value;
    }
    if (is_int($value)) {
        return $value !== 0;
    }
    if (!is_string($value)) {
        return $default;
    }
    $value = strtolower(trim($value));
    if (in_array($value, ['yes', '1', 'true', 'on'], true)) {
        return true;
    }
    if (in_array($value, ['no', '0', 'false', 'off', ''], true)) {
        return false;
    }
    return $default;
}

function uuz_enum($value, array $allowed, string $default): string
{
    if (!is_string($value)) {
        return $default;
    }
    $value = strtolower(trim($value));
    return in_array($value, $allowed, true) ? $value : $default;
}

function uuz_int($value, int $min, int $max, int $default): int
{
    if (!is_numeric($value)) {
        return $default;
    }
    $value = (int) $value;
    return max($min, min($max, $value));
}

function uuz_sanitize_cfg(array $raw): array
{
    $d = uuz_defaults();
    $cfg = $d;
    foreach ($d as $key => $default) {
        if (array_key_exists($key, $raw)) {
            $cfg[$key] = $raw[$key];
        }
    }
    foreach (['PRESERVE_SYMLINKS', 'WARN_SUSPICIOUS_PATHS', 'NOTIFY_ON_COMPLETE'] as $key) {
        $cfg[$key] = uuz_bool($cfg[$key], uuz_bool($d[$key], true)) ? 'yes' : 'no';
    }
    $cfg['DEFAULT_OVERWRITE'] = uuz_enum($cfg['DEFAULT_OVERWRITE'], ['ask', 'overwrite', 'skip', 'rename_existing', 'rename_new'], 'ask');
    $cfg['STRIP_ROOT'] = uuz_enum($cfg['STRIP_ROOT'], ['auto', 'always', 'never'], 'auto');
    $cfg['OWNER_UID'] = uuz_int($cfg['OWNER_UID'], 0, 65535, 99);
    $cfg['OWNER_GID'] = uuz_int($cfg['OWNER_GID'], 0, 65535, 100);
    $cfg['MAX_JOBS'] = uuz_int($cfg['MAX_JOBS'], 1, 8, 2);
    $cfg['HISTORY_LIMIT'] = uuz_int($cfg['HISTORY_LIMIT'], 1, 10000, 200);
    $cfg['LOG_RETENTION_MIN'] = uuz_int($cfg['LOG_RETENTION_MIN'], 0, 10080, 60);
    $cfg['SEVENZIP_PATH'] = is_string($cfg['SEVENZIP_PATH']) && trim($cfg['SEVENZIP_PATH']) !== '' ? trim($cfg['SEVENZIP_PATH']) : $d['SEVENZIP_PATH'];
    $cfg['UNRAR_PATH'] = is_string($cfg['UNRAR_PATH']) ? trim($cfg['UNRAR_PATH']) : '';
    return $cfg;
}

function uuz_parse_ini(string $file): array
{
    if (!is_file($file)) {
        return [];
    }
    $data = @parse_ini_file($file, false, INI_SCANNER_RAW);
    return is_array($data) ? $data : [];
}

function uuz_cfg(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    $raw = [];
    if (function_exists('parse_plugin_cfg')) {
        $parsed = @parse_plugin_cfg(UUZ_PLUGIN);
        if (is_array($parsed)) {
            $raw = $parsed;
        }
    }
    if (!$raw) {
        $raw = array_merge(
            uuz_parse_ini(uuz_plugin_dir() . '/default.cfg'),
            uuz_parse_ini(uuz_config_dir() . '/' . UUZ_PLUGIN . '.cfg')
        );
    }
    $cached = uuz_sanitize_cfg($raw);
    return $cached;
}

function uuz_h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function uuz_json($value): string
{
    return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
}

function uuz_json_response(bool $ok, $data = null, ?string $code = null, ?string $message = null, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ($ok) {
        echo uuz_json(['ok' => true, 'data' => $data]);
    } else {
        echo uuz_json(['ok' => false, 'error' => ['code' => $code ?? 'INTERNAL', 'message' => $message ?? 'Unknown error']]);
    }
    exit;
}

function uuz_fail(string $code, string $message, int $status = 400, $data = null): void
{
    if ($data !== null) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo uuz_json(['ok' => false, 'error' => ['code' => $code, 'message' => $message], 'data' => $data]);
        exit;
    }
    uuz_json_response(false, null, $code, $message, $status);
}

function uuz_exception_error(Throwable $e): void
{
    uuz_fail('INTERNAL', 'Internal error: ' . $e->getMessage(), 500);
}

function uuz_request_data(): array
{
    $data = $_POST;
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($contentType, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $parsed = json_decode($raw, true);
        if (is_array($parsed)) {
            $data = array_merge($data, $parsed);
        }
    }
    return $data;
}

function uuz_req(array $data, string $key, $default = null)
{
    return array_key_exists($key, $data) ? $data[$key] : $default;
}

function uuz_array_arg($value): array
{
    if (is_array($value)) {
        return array_values($value);
    }
    if (is_string($value) && $value !== '') {
        return preg_split('/\r\n|\r|\n/', $value);
    }
    return [];
}

function uuz_clean_path($path): ?string
{
    if (!is_string($path) || $path === '' || $path[0] !== '/') {
        return null;
    }
    if (strpos($path, "\0") !== false || preg_match('/[\r\n]/', $path)) {
        return null;
    }
    $parts = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            if (!$parts) {
                return null;
            }
            array_pop($parts);
            continue;
        }
        $parts[] = $part;
    }
    return '/' . implode('/', $parts);
}

function uuz_allowed_path(?string $path): bool
{
    if ($path === null) {
        return false;
    }
    return $path === '/mnt' || strpos($path, '/mnt/') === 0 || $path === '/boot' || strpos($path, '/boot/') === 0;
}

function uuz_nearest_existing(string $path): ?string
{
    $candidate = $path;
    while (!file_exists($candidate)) {
        $parent = dirname($candidate);
        if ($parent === $candidate) {
            return null;
        }
        $candidate = $parent;
    }
    return $candidate;
}

function uuz_validate_archive($path): ?array
{
    $clean = uuz_clean_path($path);
    if ($clean === null || !uuz_allowed_path($clean) || !is_file($clean) || !is_readable($clean)) {
        return null;
    }
    $real = realpath($clean);
    if ($real === false || !uuz_allowed_path($real)) {
        return null;
    }
    return ['path' => $clean, 'real' => $real];
}

function uuz_validate_target($path, bool $mustExist = false): ?string
{
    $clean = uuz_clean_path($path);
    if ($clean === null || !uuz_allowed_path($clean)) {
        return null;
    }
    if (file_exists($clean)) {
        $real = realpath($clean);
        if ($real === false || !uuz_allowed_path($real) || !is_dir($real)) {
            return null;
        }
        return $real;
    }
    if ($mustExist) {
        return null;
    }
    $existing = uuz_nearest_existing($clean);
    if ($existing === null) {
        return null;
    }
    $realExisting = realpath($existing);
    if ($realExisting === false || !uuz_allowed_path($realExisting) || !is_dir($realExisting)) {
        return null;
    }
    $suffix = substr($clean, strlen($existing));
    $resolved = rtrim($realExisting, '/') . $suffix;
    return $resolved === '' ? '/' : $resolved;
}

function uuz_detect_type($path): ?string
{
    if (!is_string($path)) {
        return null;
    }
    $name = strtolower(basename($path));
    if (preg_match('/\.(7z|zip)\.\d{3}$/', $name, $m)) {
        return $m[1] === 'zip' ? 'zip-split' : '7z-split';
    }
    if (preg_match('/\.(part\d+\.rar|r\d{2})$/', $name) || preg_match('/\.rar$/', $name)) {
        return 'rar';
    }
    if (preg_match('/\.(tar\.gz|tgz)$/', $name)) {
        return 'tar.gz';
    }
    if (preg_match('/\.(tar\.bz2|tbz2|tbz)$/', $name)) {
        return 'tar.bz2';
    }
    if (preg_match('/\.(tar\.xz|txz)$/', $name)) {
        return 'tar.xz';
    }
    if (preg_match('/\.(tar\.zst|tzst)$/', $name)) {
        return 'tar.zst';
    }
    if (preg_match('/\.tar$/', $name)) {
        return 'tar';
    }
    if (preg_match('/\.(zip|zipx|jar|apk|docx|xlsx|epub|ipa)$/', $name)) {
        return 'zip';
    }
    if (preg_match('/\.7z$/', $name)) {
        return '7z';
    }
    if (preg_match('/\.gz$/', $name)) {
        return 'gz';
    }
    if (preg_match('/\.(bz2|bzip2)$/', $name)) {
        return 'bz2';
    }
    if (preg_match('/\.xz$/', $name)) {
        return 'xz';
    }
    if (preg_match('/\.zst$/', $name)) {
        return 'zst';
    }
    return null;
}

function uuz_is_tarball(string $type): bool
{
    return in_array($type, ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst'], true);
}

function uuz_archive_stem(string $path): string
{
    $base = basename($path);
    $changed = true;
    while ($changed) {
        $changed = false;
        foreach (['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst', '.part1.rar', '.part01.rar', '.tgz', '.tbz2', '.tbz', '.txz', '.tzst', '.zipx', '.docx', '.xlsx', '.epub', '.ipa', '.tar', '.rar', '.zip', '.7z', '.gz', '.bz2', '.xz', '.zst', '.apk', '.jar'] as $suffix) {
            if (strlen($base) > strlen($suffix) && strcasecmp(substr($base, -strlen($suffix)), $suffix) === 0) {
                $base = substr($base, 0, -strlen($suffix));
                $changed = true;
                break;
            }
        }
        if (preg_match('/\.\d{3}$/', $base)) {
            $base = substr($base, 0, -4);
            $changed = true;
        }
        if (preg_match('/\.r\d{2}$/', $base)) {
            $base = substr($base, 0, -4);
            $changed = true;
        }
    }
    return $base;
}

function uuz_find_binary(string $name): ?string
{
    if (strpos($name, '/') !== false) {
        return is_file($name) && is_executable($name) ? $name : null;
    }
    $path = getenv('PATH') ?: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    foreach (explode(':', $path) as $dir) {
        $candidate = rtrim($dir, '/') . '/' . $name;
        if (is_file($candidate) && is_executable($candidate)) {
            return $candidate;
        }
    }
    return null;
}

function uuz_sevenzip(array $cfg): ?string
{
    $override = getenv('UNRAID_UNZIP_7ZZ');
    if ($override !== false && $override !== '') {
        return uuz_find_binary($override);
    }
    $configured = uuz_find_binary((string) $cfg['SEVENZIP_PATH']);
    if ($configured !== null) {
        return $configured;
    }
    foreach (['7zzs', '7zz', '7z', '7za'] as $name) {
        $found = uuz_find_binary($name);
        if ($found !== null) {
            return $found;
        }
    }
    return null;
}

function uuz_unrar(array $cfg): ?string
{
    $configured = trim((string) $cfg['UNRAR_PATH']);
    if ($configured !== '') {
        return uuz_find_binary($configured);
    }
    foreach (['/usr/bin/unrar', '/usr/local/bin/unrar', '/usr/bin/rar', 'unrar', 'rar'] as $candidate) {
        $found = uuz_find_binary($candidate);
        if ($found !== null) {
            return $found;
        }
    }
    return null;
}

function uuz_run(array $argv, ?string $cwd = null, string $stdin = '', int $timeout = 60, bool $stdoutToNull = false): array
{
    $out = $stdoutToNull ? fopen('/dev/null', 'w') : fopen('php://temp', 'w+');
    $err = fopen('php://temp', 'w+');
    if ($out === false || $err === false) {
        return ['rc' => 127, 'stdout' => '', 'stderr' => 'Unable to create output streams'];
    }
    $desc = [0 => ['pipe', 'r'], 1 => $out, 2 => $err];
    $pipes = [];
    $process = @proc_open($argv, $desc, $pipes, $cwd, ['PATH' => getenv('PATH') ?: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL' => 'C']);
    if (!is_resource($process)) {
        fclose($out);
        fclose($err);
        return ['rc' => 127, 'stdout' => '', 'stderr' => 'Unable to start process'];
    }
    if (isset($pipes[0]) && is_resource($pipes[0])) {
        if ($stdin !== '') {
            fwrite($pipes[0], $stdin);
        }
        fclose($pipes[0]);
    }
    $start = microtime(true);
    $status = null;
    while (true) {
        $status = proc_get_status($process);
        if (!$status['running']) {
            break;
        }
        if ($timeout > 0 && (microtime(true) - $start) > $timeout) {
            @proc_terminate($process, 9);
            $status = proc_get_status($process);
            break;
        }
        usleep(10000);
    }
    if (isset($status['exitcode']) && $status['exitcode'] !== -1) {
        $rc = (int) $status['exitcode'];
        @proc_close($process);
    } else {
        $rc = (int) proc_close($process);
    }
    rewind($out);
    rewind($err);
    $stdout = $stdoutToNull ? '' : stream_get_contents($out);
    $stderr = stream_get_contents($err);
    fclose($out);
    fclose($err);
    return ['rc' => $rc, 'stdout' => $stdout === false ? '' : $stdout, 'stderr' => $stderr === false ? '' : $stderr];
}

function uuz_write_atomic(string $file, string $content, int $mode = 0644): bool
{
    $dir = dirname($file);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        return false;
    }
    $tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $content, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, $mode);
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    @chmod($file, $mode);
    return true;
}

function uuz_normalize_list($value, bool $ignoreComments = false, bool $trim = false): ?array
{
    $lines = uuz_array_arg($value);
    $result = [];
    foreach ($lines as $line) {
        if (!is_string($line) || strpos($line, "\0") !== false) {
            return null;
        }
        $line = rtrim($line, "\r");
        if ($trim) {
            $line = trim($line);
        }
        if ($line === '' || ($ignoreComments && str_starts_with(ltrim($line), '#'))) {
            continue;
        }
        $result[] = $line;
    }
    return $result;
}

function uuz_read_list(string $file, bool $ignoreComments = false): array
{
    if (!is_file($file)) {
        return [];
    }
    $lines = @file($file, FILE_IGNORE_NEW_LINES);
    if (!is_array($lines)) {
        return [];
    }
    $result = [];
    foreach ($lines as $line) {
        $line = rtrim($line, "\r");
        if ($line === '' || ($ignoreComments && str_starts_with(ltrim($line), '#'))) {
            continue;
        }
        $result[] = $line;
    }
    return $result;
}

function uuz_save_cfg(array $cfg): bool
{
    $lines = [];
    foreach (uuz_defaults() as $key => $_default) {
        $value = is_array($cfg[$key] ?? null) ? '' : (string) ($cfg[$key] ?? '');
        $lines[] = $key . '="' . str_replace('"', '\\"', $value) . '"';
    }
    return uuz_write_atomic(uuz_config_dir() . '/' . UUZ_PLUGIN . '.cfg', implode("\n", $lines) . "\n", 0644);
}

function uuz_password_file(): string
{
    return uuz_config_dir() . '/passwords.txt';
}

function uuz_exclude_file(): string
{
    return uuz_config_dir() . '/excludes.txt';
}

function uuz_history_file(): string
{
    return uuz_config_dir() . '/history.jsonl';
}

function uuz_password_candidates(array $cfg, string $jobPassword = '', bool $useSaved = true): array
{
    $result = [$jobPassword];
    if ($useSaved) {
        foreach (uuz_read_list(uuz_password_file()) as $candidate) {
            $result[] = $candidate;
        }
    }
    $seen = [];
    $unique = [];
    foreach ($result as $candidate) {
        if (strpos($candidate, "\0") !== false || preg_match('/[\r\n]/', $candidate)) {
            continue;
        }
        if (!array_key_exists($candidate, $seen)) {
            $seen[$candidate] = true;
            $unique[] = $candidate;
        }
    }
    return $unique;
}

function uuz_parse_slt(string $output): array
{
    $parts = preg_split('/^----------\r?$/m', $output);
    $archive = [];
    $entries = [];
    if (!is_array($parts) || !$parts) {
        return ['type' => null, 'entries' => [], 'archive' => []];
    }
    $parseBlock = static function (string $block): array {
        $fields = [];
        foreach (preg_split('/\r?\n/', $block) as $line) {
            $pos = strpos($line, ' = ');
            if ($pos !== false) {
                $fields[substr($line, 0, $pos)] = substr($line, $pos + 3);
            }
        }
        return $fields;
    };
    $archive = $parseBlock(array_shift($parts));
    foreach ($parts as $block) {
        $fields = $parseBlock($block);
        if (!isset($fields['Path']) || $fields['Path'] === '') {
            continue;
        }
        $entryPath = preg_replace('#^\./#', '', $fields['Path']);
        $entries[] = [
            'path' => $entryPath,
            'size' => isset($fields['Size']) && is_numeric($fields['Size']) ? (int) $fields['Size'] : 0,
            'encrypted' => (($fields['Encrypted'] ?? '') === '+'),
            'folder' => (($fields['Folder'] ?? '') === '+'),
            'link' => isset($fields['Symbolic Link']) ? $fields['Symbolic Link'] : '',
            'modified' => $fields['Modified'] ?? '',
            'attributes' => $fields['Attributes'] ?? '',
        ];
    }
    return ['type' => $archive['Type'] ?? null, 'entries' => $entries, 'archive' => $archive];
}

function uuz_suspicious_path(string $path): bool
{
    if ($path === '' || $path[0] === '/' || preg_match('#(^|/)\.\.(/|$)#', $path)) {
        return true;
    }
    return false;
}

function uuz_suspicious_link(string $link, string $entryPath): bool
{
    if ($link === '') {
        return false;
    }
    if ($link[0] === '/') {
        return true;
    }
    $depth = max(0, substr_count(dirname($entryPath), '/'));
    $parts = [];
    foreach (explode('/', dirname($entryPath) . '/' . $link) as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            if (!$parts) {
                return true;
            }
            array_pop($parts);
            continue;
        }
        $parts[] = $part;
    }
    return count($parts) < $depth;
}

function uuz_free_space(string $target): ?int
{
    $probe = is_dir($target) ? $target : uuz_nearest_existing($target);
    if ($probe === null) {
        return null;
    }
    $result = uuz_run(['df', '-Pk', $probe], null, '', 10);
    if ($result['rc'] !== 0) {
        return null;
    }
    $lines = preg_split('/\r?\n/', trim($result['stdout']));
    if (!is_array($lines) || count($lines) < 2) {
        return null;
    }
    $columns = preg_split('/\s+/', trim((string) end($lines)));
    if (!is_array($columns) || count($columns) < 4 || !is_numeric($columns[3])) {
        return null;
    }
    return (int) $columns[3] * 1024;
}

function uuz_list_command(array $cfg, string $archive, string $type, string $password): array
{
    $seven = uuz_sevenzip($cfg);
    if ($seven === null) {
        return ['error' => '7-Zip binary not found'];
    }
    if (uuz_is_tarball($type)) {
        $cmd = escapeshellarg($seven) . ' x -y -so -- ' . escapeshellarg($archive)
            . ' </dev/null | ' . escapeshellarg($seven) . ' l -ttar -si -slt </dev/null';
        return ['argv' => ['/bin/bash', '-o', 'pipefail', '-c', $cmd]];
    }
    return ['argv' => [$seven, 'l', '-slt', '-y', '-p' . $password, '--', $archive]];
}

function uuz_test_zip_password(array $cfg, string $archive, string $member, string $password): bool
{
    $seven = uuz_sevenzip($cfg);
    if ($seven === null) {
        return false;
    }
    $result = uuz_run([$seven, 'x', '-so', '-y', '-p' . $password, '--', $archive, $member], null, '', 60, true);
    return $result['rc'] === 0;
}

function uuz_probe(array $cfg, string $archive, string $password = '', bool $useSaved = true, ?string $target = null): array
{
    $type = uuz_detect_type($archive);
    if ($type === null) {
        return ['error' => ['code' => 'UNSUPPORTED_FORMAT', 'message' => 'Unsupported archive format']];
    }
    $seven = uuz_sevenzip($cfg);
    if ($seven === null) {
        return ['error' => ['code' => 'INTERNAL', 'message' => '7-Zip binary not found']];
    }
    $candidates = uuz_password_candidates($cfg, $password, $useSaved);
    $listing = null;
    $selected = '';
    $lastError = '';
    foreach ($candidates as $candidate) {
        $cmd = uuz_list_command($cfg, $archive, $type, $candidate);
        if (isset($cmd['error'])) {
            return ['error' => ['code' => 'INTERNAL', 'message' => $cmd['error']]];
        }
        $result = uuz_run($cmd['argv'], null, '', 60);
        if ($result['rc'] === 0) {
            $listing = uuz_parse_slt($result['stdout']);
            $selected = $candidate;
            break;
        }
        $lastError = trim($result['stderr'] . "\n" . $result['stdout']);
    }
    if ($listing === null) {
        $code = $password !== '' ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED';
        return ['error' => ['code' => $code, 'message' => $code === 'PASSWORD_REQUIRED' ? 'A password is required' : 'The password was rejected', 'detail' => $lastError]];
    }
    $entries = $listing['entries'];
    $encrypted = false;
    foreach ($entries as $entry) {
        if ($entry['encrypted']) {
            $encrypted = true;
            break;
        }
    }
    if ($encrypted && $type === 'zip') {
        $smallest = null;
        foreach ($entries as $entry) {
            if (!$entry['encrypted'] || $entry['folder']) {
                continue;
            }
            if ($smallest === null || $entry['size'] < $smallest['size']) {
                $smallest = $entry;
            }
        }
        $valid = false;
        if ($smallest !== null) {
            foreach ($candidates as $candidate) {
                if (uuz_test_zip_password($cfg, $archive, $smallest['path'], $candidate)) {
                    $selected = $candidate;
                    $valid = true;
                    break;
                }
            }
        }
        if (!$valid) {
            return ['error' => ['code' => 'PASSWORD_REQUIRED', 'message' => 'A password is required']];
        }
    }
    $total = 0;
    $suspicious = [];
    foreach ($entries as $entry) {
        $total += $entry['size'];
        if (uuz_suspicious_path($entry['path']) || uuz_suspicious_link($entry['link'], $entry['path'])) {
            $suspicious[] = $entry['path'];
        }
    }
    $free = null;
    if ($target !== null) {
        $free = uuz_free_space($target);
    }
    $publicEntries = array_map(static function (array $entry): array {
        return [
            'path' => $entry['path'],
            'size' => $entry['size'],
            'encrypted' => $entry['encrypted'],
            'folder' => $entry['folder'],
            'link' => $entry['link'],
        ];
    }, array_slice($entries, 0, 5000));
    return [
        'archive_type' => $type,
        'listing_type' => $listing['type'],
        'encrypted' => $encrypted,
        'needs_password' => false,
        'entries' => $publicEntries,
        'entries_truncated' => count($entries) > 5000,
        'total_size' => $total,
        'free_space' => $free,
        'suspicious' => array_values(array_unique($suspicious)),
        'password' => $selected,
    ];
}

function uuz_public_probe(array $probe): array
{
    unset($probe['password']);
    return $probe;
}

function uuz_pid_alive(int $pid): bool
{
    if ($pid <= 0) {
        return false;
    }
    if (function_exists('posix_kill')) {
        return @posix_kill($pid, 0);
    }
    return is_dir('/proc/' . $pid);
}

function uuz_kill_group(int $pgid, int $signal): bool
{
    if ($pgid <= 0) {
        return false;
    }
    if (function_exists('posix_kill')) {
        return @posix_kill(-$pgid, $signal);
    }
    $result = uuz_run(['/bin/kill', '-' . $signal, '-' . $pgid], null, '', 5);
    return $result['rc'] === 0;
}

function uuz_safe_job_id(string $id): bool
{
    return (bool) preg_match('/^\d{8}-\d{6}-[a-z0-9]{4,16}$/', $id);
}

function uuz_new_job_id(): string
{
    return gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4));
}

function uuz_job_dir(string $id): ?string
{
    if (!uuz_safe_job_id($id)) {
        return null;
    }
    return uuz_job_root() . '/jobs/' . $id;
}

function uuz_job_status(string $dir): ?array
{
    $file = $dir . '/status.json';
    if (!is_file($file)) {
        return null;
    }
    $data = json_decode((string) @file_get_contents($file), true);
    return is_array($data) ? $data : null;
}

function uuz_write_job_status(string $dir, array $data): bool
{
    return uuz_write_atomic($dir . '/status.json', json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n", 0600);
}

function uuz_job_env_line(string $key, string $value): string
{
    return $key . '=' . escapeshellarg($value) . "\n";
}

function uuz_job_env_array(string $key, array $values): string
{
    $line = $key . "=()\n";
    foreach ($values as $value) {
        $line .= $key . '+=(' . escapeshellarg((string) $value) . ")\n";
    }
    return $line;
}

function uuz_lock_file(string $target): string
{
    $real = realpath($target);
    $key = hash('sha256', $real !== false ? $real : $target);
    return uuz_job_root() . '/locks/' . $key . '.lock';
}

function uuz_lock_acquire(string $target, string $jobId): ?string
{
    $dir = uuz_job_root() . '/locks';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return null;
    }
    $file = uuz_lock_file($target);
    for ($attempt = 0; $attempt < 2; $attempt++) {
        $handle = @fopen($file, 'x');
        if ($handle !== false) {
            fwrite($handle, $jobId . "\n");
            fclose($handle);
            @chmod($file, 0600);
            return $file;
        }
        $owner = trim((string) @file_get_contents($file));
        $ownerDir = $owner !== '' ? uuz_job_dir($owner) : null;
        $ownerStatus = $ownerDir !== null ? uuz_job_status($ownerDir) : null;
        $state = $ownerStatus['state'] ?? '';
        $alive = $ownerStatus !== null && in_array($state, ['queued', 'running'], true)
            && ($state === 'queued' || uuz_pid_alive((int) ($ownerStatus['pid'] ?? 0)));
        if ($alive) {
            return null;
        }
        @unlink($file);
    }
    return null;
}

function uuz_lock_release(?string $file): void
{
    if ($file !== null && is_file($file)) {
        @unlink($file);
    }
}

function uuz_active_job_count(): int
{
    $root = uuz_job_root() . '/jobs';
    if (!is_dir($root)) {
        return 0;
    }
    $count = 0;
    foreach (glob($root . '/*/status.json') ?: [] as $file) {
        $data = json_decode((string) @file_get_contents($file), true);
        if (!is_array($data) || !in_array($data['state'] ?? '', ['queued', 'running'], true)) {
            continue;
        }
        $pid = (int) ($data['pid'] ?? 0);
        if ($pid === 0) {
            $count++;
            continue;
        }
        if (uuz_pid_alive($pid)) {
            $count++;
        } else {
            $data['state'] = 'error';
            $data['message'] = 'Process disappeared';
            $data['finished'] = gmdate('c');
            @uuz_write_job_status(dirname($file), $data);
        }
    }
    return $count;
}

function uuz_cleanup_jobs(array $cfg): void
{
    $root = uuz_job_root() . '/jobs';
    if (!is_dir($root)) {
        return;
    }
    $retention = (int) $cfg['LOG_RETENTION_MIN'] * 60;
    if ($retention <= 0) {
        return;
    }
    $cutoff = time() - $retention;
    foreach (glob($root . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
        $status = uuz_job_status($dir);
        if ($status !== null && in_array($status['state'] ?? '', ['queued', 'running'], true)) {
            continue;
        }
        if (@filemtime($dir) < $cutoff) {
            uuz_remove_tree($dir);
        }
    }
}

function uuz_remove_tree(string $dir): void
{
    if (!is_dir($dir) || is_link($dir)) {
        @unlink($dir);
        return;
    }
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isDir() && !$item->isLink()) {
            @rmdir($item->getPathname());
        } else {
            @unlink($item->getPathname());
        }
    }
    @rmdir($dir);
}

function uuz_spawn(string $jobDir): ?int
{
    $runner = uuz_plugin_dir() . '/scripts/job-runner.sh';
    if (!is_file($runner)) {
        return null;
    }
    $setsid = uuz_find_binary('setsid');
    $prefix = $setsid !== null ? escapeshellarg($setsid) . ' nohup ' : 'nohup ';
    $cmd = $prefix . escapeshellarg($runner) . ' ' . escapeshellarg($jobDir)
        . ' </dev/null >/dev/null 2>&1 & echo $!';
    $out = [];
    $rc = 0;
    @exec($cmd, $out, $rc);
    if ($rc !== 0 || !isset($out[0]) || !ctype_digit((string) $out[0])) {
        return null;
    }
    return (int) $out[0];
}

function uuz_make_job(array $cfg, string $kind, array $status, string $env, string $target, ?string $id = null): ?string
{
    if (uuz_active_job_count() >= (int) $cfg['MAX_JOBS']) {
        return null;
    }
    $id = $id ?? uuz_new_job_id();
    if (!uuz_safe_job_id($id)) {
        return null;
    }
    $dir = uuz_job_dir($id);
    if ($dir === null) {
        return null;
    }
    if (!@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return null;
    }
    $lock = uuz_lock_acquire($target, $id);
    if ($lock === null) {
        uuz_remove_tree($dir);
        return null;
    }
    $status = array_merge([
        'id' => $id,
        'kind' => $kind,
        'state' => 'queued',
        'phase' => 'queued',
        'percent' => null,
        'exit_code' => null,
        'started' => gmdate('c'),
        'finished' => null,
        'pid' => 0,
        'pgid' => 0,
        'target' => $target,
        'archive' => '',
        'message' => '',
        'warnings' => [],
    ], $status);
    if (!uuz_write_job_status($dir, $status) || !uuz_write_atomic($dir . '/job.env', $env, 0600)) {
        uuz_lock_release($lock);
        uuz_remove_tree($dir);
        return null;
    }
    $pid = uuz_spawn($dir);
    if ($pid === null) {
        uuz_lock_release($lock);
        uuz_remove_tree($dir);
        return null;
    }
    $current = uuz_job_status($dir);
    if ($current !== null && ($current['state'] ?? '') === 'queued') {
        $current['pid'] = $pid;
        $current['pgid'] = $pid;
        uuz_write_job_status($dir, $current);
    }
    return $id;
}

function uuz_append_history(string $statusFile, string $historyFile, int $limit): bool
{
    $status = json_decode((string) @file_get_contents($statusFile), true);
    if (!is_array($status)) {
        return false;
    }
    $summary = [
        'id' => $status['id'] ?? '',
        'kind' => $status['kind'] ?? '',
        'state' => $status['state'] ?? '',
        'phase' => $status['phase'] ?? '',
        'started' => $status['started'] ?? '',
        'finished' => $status['finished'] ?? '',
        'archive' => $status['archive'] ?? '',
        'target' => $status['target'] ?? '',
        'exit_code' => $status['exit_code'] ?? null,
        'message' => $status['message'] ?? '',
    ];
    $line = json_encode($summary, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
    $dir = dirname($historyFile);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        return false;
    }
    $lock = @fopen($historyFile . '.lock', 'c');
    if ($lock === false) {
        return false;
    }
    @flock($lock, LOCK_EX);
    $current = is_file($historyFile) ? @file($historyFile, FILE_IGNORE_NEW_LINES) : [];
    $current = is_array($current) ? $current : [];
    $current[] = rtrim($line, "\n");
    if ($limit > 0 && count($current) > $limit) {
        $current = array_slice($current, -$limit);
    }
    $ok = uuz_write_atomic($historyFile, implode("\n", $current) . "\n", 0600);
    @flock($lock, LOCK_UN);
    fclose($lock);
    @unlink($historyFile . '.lock');
    return $ok;
}

function uuz_read_history(int $limit): array
{
    $file = uuz_history_file();
    if (!is_file($file)) {
        return [];
    }
    $lines = @file($file, FILE_IGNORE_NEW_LINES);
    if (!is_array($lines)) {
        return [];
    }
    $items = [];
    foreach (array_slice($lines, -$limit) as $line) {
        $data = json_decode($line, true);
        if (is_array($data)) {
            $items[] = $data;
        }
    }
    return array_reverse($items);
}

function uuz_clear_history(): bool
{
    return uuz_write_atomic(uuz_history_file(), '', 0600);
}

function uuz_progress_from_log(string $log, ?int $fallback = null): ?int
{
    $clean = str_replace(["\r", "\b"], ["\n", ''], $log);
    if (preg_match_all('/(\d{1,3})%/', $clean, $matches)) {
        $value = (int) end($matches[1]);
        return max(0, min(100, $value));
    }
    return $fallback;
}

function uuz_log_tail(string $file, int $lines = 100): string
{
    if (!is_file($file)) {
        return '';
    }
    $data = @file($file, FILE_IGNORE_NEW_LINES);
    if (!is_array($data)) {
        return '';
    }
    return implode("\n", array_slice($data, -$lines));
}

function uuz_notify(array $cfg, string $title, string $message): void
{
    if (($cfg['NOTIFY_ON_COMPLETE'] ?? 'yes') !== 'yes') {
        return;
    }
    $notify = '/usr/local/emhttp/webGui/scripts/notify';
    if (is_executable($notify)) {
        uuz_run([$notify, '-e', 'unraid-unzip', '-s', $title, '-d', $message], null, '', 10);
    }
}

function uuz_diagnostics(array $cfg): array
{
    $seven = uuz_sevenzip($cfg);
    $version = '';
    if ($seven !== null) {
        $result = uuz_run([$seven, 'i'], null, '', 10);
        $first = preg_split('/\r?\n/', $result['stdout']);
        $version = is_array($first) ? trim((string) ($first[0] ?? '')) : '';
    }
    $configDir = uuz_config_dir();
    return [
        'sevenzip_path' => $seven,
        'sevenzip_version' => $version,
        'unrar_path' => uuz_unrar($cfg),
        'config_dir' => $configDir,
        'config_writable' => is_dir($configDir) ? is_writable($configDir) : is_writable(dirname($configDir)),
        'job_root' => uuz_job_root(),
        'active_jobs' => uuz_active_job_count(),
        'password_count' => count(uuz_read_list(uuz_password_file())),
        'exclude_count' => count(uuz_read_list(uuz_exclude_file(), true)),
    ];
}
