import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type SafeOptions = {
  log_level?: string | null;
  bundled_db?: boolean | null;
  photos_root?: string | null;
  anonymous_stats?: boolean | string | null;
};

export type RuntimeConfig = {
  options?: SafeOptions;
  optionsPresent?: boolean;
  jqFailure?: keyof SafeOptions;
  mkdirFailure?: boolean;
  probe?: 'present' | 'absent' | 'empty' | 'error' | 'partialError';
  schemaFailure?: boolean;
  migrationFailure?: boolean;
  cdFailure?: boolean;
  serverFailure?: boolean;
};

export type Slice = 'options' | 'schema';
export type RuntimeResult = { status: number; events: string[]; stderr: string };

const sourcePath = resolve(__dirname, '../../..', 'ha-app/run.sh');
const source = readFileSync(sourcePath, 'utf8');

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to <= from || source.indexOf(start, from + 1) !== -1) {
    throw new Error('Safe source extraction anchors changed');
  }
  return source.slice(from, to).trimEnd();
}

export const slices: Readonly<Record<Slice, string>> = {
  options: [
    between('[ -f "$OPTIONS" ] || die ', '\n\n# bashio'),
    between('opt() { jq ', '\nEXTERNAL_DB_URL='),
    between('PHOTOS_ROOT="$(opt ', '\n\nlog "log_level='),
    between('# Anonymous update check is opt-out;', '\n\n# '),
  ].join('\n\n'),
  schema: between('SCHEMA_PRESENT="$(psql ', '\nexec node /app/server.js') + '\nexec node /app/server.js',
};

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function assertSafe(text: string): void {
  // Never pass excluded source sections to the shell, even if fakes exist.
  const forbidden = /(?:openssl|initdb|PG_PASSWORD|SECRETS|SESSION_SECRET|PIN_ENCRYPTION_KEY|ENCRYPTION_KEY|EXTERNAL_DB_URL|EXTERNAL_REDIS_URL|database_url|redis_url|CREATE ROLE|export DATABASE_URL|export REDIS_URL|log "log_level=)/;
  if (forbidden.test(text)) throw new Error('Forbidden section in safe runtime slice');
}

const ordinaryDefaults: SafeOptions = {
  log_level: 'info',
  bundled_db: true,
  photos_root: '/burn4-photos',
  anonymous_stats: true,
};

export function runSlice(slice: Slice, config: RuntimeConfig = {}): RuntimeResult {
  const selected = slices[slice];
  assertSafe(selected);
  const options = config.options ?? ordinaryDefaults;
  const json = shellLiteral(JSON.stringify(options));
  const failingQuery = shellLiteral(config.jqFailure ? `.${config.jqFailure} // empty` : '');
  const bool = (value: boolean | undefined): string => value ? 'true' : 'false';
  const bootstrap = `
set -euo pipefail
PATH=/__burn4_no_external_commands__
OPTIONS=/__burn4_no_options_file__
DATABASE_URL=''
event() { builtin printf '%s\\n' "$1" >&3; }
command_not_found_handle() { event blocked-command; return 125; }
log() { event log; }
die() { event fatal; exit 1; }
function [ {
  if builtin [ "$#" -eq 3 ] && builtin [ "$1" = -f ]; then
    builtin [ "$2" = "$OPTIONS" ] && builtin [ "$3" = ']' ] || { event blocked-file-probe; return 125; }
    ${bool(config.optionsPresent !== false)}
    return
  fi
  builtin [ "$@"
}
jq() {
  builtin [ "$#" -eq 3 ] && builtin [ "$1" = -r ] && builtin [ "$3" = "$OPTIONS" ] || { event blocked-jq; return 125; }
  case "$2" in
    '.log_level // empty'|'.bundled_db // empty'|'.photos_root // empty'|'.anonymous_stats // empty') ;;
    *) event blocked-jq; return 125 ;;
  esac
  if builtin [ "$2" = ${failingQuery} ]; then return 17; fi
  /usr/bin/jq -r "$2" <<< ${json}
}
mkdir() {
  builtin [ "$#" -eq 2 ] && builtin [ "$1" = -p ] || { event blocked-mkdir; return 125; }
  case "$2" in
    '') event mkdir-empty; return 1 ;;
    /data/photos) event mkdir-default-photos ;;
    /burn4-photos|'/burn4 photos'|'/burn4-photos; no-command') event mkdir-photos ;;
    *) event blocked-mkdir; return 125 ;;
  esac
  if ${bool(config.mkdirFailure)}; then return 19; fi
}
psql() {
  builtin [ "$1" = '' ] || { event blocked-connection; return 125; }
  if builtin [ "$#" -eq 3 ] && builtin [ "$2" = -tAc ] && builtin [ "$3" = "SELECT to_regclass('public.__prism_migrations') IS NOT NULL" ]; then
    builtin printf 'probe\\n' >&3
    case ${shellLiteral(config.probe ?? 'present')} in
      present) builtin printf 't\\n' ;;
      absent) builtin printf 'f\\n' ;;
      empty) return 0 ;;
      error) return 29 ;;
      partialError) builtin printf 't\\n'; return 29 ;;
    esac
  elif builtin [ "$#" -eq 5 ] && builtin [ "$2" = -v ] && builtin [ "$3" = ON_ERROR_STOP=1 ] && builtin [ "$4" = -f ] && builtin [ "$5" = /app/db-init/02-schema.sql ]; then
    event apply-schema
    if ${bool(config.schemaFailure)}; then return 31; fi
  else event blocked-psql; return 125
  fi
}
cd() {
  builtin [ "$#" -eq 1 ] && builtin [ "$1" = /app ] || { event blocked-cd; return 125; }
  event app-directory
  if ${bool(config.cdFailure)}; then return 33; fi
}
node() {
  builtin [ "$#" -eq 1 ] || { event blocked-node; return 125; }
  case "$1" in
    scripts/migrate.js) event migrate; if ${bool(config.migrationFailure)}; then return 35; fi ;;
    /app/server.js) event server; if ${bool(config.serverFailure)}; then return 37; fi ;;
    *) event blocked-node; return 125 ;;
  esac
}
function exec {
  builtin [ "$#" -eq 2 ] && builtin [ "$1" = node ] && builtin [ "$2" = /app/server.js ] || { event blocked-exec; return 125; }
  event replace-shell
  if builtin [ "$PORT" = 3000 ] && builtin [ "$HOSTNAME" = 0.0.0.0 ]; then event listener-configured; fi
  node "$2"
  exit
}
`;
  const observations = slice === 'options' ? `
if builtin [ "\${PRISM_PHOTO_ROOT-unset}" = "$PHOTOS_ROOT" ]; then event photo-root-published; fi
if builtin [ "\${PRISM_DISABLE_TELEMETRY-unset}" = true ]; then event telemetry-disabled; else event telemetry-not-disabled; fi
if builtin [ "$BUNDLED_DB" = true ]; then event bundled-selected; else event external-selected; fi
if builtin [ "$LOG_LEVEL" = info ]; then event log-default; elif builtin [ -z "$LOG_LEVEL" ]; then event log-empty; else event log-configured; fi
if builtin [ "$ANON_STATS" = false ]; then event stats-false; elif builtin [ -z "$ANON_STATS" ]; then event stats-empty; else event stats-enabled; fi
` : '';
  const child = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', bootstrap + '\n' + selected + '\n' + observations + '\nevent completed\n'], {
    env: {},
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  if (child.error || child.signal || child.status === null) throw new Error('Safe runtime child did not complete');
  if (child.stdout !== '') throw new Error('Unexpected output from safe runtime slice');
  const eventStream = String(child.output[3] ?? '');
  const events = eventStream.split('\n').map(value => value.trim()).filter(Boolean);
  return { status: child.status, events, stderr: child.stderr };
}
