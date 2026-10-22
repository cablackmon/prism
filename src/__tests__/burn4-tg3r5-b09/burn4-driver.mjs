// @ts-check
import { readFileSync } from 'node:fs';
import { analyzeSource, applyExceptions, auditFiles, runCli } from '../../../scripts/burn4-display-auth-audit.mjs';
/** @type {{operation:string,file?:string,source?:string,args?:string[],root?:string,files?:string[],exceptions?:unknown,findings?:Parameters<typeof applyExceptions>[0]}} */
const input = JSON.parse(readFileSync(0, 'utf8'));
try {
  let value;
  if (input.operation === 'analyze') value = analyzeSource(input.file ?? 'src/app/api/synthetic/route.ts', input.source ?? '');
  else if (input.operation === 'exceptions') value = applyExceptions(input.findings ?? [], input.exceptions);
  else if (input.operation === 'files') value = auditFiles(input.root ?? '', input.files ?? [], input.exceptions);
  else if (input.operation === 'cli') value = runCli(input.args ?? []);
  else throw new Error('Unknown synthetic operation');
  process.stdout.write(JSON.stringify({ value }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
}
