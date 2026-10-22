/* eslint @typescript-eslint/no-require-imports: "off" */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Compile only this package's TypeScript files. No test or production import is run.
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  assert.equal(path.dirname(filename), __dirname, 'inverse probe imports stay inside its package');
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

(async () => {
  try {
    const { gaps } = require('./burn4-gap-cases.ts');
    const results = [];
    for (const gap of gaps) {
      let failure;
      try { await gap.check(); } catch (error) { failure = error; }
      assert.ok(failure instanceof assert.AssertionError, `${gap.name}: inverse must fail at an assertion`);
      assert.ok(failure.message.includes(gap.assertion), `${gap.name}: inverse must reach its intended assertion`);
      results.push({ name: gap.name, confirmed: true, assertion: gap.assertion });
    }
    process.stdout.write(JSON.stringify({ confirmed: results.length, results }, null, 2) + '\n');
  } finally {
    if (previous) require.extensions['.ts'] = previous;
    else delete require.extensions['.ts'];
  }
})().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
