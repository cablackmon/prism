import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Options = {
  missingEncoder?: boolean;
  healthStatus?: number;
  healthThrows?: boolean;
  databaseStatus?: number;
  redisStatus?: number;
  recorderStatus?: number;
  encoderStatus?: number;
  encoderCreates?: boolean;
  resetThrows?: boolean;
  recorderThrows?: boolean;
  inspectLocation?: boolean;
  videos?: string[];
  staleGifs?: Record<string, number>;
  gifBytes?: number;
};
export type Invocation = { stage: string; args: string[]; cwd: string; status: number };
export type Run = { status: number | null; stdout: string; stderr: string; invocations: Invocation[]; events: string[] };
const repository = resolve(__dirname, '../../..');
const sq = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
const pq = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const filter = 'fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3';
export { filter as encoderFilter };

function runtime(): string {
  const candidates = [join(repository, 'node_modules/.bin/pwsh'), '/usr/bin/pwsh', '/usr/local/bin/pwsh'];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('PowerShell 7 is required for the explicit recorder checks. Link a local runtime at node_modules/.bin/pwsh.');
  return realpathSync(found);
}

export class RecorderFixture {
  readonly root: string;
  readonly project: string;
  readonly temp: string;
  readonly working: string;
  private readonly bin: string;
  private readonly options: Options;

  constructor(options: Options = {}) {
    this.options = options;
    const scratch = join(__dirname, 'burn4-fixtures');
    mkdirSync(scratch, { recursive: true });
    this.root = mkdtempSync(join(scratch, 'burn4 recorder '));
    this.project = join(this.root, 'project');
    this.temp = join(this.root, 'temp');
    this.working = join(this.root, 'caller');
    this.bin = join(this.root, 'bin');
    for (const path of [this.project, this.temp, this.working, this.bin, join(this.project, 'scripts'), join(this.root, 'calls')]) mkdirSync(path, { recursive: true });
    writeFileSync(join(this.project, 'scripts/record-demos.ps1'), readFileSync(join(repository, 'scripts/record-demos.ps1')));
    for (const video of options.videos ?? ['nested/01-dashboard/video.webm']) {
      if (video.startsWith('/') || video.split('/').includes('..')) throw new Error('video path must stay in fixture');
      mkdirSync(dirname(join(this.project, 'test-results', video)), { recursive: true });
    }
    for (const [name, size] of Object.entries(options.staleGifs ?? {})) {
      if (!/^[a-z0-9-]+\.gif$/.test(name)) throw new Error('invalid synthetic GIF path');
      const target = join(this.project, 'docs/demos', name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.alloc(size, 65));
    }
    for (const command of ['docker', 'npx', 'ffmpeg']) {
      if (command === 'ffmpeg' && options.missingEncoder) continue;
      const target = join(this.bin, command);
      writeFileSync(target, this.native(command));
      chmodSync(target, 0o700);
    }
  }

  private native(command: string): string {
    const prefix = `#!/bin/sh\nset -eu\nroot=${sq(this.root)}\nproject=${sq(this.project)}\n`;
    const record = `count=0
if [ -f "$root/count.${command}" ]; then IFS= read -r count < "$root/count.${command}"; fi
count=$((count + 1))
printf '%s\\n' "$count" > "$root/count.${command}"
printf '%s\\n' "$stage" >> "$root/events"
printf '%s\\n' "$stage" > "$root/calls/${command}.$count.stage"
printf '%s\\n' "$@" > "$root/calls/${command}.$count.args"
pwd > "$root/calls/${command}.$count.cwd"
`;
    if (command === 'docker') return prefix + `if [ "$#" -eq 8 ] && [ "$1" = exec ] && [ "$2" = -i ] && [ "$3" = prism-db ] && [ "$4" = psql ] && [ "$5" = -U ] && [ "$6" = prism ] && [ "$7" = -d ] && [ "$8" = prism ]; then
  stage=database
elif [ "$#" -eq 4 ] && [ "$1" = exec ] && [ "$2" = prism-redis ] && [ "$3" = redis-cli ] && [ "$4" = FLUSHDB ]; then
  stage=redis
else
  printf '%s\\n' 'unexpected docker arguments' >&2; exit 96
fi
${record}
if [ "$stage" = database ]; then
  while IFS= read -r line; do printf '%s\\n' "$line" >> "$root/sql-input"; done
  printf '%s\\n' ${this.options.databaseStatus ?? 0} > "$root/calls/${command}.$count.status"
  exit ${this.options.databaseStatus ?? 0}
fi
printf '%s\\n' ${this.options.redisStatus ?? 0} > "$root/calls/${command}.$count.status"
exit ${this.options.redisStatus ?? 0}
`;
    if (command === 'npx') return prefix + `if [ "$#" -ne 4 ] || [ "$1" != playwright ] || [ "$2" != test ] || [ "$3" != --config ] || [ "$4" != e2e/demos/demo.config.ts ]; then
  printf '%s\\n' 'unexpected recorder arguments' >&2; exit 96
fi
stage=record
${record}
${(this.options.videos ?? ['nested/01-dashboard/video.webm']).map((video) => `printf '%s' 'synthetic video bytes' > ${sq(join(this.project, 'test-results', video))}`).join('\n')}
printf '%s\\n' ${this.options.recorderStatus ?? 0} > "$root/calls/${command}.$count.status"
exit ${this.options.recorderStatus ?? 0}
`;
    const create = this.options.encoderCreates ?? (this.options.encoderStatus ?? 0) === 0;
    return prefix + `if [ "$#" -ne 10 ] || [ "$1" != -y ] || [ "$2" != -ss ] || [ "$3" != 1.5 ] || [ "$4" != -i ] || [ "$6" != -vf ] || [ "$7" != ${sq(filter)} ] || [ "$8" != -loop ] || [ "$9" != 0 ]; then
  printf '%s\\n' 'unexpected encoder arguments' >&2; exit 96
fi
case "$5" in "$project"/test-results/*.webm) ;; *) exit 96 ;; esac
original_input=$5
shift 9
output=$1
case "$output" in "$project"/docs/demos/*.gif) ;; *) exit 96 ;; esac
stage=encode
set -- -y -ss 1.5 -i "$original_input" -vf ${sq(filter)} -loop 0 "$output"
${record}
${create ? `printf '%s' ${sq('G'.repeat(this.options.gifBytes ?? 64))} > "$output"` : ':'}
printf '%s\\n' ${this.options.encoderStatus ?? 0} > "$root/calls/${command}.$count.status"
exit ${this.options.encoderStatus ?? 0}
`;
  }

  private wrapper(): string {
    return `$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Management
Import-Module Microsoft.PowerShell.Utility
$PSModuleAutoLoadingPreference = 'None'
$PSNativeCommandUseErrorActionPreference = $false
function global:Invoke-WebRequest {
  param([string]$Uri, [switch]$UseBasicParsing, [int]$TimeoutSec)
  if ($Uri -ne 'http://localhost:3000' -or -not $UseBasicParsing -or $TimeoutSec -ne 5) { throw 'unexpected HTTP arguments' }
  [System.IO.File]::AppendAllText(${pq(join(this.root, 'events'))}, "health\n")
  ${this.options.healthThrows ? "throw 'synthetic unreachable app'" : `[pscustomobject]@{ StatusCode = ${this.options.healthStatus ?? 200} }`}
}
${this.options.resetThrows ? `function global:docker { throw 'synthetic reset exception' }` : ''}
${this.options.recorderThrows ? `function global:npx { throw 'synthetic recorder exception' }` : ''}
${this.options.inspectLocation ? `try { & ${pq(join(this.project, 'scripts/record-demos.ps1'))} } finally { [System.IO.File]::WriteAllText(${pq(join(this.root, 'final-location'))}, (Get-Location).Path) }` : `& ${pq(join(this.project, 'scripts/record-demos.ps1'))}`}
`;
  }

  run(): Run {
    const pwsh = runtime();
    const result = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', this.wrapper()], {
      cwd: this.working,
      env: {
        PATH: this.bin,
        PSModulePath: join(dirname(pwsh), 'Modules'),
        TEMP: this.temp,
        TMPDIR: this.temp,
        XDG_CACHE_HOME: join(this.root, 'cache'),
        XDG_CONFIG_HOME: join(this.root, 'config'),
        XDG_DATA_HOME: join(this.root, 'data'),
        POWERSHELL_TELEMETRY_OPTOUT: '1',
        POWERSHELL_UPDATECHECK: 'Off',
        TERM: 'dumb',
      },
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 256 * 1024,
    });
    if (result.error) throw result.error;
    const calls = join(this.root, 'calls');
    const invocations = readdirSync(calls).filter((name) => name.endsWith('.stage')).map((name) => {
      const stem = join(calls, name.slice(0, -6));
      return { stage: readFileSync(`${stem}.stage`, 'utf8').trim(), args: readFileSync(`${stem}.args`, 'utf8').trimEnd().split('\n'), cwd: readFileSync(`${stem}.cwd`, 'utf8').trim(), status: Number(readFileSync(`${stem}.status`, 'utf8').trim()) };
    });
    const eventFile = join(this.root, 'events');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, invocations, events: existsSync(eventFile) ? readFileSync(eventFile, 'utf8').trim().split('\n') : [] };
  }

  gif(name: string): Buffer | undefined {
    const target = join(this.project, 'docs/demos', name);
    return existsSync(target) ? readFileSync(target) : undefined;
  }

  sql(): string | undefined {
    const target = join(this.root, 'sql-input');
    return existsSync(target) ? readFileSync(target, 'utf8').replace(/^\uFEFF/, '') : undefined;
  }

  resetFileExists(): boolean { return existsSync(join(this.temp, 'prism-demo-reset.sql')); }
  directoriesCreated(): boolean { return existsSync(join(this.project, 'docs/demos')) && existsSync(join(this.project, 'e2e/demos/videos')); }
  finalLocation(): string { return readFileSync(join(this.root, 'final-location'), 'utf8'); }
  dispose(): void { rmSync(this.root, { recursive: true, force: true }); }
}
