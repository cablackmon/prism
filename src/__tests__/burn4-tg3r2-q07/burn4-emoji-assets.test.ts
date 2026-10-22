import { posix } from 'node:path';
import { MemoryEmojiFiles, runEmojiCli, seedSvgSet } from './burn4-emoji-vm';

describe('offline emoji asset preparation CLI', () => {
  test('missing dependency exits successfully before inspecting or changing an existing destination', async () => {
    const files = new MemoryEmojiFiles();
    files.seedFile(posix.join(files.dest, 'retained.svg'), '<svg/>');
    const before = [...files.entries];

    const result = await runEmojiCli(files);

    expect(result.error).toBeUndefined();
    expect(result.exits).toEqual([0]);
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toEqual([expect.stringContaining('twemoji SVG assets not found')]);
    expect(result.logs).toEqual([]);
    expect(files.existsSync.mock.calls).toEqual([[files.src]]);
    expect(files.readdirSync).not.toHaveBeenCalled();
    expect(files.mkdirSync).not.toHaveBeenCalled();
    expect(files.cpSync).not.toHaveBeenCalled();
    expect([...files.entries]).toEqual(before);
  });

  test('creates the missing public directory and recursively copies the set', async () => {
    const files = new MemoryEmojiFiles();
    seedSvgSet(files, 2);
    files.seedFile(posix.join(files.src, 'nested', 'variant.svg'), '<svg data-variant="nested"/>');

    const result = await runEmojiCli(files);

    expect(result.error).toBeUndefined();
    expect(result.exits).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(files.readdirSync).not.toHaveBeenCalled();
    expect(files.mkdirSync).toHaveBeenCalledWith(files.dest, { recursive: true });
    expect(files.cpSync).toHaveBeenCalledWith(files.src, files.dest, { recursive: true });
    expect(files.contents(posix.join(files.dest, '1f300.svg'))).toBe('<svg data-fixture="0"/>');
    expect(files.contents(posix.join(files.dest, '1f301.svg'))).toBe('<svg data-fixture="1"/>');
    expect(files.contents(posix.join(files.dest, 'nested', 'variant.svg'))).toBe('<svg data-variant="nested"/>');
    expect(result.logs).toEqual([expect.stringContaining('public/twemoji')]);
  });

  test.each([0, 1000])('repairs a partial destination containing exactly %i entries', async (count) => {
    const files = new MemoryEmojiFiles();
    const names = seedSvgSet(files, 1002);
    files.seedDirectory(files.dest);
    for (const name of names.slice(0, count)) {
      files.seedFile(posix.join(files.dest, name), '<svg data-fixture="old"/>');
    }

    const result = await runEmojiCli(files);

    expect(result.error).toBeUndefined();
    expect(result.exits).toEqual([]);
    expect(files.readdirSync).toHaveBeenCalledWith(files.dest);
    expect(files.cpSync).toHaveBeenCalledTimes(1);
    for (const name of names) {
      expect(files.contents(posix.join(files.dest, name))).toBe(files.contents(posix.join(files.src, name)));
    }
  });

  test('merges a small partial destination without removing unrelated public files', async () => {
    const files = new MemoryEmojiFiles();
    seedSvgSet(files, 1);
    files.seedFile(posix.join(files.dest, 'notes.txt'), 'fixture notes');
    files.seedFile(posix.join(files.dest, '1f300.svg'), '<svg data-fixture="old"/>');

    const result = await runEmojiCli(files);

    expect(result.error).toBeUndefined();
    expect(files.contents(posix.join(files.dest, 'notes.txt'))).toBe('fixture notes');
    expect(files.contents(posix.join(files.dest, '1f300.svg'))).toBe('<svg data-fixture="0"/>');
    expect(result.logs).toHaveLength(1);
  });

  test('a completed 1001-file copy makes the next invocation a no-op', async () => {
    const files = new MemoryEmojiFiles();
    seedSvgSet(files, 1001);
    const first = await runEmojiCli(files);
    const complete = [...files.entries];
    const second = await runEmojiCli(files);

    expect(first.error).toBeUndefined();
    expect(first.logs).toHaveLength(1);
    expect(second.error).toBeUndefined();
    expect(second.exits).toEqual([0]);
    expect(second.logs).toEqual([]);
    expect(second.warnings).toEqual([]);
    expect(files.cpSync).toHaveBeenCalledTimes(1);
    expect(files.mkdirSync).toHaveBeenCalledTimes(1);
    expect([...files.entries]).toEqual(complete);
  });

  test('resolves an encoded module location independently of the host working directory', async () => {
    const files = new MemoryEmojiFiles('/virtual/build output/prism ✨');
    seedSvgSet(files, 1);
    const moduleUrl = 'file:///virtual/build%20output/prism%20%E2%9C%A8/scripts/copy-emoji-assets.mjs';

    const result = await runEmojiCli(files, moduleUrl);

    expect(result.error).toBeUndefined();
    expect(result.urlReads).toEqual([moduleUrl]);
    expect(files.existsSync.mock.calls).toEqual([[files.src], [files.dest]]);
    expect(files.cpSync).toHaveBeenCalledWith(
      '/virtual/build output/prism ✨/node_modules/@discordapp/twemoji/dist/svg',
      '/virtual/build output/prism ✨/public/twemoji',
      { recursive: true },
    );
    expect(result.logs).toEqual([expect.stringContaining('public/twemoji')]);
  });

  test.each(['read', 'mkdir', 'copy'] as const)('%s failure escapes without logging a successful copy', async (stage) => {
    const files = new MemoryEmojiFiles();
    seedSvgSet(files, 1);
    files.seedDirectory(files.dest);
    const error = new Error(`simulated ${stage} failure`);
    files.faults[stage] = error;

    const result = await runEmojiCli(files);

    expect(result.error).toBe(error);
    expect(result.exits).toEqual([]);
    expect(result.logs).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(files.contents(posix.join(files.dest, '1f300.svg'))).toBeUndefined();
    expect(files.cpSync).toHaveBeenCalledTimes(stage === 'copy' ? 1 : 0);
  });

  test('a failed small copy leaves visible partial output and a rerun restores missing assets', async () => {
    const files = new MemoryEmojiFiles();
    seedSvgSet(files, 3);
    files.failAfterFiles = 1;

    const interrupted = await runEmojiCli(files);

    expect(interrupted.error).toBe(files.interruptedCopy);
    expect(interrupted.logs).toEqual([]);
    expect(files.contents(posix.join(files.dest, '1f300.svg'))).toBe('<svg data-fixture="0"/>');
    expect(files.contents(posix.join(files.dest, '1f301.svg'))).toBeUndefined();

    files.failAfterFiles = undefined;
    const recovered = await runEmojiCli(files);

    expect(recovered.error).toBeUndefined();
    expect(recovered.exits).toEqual([]);
    expect(files.cpSync).toHaveBeenCalledTimes(2);
    expect(files.contents(posix.join(files.dest, '1f301.svg'))).toBe('<svg data-fixture="1"/>');
    expect(files.contents(posix.join(files.dest, '1f302.svg'))).toBe('<svg data-fixture="2"/>');
  });

  test.failing('KNOWN GAP: count-only cache skips missing SVG recovery after an interrupted copy exceeds 1000 entries', async () => {
    const files = new MemoryEmojiFiles();
    seedSvgSet(files, 1002);
    files.failAfterFiles = 1001;
    const interrupted = await runEmojiCli(files);

    // Establish that this is an actual partial copy, before the intended defect assertion.
    expect(interrupted.error).toBe(files.interruptedCopy);
    expect(interrupted.logs).toEqual([]);
    expect(files.contents(posix.join(files.dest, '1f6e9.svg'))).toBeUndefined();
    files.failAfterFiles = undefined;
    const rerun = await runEmojiCli(files);
    expect(rerun.error).toBeUndefined();

    // The next build must finish the same source set after the copy interruption.
    expect(files.contents(posix.join(files.dest, '1f6e9.svg'))).toBe('<svg data-fixture="1001"/>');
  });
});
