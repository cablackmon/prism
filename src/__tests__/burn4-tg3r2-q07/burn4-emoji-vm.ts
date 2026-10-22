import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

// The only disk read is the unchanged CLI source. All CLI filesystem calls use memory.
const source = readFileSync(resolve(__dirname, '../../../scripts/copy-emoji-assets.mjs'), 'utf8');
const defaultModuleUrl = 'file:///sandbox/prism/scripts/copy-emoji-assets.mjs';

type Entry = { kind: 'directory' } | { kind: 'file'; contents: string };
type Stage = 'read' | 'mkdir' | 'copy';

export class MemoryEmojiFiles {
  readonly entries = new Map<string, Entry>();
  readonly faults: Partial<Record<Stage, Error>> = {};
  readonly src: string;
  readonly dest: string;
  failAfterFiles: number | undefined;
  readonly interruptedCopy = new Error('simulated interrupted copy');

  constructor(readonly root = '/sandbox/prism') {
    this.src = posix.join(root, 'node_modules/@discordapp/twemoji/dist/svg');
    this.dest = posix.join(root, 'public/twemoji');
  }

  seedDirectory(location: string): void {
    let current = location;
    while (!this.entries.has(current)) {
      this.entries.set(current, { kind: 'directory' });
      const parent = posix.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  seedFile(location: string, contents: string): void {
    this.seedDirectory(posix.dirname(location));
    this.entries.set(location, { kind: 'file', contents });
  }

  contents(location: string): string | undefined {
    const entry = this.entries.get(location);
    return entry?.kind === 'file' ? entry.contents : undefined;
  }

  readonly existsSync = jest.fn((location: string): boolean => this.entries.has(location));

  readonly readdirSync = jest.fn((location: string): string[] => {
    if (this.faults.read) throw this.faults.read;
    if (this.entries.get(location)?.kind !== 'directory') throw new Error('not a directory');
    return [...this.entries.keys()]
      .filter((entry) => entry !== location && posix.dirname(entry) === location)
      .map((entry) => posix.basename(entry));
  });

  readonly mkdirSync = jest.fn((location: string, options: { recursive: boolean }): void => {
    if (this.faults.mkdir) throw this.faults.mkdir;
    if (!options.recursive) throw new Error('expected recursive mkdir');
    if (this.entries.get(location)?.kind === 'file') throw new Error('destination is a file');
    this.seedDirectory(location);
  });

  readonly cpSync = jest.fn((from: string, to: string, options: { recursive: boolean }): void => {
    if (this.faults.copy) throw this.faults.copy;
    if (!options.recursive) throw new Error('expected recursive copy');
    if (this.entries.get(from)?.kind !== 'directory') throw new Error('source is not a directory');
    let copied = 0;
    for (const [location, entry] of [...this.entries]) {
      if (!location.startsWith(`${from}/`)) continue;
      const target = posix.join(to, posix.relative(from, location));
      if (entry.kind === 'directory') {
        this.seedDirectory(target);
      } else {
        if (this.failAfterFiles !== undefined && copied >= this.failAfterFiles) {
          throw this.interruptedCopy;
        }
        this.seedFile(target, entry.contents);
        copied += 1;
      }
    }
  });
}

class ExitSignal {
  constructor(readonly code: number) {}
}

export async function runEmojiCli(files: MemoryEmojiFiles, moduleUrl = defaultModuleUrl) {
  const logs: string[] = [];
  const warnings: string[] = [];
  const exits: number[] = [];
  const urlReads: string[] = [];
  const context = createContext({
    console: {
      log: (message: string) => logs.push(message),
      warn: (message: string) => warnings.push(message),
    },
    process: Object.freeze({
      exit: (code: number): never => {
        exits.push(code);
        throw new ExitSignal(code);
      },
    }),
  });
  const imports: Record<string, Record<string, unknown>> = {
    'node:fs': {
      cpSync: files.cpSync,
      existsSync: files.existsSync,
      mkdirSync: files.mkdirSync,
      readdirSync: files.readdirSync,
    },
    'node:path': { default: posix },
    'node:url': {
      fileURLToPath: (url: string) => {
        urlReads.push(url);
        return fileURLToPath(url);
      },
    },
  };
  let error: unknown;
  let exitCode: number | undefined;
  try {
    const cliModule = new SourceTextModule(source, {
      context,
      identifier: moduleUrl,
      initializeImportMeta: (meta) => { meta.url = moduleUrl; },
    });
    await cliModule.link((specifier) => {
      const values = imports[specifier];
      if (!values) throw new Error(`Unexpected CLI import: ${specifier}`);
      return new SyntheticModule(Object.keys(values), function () {
        for (const [name, value] of Object.entries(values)) this.setExport(name, value);
      }, { context });
    });
    await cliModule.evaluate();
  } catch (caught) {
    if (caught instanceof ExitSignal) exitCode = caught.code;
    else error = caught;
  }
  return { logs, warnings, exits, urlReads, error, exitCode };
}

export function seedSvgSet(files: MemoryEmojiFiles, count: number): string[] {
  files.seedDirectory(files.src);
  return Array.from({ length: count }, (_, index) => {
    const filename = `${(0x1f300 + index).toString(16)}.svg`;
    files.seedFile(posix.join(files.src, filename), `<svg data-fixture="${index}"/>`);
    return filename;
  });
}
