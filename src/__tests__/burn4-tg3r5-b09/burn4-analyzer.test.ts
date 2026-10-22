import { auth, Fixture, sourceFile } from './burn4-harness';
let fixture: Fixture;
beforeEach(() => { fixture = new Fixture(); });
afterEach(() => { fixture.dispose(); });

const findings: [string, string, string[]][] = [
  ['direct rename', 'export function POST(){return read()}', ['POST']],
  ['called parameter initializer', 'function check(result=read()){return result}export const POST=()=>check()', ['POST', 'check']],
  ['const alias chain', 'const a=read;const b=a; export const POST=()=>b()', ['POST']],
  ['helper alias', 'const leaf=()=>read();const alias=leaf; export function POST(){alias()}', ['POST', 'alias']],
  ['returned helper result', 'function leaf(){return read()}export const POST=()=>leaf()', ['POST', 'leaf']],
  ['function expression', 'const leaf=function(){return read()}; export const POST=()=>leaf()', ['POST', 'leaf']],
  ['handler alias', 'function leaf(){return read()};const alias=leaf;export {alias as POST}', ['POST']],
  ['exported variable alias', 'function leaf(){read()};export const POST=leaf', ['POST']],
  ['called nested arrow', 'export function POST(){const nested=()=>read();nested()}', ['POST', 'nested']],
  ['IIFE', 'export function POST(){(()=>read())()}', ['POST', '<inline@2>']],
  ['cyclic helpers', 'function a(){b()}function b(){a();read()}export function POST(){a()}', ['POST', 'a', 'b']],
  ['non-null alias', 'const a=(read as typeof read)!;export const POST=()=>a()', ['POST']],
  ['optional direct call', 'export const POST=()=>read?.()', ['POST']],
  ['conservative branch', 'export function POST(){if(false){read()}}', ['POST']],
];
test.each(findings)('%s reports original call and root/helper path', (_name, body, path) => {
  const result = fixture.analyze(auth + body);
  expect(result.diagnostics).toEqual([]);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toMatchObject({ file: sourceFile, method: 'POST', line: 2, path });
  expect(result.findings[0]!.column).toBeGreaterThan(0);
});

test.each([
  ['namespace', "import * as auth from '@/lib/auth';export function POST(){auth.getDisplayAuth()}"],
  ['namespace alias', "import * as original from '@/lib/auth';const auth=original;export const POST=()=>auth['getDisplayAuth']()"],
  ['import equals', "import auth = require('@/lib/auth');export const POST=()=>auth.getDisplayAuth()"],
  ['requireAuth module', "import {getDisplayAuth} from '@/lib/auth/requireAuth.js';export const POST=()=>getDisplayAuth()"],
  ['relative auth barrel', "import {getDisplayAuth} from '../../../lib/auth/index.ts';export const POST=()=>getDisplayAuth()"],
])('%s resolves the known imported binding', (_name, source) => {
  const result = fixture.analyze(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.findings).toHaveLength(1);
});

test('location points to the original call and roots stay separate', () => {
  const result = fixture.analyze(auth + 'function leaf(){\n  read();\n}\nexport const POST=leaf;export const PATCH=leaf;export const GET=leaf;');
  expect(result.diagnostics).toEqual([]);
  expect(result.findings.map(({ method, line, column, path }) => ({ method, line, column, path }))).toEqual([
    { method: 'PATCH', line: 3, column: 3, path: ['PATCH'] },
    { method: 'POST', line: 3, column: 3, path: ['POST'] },
  ]);
});

test.each([
  ['read-only root', 'export function GET(){read()}export function POST(){return 1}'],
  ['dead default initializer', 'function dead(result=read()){return result}export const POST=()=>1'],
  ['unused nested', 'export function POST(){function dead(){read()}return 1}'],
  ['unused arrow', 'const dead=()=>read();export const POST=()=>1'],
  ['parameter shadow', 'export function POST(read:()=>void){read()}'],
  ['block shadow', 'export function POST(){{const read=()=>1;read()}}'],
  ['catch shadow', 'export function POST(){try{}catch(read){read()}}'],
  ['var shadow', 'export function POST(){var read=()=>1;read()}'],
  ['destructured parameter shadow', 'export function POST({read}){read()}'],
  ['namespace shadow', "import * as auth from '@/lib/auth';export function POST(auth){auth.getDisplayAuth()}"],
  ['type-only import', "import type {getDisplayAuth as only} from '@/lib/auth';export const POST=()=>only()"],
  ['strings/comments', 'export const POST=()=>{const text="read()";/*read()*/return text}'],
  ['unrelated helper', 'function getDisplayAuth(){return 1}export const POST=()=>getDisplayAuth()'],
])('%s remains clean', (_name, body) => {
  const result = fixture.analyze(auth + body);
  expect(result).toEqual({ findings: [], diagnostics: [] });
});

test('outer helper retains import identity despite root-local shadowing', () => {
  const result = fixture.analyze(auth + 'function outer(){read()}export function POST(){const read=()=>0;read();outer()}');
  expect(result.diagnostics).toEqual([]);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]!.path).toEqual(['POST', 'outer']);
});

test.each([
  ['mutable initializer', 'let f=read;export function POST(){f()}'],
  ['mutable later assignment', 'let f;f=read;export function POST(){f()}'],
  ['destructuring', "import * as auth from '@/lib/auth';const {getDisplayAuth:f}=auth;export const POST=()=>f()"],
  ['object storage', 'const box={f:read};export const POST=()=>box.f()'],
  ['array storage', 'const box=[read];export const POST=()=>box[0]()'],
  ['computed namespace', "import * as auth from '@/lib/auth';const key='getDisplayAuth';export const POST=()=>auth[key]()"],
  ['bind', 'const f=read.bind(null);export const POST=()=>f()'],
  ['call', 'export const POST=()=>read.call(null)'],
  ['apply', 'export const POST=()=>read.apply(null,[])'],
  ['callback', 'export function POST(){unknown(()=>read())}'],
  ['helper callback', 'const leaf=()=>read();export const POST=()=>unknown(leaf)'],
  ['local higher-order helper', 'function invoke(fn){fn()}export const POST=()=>invoke(read)'],
  ['conditional', 'const f=flag?read:()=>0;export const POST=()=>f()'],
  ['wrapped export', 'export const POST=wrap(()=>read())'],
  ['dynamic import', "export async function POST(){const auth=await import('@/lib/auth');auth.getDisplayAuth()}"],
  ['reexport', "export {handler as POST} from './other'"],
  ['star export', "export * from './other'"],
  ['unknown auth import', "import {getDisplayAuth as f} from './auth';export const POST=()=>f()"],
  ['commonjs destructuring', "const {getDisplayAuth:f}=require('@/lib/auth');export const POST=()=>f()"],
  ['default auth import', "import auth from '@/lib/auth';export const POST=()=>auth.getDisplayAuth()"],
  ['class instance', 'class Checker {run(){read()}}export const POST=()=>new Checker().run()'],
  ['class static', 'class Checker {static run(){read()}}export const POST=()=>Checker.run()'],
  ['namespace handler export', 'namespace Route{export function POST(){read()}}export import POST=Route.POST'],
  ['top-level callable factory', 'function make(){return read}const f=make();export const POST=()=>f()'],
  ['destructured default', 'function check({auth=read}={}){return auth()}export const POST=()=>check()'],
  ['default-bearing callback', 'function check(result=read()){return result}export const POST=()=>unknown(check)'],
  ['object binding default', 'const {f=read}={};export const POST=()=>f()'],
  ['array binding default', 'const [f=read]=[];export const POST=()=>f()'],
  ['catch binding default', 'export function POST(){try{throw{}}catch({f=read}){f()}}'],
  ['parameter default', 'export function POST(fn=read){fn()}'],
  ['helper parameter default', 'function helper(fn=read){fn()}export const POST=()=>helper()'],
  ['commonjs handler', 'exports.POST=()=>read()'],
  ['commonjs object export', 'module.exports={POST:()=>read()}'],
  ['class root', 'export class POST{run(){read()}}'],
  ['returned callable', 'export const POST=()=>read'],
  ['constructor call', 'export const POST=()=>new read()'],
  ['tagged call', 'export const POST=()=>read`text`'],
])('%s is explicitly incomplete', (_name, body) => {
  const result = fixture.analyze(auth + body);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.diagnostics.every((d) => d.line > 0 && d.column > 0)).toBe(true);
});

test('syntax errors produce parse diagnostics without partial findings', () => {
  const result = fixture.analyze(auth + 'export function POST( { read()');
  expect(result.findings).toEqual([]);
  expect(result.diagnostics[0]!.code).toBe('parse');
});

test('source text is never executed', () => {
  const result = fixture.analyze(auth + 'throw new Error("must not execute");export const DELETE=()=>read()');
  expect(result.diagnostics).toEqual([]);
  expect(result.findings[0]!.method).toBe('DELETE');
});
