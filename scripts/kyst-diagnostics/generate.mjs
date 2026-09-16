import fs from 'node:fs';import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const probe=fs.readFileSync('scripts/kyst-diagnostics/page-probe.js','utf8');
fs.writeFileSync('src/lib/diagnostics/generated-probe.js','// Generated; edit scripts/kyst-diagnostics/page-probe.js.\nexport function installProbe(expectedOrigin){\n'+probe+'\n}\n');
const sources=['src/lib/diagnostics/store.ts','src/app/api/kyst-diagnostics/route.ts','src/components/diagnostics/AcceptanceEntry.tsx','src/app/layout.tsx'];
const build=hash(probe+sources.map(p=>p+'\n'+fs.readFileSync(p,'utf8')).join('\n'));
fs.writeFileSync('src/lib/diagnostics/generated-pins.json',JSON.stringify({build,probe:hash(probe)},null,2)+'\n');
