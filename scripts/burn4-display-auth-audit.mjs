#!/usr/bin/env node
// @ts-check
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** @typedef {'POST'|'PUT'|'PATCH'|'DELETE'} Method */
/** @typedef {{file:string,method:Method,line:number,column:number,path:string[],excepted?:string}} Finding */
/** @typedef {{file:string,line:number,column:number,code:string,message:string,method?:Method}} Diagnostic */
/** @typedef {{findings:Finding[],diagnostics:Diagnostic[]}} Analysis */
/** @typedef {{file:string,method:Method,reason:string}} Exception */
/** @typedef {{files:string[],findings:Finding[],diagnostics:Diagnostic[],limitations:string[]}} Report */
/** @typedef {{kind:'auth'|'namespace'|'function'|'other'|'unsupported',fn?:ts.FunctionLikeDeclaration,values?:ts.Node[],tainted?:boolean}} Value */
const methods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const limitations = [
  'Conservative local source audit; findings do not prove missing authorization.',
  'Only direct local call edges and immutable aliases are modeled; branch conditions are not evaluated.',
  'External helper bodies and top-level execution are not analyzed. One representative path is retained per root and call site.',
];

/** @param {string} name @returns {name is Method} */
function isMethod(name) { return methods.has(name); }
/** @param {string} value @returns {string} */
function canonical(value) {
  if (!value || isAbsolute(value) || value.includes('\\') || value.includes(':') || value.includes('\0') || /[*?]/.test(value)) {
    throw new Error('Expected a canonical relative file path');
  }
  if (value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Expected a canonical relative file path');
  return value;
}
/** @param {string} file @param {string} module @returns {boolean} */
function knownModule(file, module) {
  const name = module.replace(/\.(?:js|ts)$/, '').replace(/\/index$/, '');
  if (name === '@/lib/auth' || name === '@/lib/auth/requireAuth') return true;
  if (!name.startsWith('.')) return false;
  const target = posix.normalize(posix.join(posix.dirname(file), name));
  return target === 'src/lib/auth' || target === 'src/lib/auth/requireAuth';
}
/** @param {ts.Node} node @returns {node is ts.FunctionLikeDeclaration} */
function callable(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node);
}
/** @param {ts.Node} node @returns {boolean} */
function exported(node) { return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword); }

/** Analyze source text without resolving, reading or evaluating any imported module.
 * @param {string} file Canonical root-relative source path.
 * @param {string} source TypeScript route text.
 * @returns {Analysis}
 */
export function analyzeSource(file, source) {
  canonical(file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.jsx') ? ts.ScriptKind.JSX : file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  /** @type {ts.CompilerHost} */
  const host = {
    getSourceFile: (name) => name === file ? sf : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '',
    getDirectories: () => [], fileExists: (name) => name === file,
    readFile: (name) => name === file ? source : undefined,
    getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const program = ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true, target: ts.ScriptTarget.Latest }, host);
  const checker = program.getTypeChecker();
  /** @type {Finding[]} */ const findings = [];
  /** @type {Diagnostic[]} */ const diagnostics = [];
  /** @type {Set<string>} */ const diagnosticKeys = new Set();
  /** @param {ts.Node} node @param {string} code @param {string} message @param {Method=} method */
  function diagnostic(node, code, message, method) {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const key = `${method ?? ''}:${line}:${character}:${code}`;
    if (!diagnosticKeys.has(key)) {
      diagnosticKeys.add(key);
      diagnostics.push({ file, line: line + 1, column: character + 1, code, message, ...(method ? { method } : {}) });
    }
  }
  for (const error of program.getSyntacticDiagnostics(sf)) {
    const { line, character } = sf.getLineAndCharacterOfPosition(error.start ?? 0);
    diagnostics.push({ file, line: line + 1, column: character + 1, code: 'parse', message: `Invalid TypeScript syntax (${error.code})` });
  }
  if (diagnostics.length) return { findings, diagnostics };
  /** @type {Map<ts.Symbol, Value>} */ const imports = new Map();
  /** @type {Map<ts.Symbol, ts.Node[]>} */ const writes = new Map();
  /** @param {ts.Node} node @returns {ts.Symbol|undefined} */
  const symbol = (node) => checker.getSymbolAtLocation(node);
  for (const statement of sf.statements) {
    if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly && ts.isExternalModuleReference(statement.moduleReference)) {
      const expression = statement.moduleReference.expression;
      const binding = symbol(statement.name);
      if (binding && expression && ts.isStringLiteral(expression) && knownModule(file, expression.text)) imports.set(binding, { kind: 'namespace' });
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const known = knownModule(file, statement.moduleSpecifier.text);
    if (clause.name && known) { const binding = symbol(clause.name); if (binding) imports.set(binding, { kind: 'unsupported', tainted: true }); }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && known) {
      const s = symbol(bindings.name); if (s) imports.set(s, { kind: 'namespace' });
    }
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (item.isTypeOnly || (item.propertyName ?? item.name).text !== 'getDisplayAuth') continue;
      const s = symbol(item.name); if (s) imports.set(s, known ? { kind: 'auth' } : { kind: 'unsupported', tainted: true });
    }
  }
  /** @param {ts.Node} node */
  function recordWrites(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left)) {
      const s = symbol(node.left); if (s) writes.set(s, [...(writes.get(s) ?? []), node.right]);
    }
    ts.forEachChild(node, recordWrites);
  }
  recordWrites(sf);
  /** @param {ts.Node} node @param {Set<ts.Symbol>=} seen @returns {Value} */
  function value(node, seen = new Set()) {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)) return value(node.expression, seen);
    if (callable(node)) return { kind: 'function', fn: node };
    if (ts.isIdentifier(node)) {
      const s = symbol(node);
      if (!s || seen.has(s)) return { kind: 'other' };
      if (imports.has(s)) return /** @type {Value} */ (imports.get(s));
      const next = new Set(seen); next.add(s);
      for (const declaration of s.declarations ?? []) {
        if (ts.isFunctionDeclaration(declaration)) return { kind: 'function', fn: declaration };
        if (ts.isClassDeclaration(declaration)) return { kind: 'unsupported', values: [declaration] };
        if (ts.isVariableDeclaration(declaration)) {
          const list = declaration.parent;
          if (!ts.isIdentifier(declaration.name)) return { kind: 'unsupported', values: [declaration] };
          if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const) || writes.has(s)) {
            return { kind: 'unsupported', values: [...(declaration.initializer ? [declaration.initializer] : []), ...(writes.get(s) ?? [])] };
          }
          return declaration.initializer ? value(declaration.initializer, next) : { kind: 'other' };
        }
        if (ts.isBindingElement(declaration)) {
          /** @type {ts.Node} */ let parent = declaration.parent;
          while (!ts.isVariableDeclaration(parent) && parent.parent) parent = parent.parent;
          return { kind: 'unsupported', values: [...(declaration.initializer ? [declaration.initializer] : []), ...(ts.isVariableDeclaration(parent) && parent.initializer ? [parent.initializer] : [])] };
        }
      }
      return { kind: 'other' };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = value(node.expression, seen);
      const member = ts.isPropertyAccessExpression(node) ? node.name.text
        : node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
      if (base.kind === 'namespace' && member === 'getDisplayAuth') return { kind: 'auth' };
      if (base.kind === 'namespace' && member !== undefined) return { kind: 'other' };
      return { kind: 'unsupported', values: [node.expression], tainted: base.kind === 'namespace' };
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return { kind: 'unsupported', tainted: true };
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && !symbol(node.expression) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && knownModule(file, node.arguments[0].text)) return { kind: 'namespace' };
      return { kind: 'unsupported', values: [node] };
    }
    return { kind: 'unsupported', values: [node] };
  }
  /** Does a value carry an auth callable, as opposed to the result of a direct auth call?
   * @param {ts.Node} node @param {Set<ts.Node>=} seen @returns {boolean}
   */
  function carries(node, seen = new Set()) {
    if (seen.has(node) || ts.isTypeNode(node)) return false;
    const next = new Set(seen); next.add(node);
    const resolved = value(node);
    if (resolved.kind === 'auth' || resolved.kind === 'namespace' || resolved.tainted) return true;
    if (resolved.kind === 'function' && resolved.fn) return resolved.fn.parameters.some((p) => treeAuth(p, next)) || treeAuth(resolved.fn.body, next);
    if (resolved.kind === 'other') return false;
    if (resolved.values?.some((item) => item !== node && carries(item, next))) return true;
    if (ts.isCallExpression(node)) {
      const callee = value(node.expression);
      if (callee.kind === 'auth') return false;
      if (callee.kind === 'function' && callee.fn) {
        const fn = callee.fn;
        if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return carries(fn.body, next);
        let returned = false;
        /** @param {ts.Node} child */
        function inspectReturn(child) {
          if (callable(child) || ts.isTypeNode(child)) return;
          if (ts.isReturnStatement(child) && child.expression && carries(child.expression, next)) returned = true;
          ts.forEachChild(child, inspectReturn);
        }
        if (fn.body) inspectReturn(fn.body);
        return returned;
      }
      return carries(node.expression, next) || node.arguments.some((arg) => carries(arg, next));
    }
    let result = false;
    ts.forEachChild(node, (child) => { if (carries(child, next)) result = true; });
    return result;
  }
  /** @param {ts.Node|undefined} node @param {Set<ts.Node>} seen @returns {boolean} */
  function treeAuth(node, seen) {
    if (!node || seen.has(node) || ts.isTypeNode(node)) return false;
    const next = new Set(seen); next.add(node);
    if (ts.isIdentifier(node)) {
      const v = value(node);
      if (v.kind === 'auth' || v.kind === 'namespace' || v.tainted) return true;
      if (v.kind === 'function' && v.fn) return v.fn.parameters.some((p) => treeAuth(p, next)) || treeAuth(v.fn.body, next);
      if (v.values?.some((item) => item !== node && carries(item, next))) return true;
    }
    let result = false;
    ts.forEachChild(node, (child) => { if (treeAuth(child, next)) result = true; });
    return result;
  }
  /** @type {{method:Method,node:ts.Node}[]} */ const roots = [];
  for (const statement of sf.statements) {
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = statement.expression.left.getText(sf);
      if (/^(?:exports\.(?:POST|PUT|PATCH|DELETE)|module\.exports(?:\.(?:POST|PUT|PATCH|DELETE))?)$/.test(left)) diagnostic(statement, 'unsupported-export', 'CommonJS handler exports are not modeled');
    }
    if ((ts.isClassDeclaration(statement) || ts.isModuleDeclaration(statement)) && exported(statement) && statement.name && isMethod(statement.name.text)) diagnostic(statement, 'unsupported-export', 'Class and namespace handler exports are not modeled', statement.name.text);
    if (ts.isImportEqualsDeclaration(statement) && exported(statement) && isMethod(statement.name.text)) diagnostic(statement, 'unsupported-export', 'Import-equals handler exports are not modeled', statement.name.text);
    if (ts.isFunctionDeclaration(statement) && exported(statement) && statement.name && isMethod(statement.name.text)) roots.push({ method: statement.name.text, node: statement });
    if (ts.isVariableStatement(statement) && exported(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && isMethod(declaration.name.text)) roots.push({ method: declaration.name.text, node: declaration.name });
      else if (!ts.isIdentifier(declaration.name) && /\b(?:POST|PUT|PATCH|DELETE)\b/.test(declaration.name.getText(sf))) diagnostic(declaration, 'unsupported-export', 'Destructured handler exports are not modeled');
    }
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) diagnostic(statement, 'unsupported-export', 'Export-star handlers require inter-file analysis');
      else if (ts.isNamedExports(statement.exportClause)) for (const item of statement.exportClause.elements) {
        if (!isMethod(item.name.text) || item.isTypeOnly || statement.isTypeOnly) continue;
        if (statement.moduleSpecifier) diagnostic(item, 'unsupported-export', 'Reexported handlers require inter-file analysis', item.name.text);
        else roots.push({ method: item.name.text, node: item.propertyName ?? item.name });
      }
    }
  }
  for (const root of roots) {
    /** @type {Set<ts.FunctionLikeDeclaration>} */ const visited = new Set();
    /** @param {ts.Node} node @param {string[]} path */
    function finding(node, path) {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      if (!findings.some((item) => item.method === root.method && item.line === line + 1 && item.column === character + 1)) findings.push({ file, method: root.method, line: line + 1, column: character + 1, path });
    }
    /** @param {ts.FunctionLikeDeclaration} fn @param {string[]} path */
    function visitFunction(fn, path) {
      if (visited.has(fn)) return;
      visited.add(fn);
      for (const parameter of fn.parameters) if (parameter.initializer && carries(parameter.initializer)) diagnostic(parameter, 'unsupported-binding', 'Auth-carrying parameter defaults are not modeled', root.method);
      if (!fn.body) { diagnostic(fn, 'unsupported-handler', 'A reachable function has no local implementation', root.method); return; }
      /** @param {ts.Node} node */
      function walk(node) {
        if (ts.isTypeNode(node) || callable(node)) return;
        if (ts.isCallExpression(node)) {
          const callee = value(node.expression);
          if (callee.kind === 'auth') finding(node, path);
          else if (callee.kind === 'function' && callee.fn) {
            const label = ts.isIdentifier(node.expression) ? node.expression.text : `<inline@${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}>`;
            visitFunction(callee.fn, [...path, label]);
          } else if (carries(node.expression)) diagnostic(node, 'unsupported-auth-call', 'Auth-carrying call target is outside the local callable model', root.method);
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) diagnostic(node, 'dynamic-import', 'Dynamic imports are not analyzed', root.method);
          for (const argument of node.arguments) if (carries(argument)) diagnostic(argument, 'auth-escape', 'Auth callable escapes through a call argument', root.method);
        }
        if ((ts.isVariableDeclaration(node) || ts.isBindingElement(node)) && node.initializer && carries(node.initializer)) {
          if (!ts.isIdentifier(node.name) || !ts.isVariableDeclarationList(node.parent) || !(node.parent.flags & ts.NodeFlags.Const)) diagnostic(node, 'unsupported-binding', 'Mutable or destructured auth bindings are not modeled', root.method);
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && carries(node.right)) diagnostic(node, 'auth-assignment', 'Auth callable assignment is not modeled', root.method);
        if ((ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.isYieldExpression(node)) && node.expression && carries(node.expression)) diagnostic(node, 'auth-escape', 'Auth callable escapes through a returned or thrown value', root.method);
        if ((ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) && carries(node)) diagnostic(node, 'auth-storage', 'Auth callable storage in objects or arrays is not modeled', root.method);
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && value(node).kind === 'unsupported' && carries(node)) diagnostic(node, 'unsupported-member', 'Computed or indirect auth callable access is not modeled', root.method);
        if ((ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) && carries(ts.isNewExpression(node) ? node.expression : node.tag)) diagnostic(node, 'unsupported-auth-call', 'Constructor and template auth calls are not modeled', root.method);
        ts.forEachChild(node, walk);
      }
      for (const parameter of fn.parameters) walk(parameter);
      if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body) && carries(fn.body)) diagnostic(fn.body, 'auth-escape', 'Auth callable escapes through a concise arrow result', root.method);
      walk(fn.body);
    }
    const resolved = value(root.node);
    if (resolved.kind === 'auth') finding(root.node, [root.method]);
    else if (resolved.kind === 'function' && resolved.fn) visitFunction(resolved.fn, [root.method]);
    else diagnostic(root.node, 'unsupported-handler', 'Handler must resolve to a local function or immutable alias', root.method);
  }
  return sortAnalysis({ findings, diagnostics });
}
/** @param {Analysis} result @returns {Analysis} */
function sortAnalysis(result) {
  const compare = (/** @type {Finding|Diagnostic} */ a, /** @type {Finding|Diagnostic} */ b) => a.file.localeCompare(b.file, 'en') || (a.method ?? '').localeCompare(b.method ?? '', 'en') || a.line - b.line || a.column - b.column || ('code' in a ? a.code : '').localeCompare('code' in b ? b.code : '', 'en');
  result.findings.sort(compare); result.diagnostics.sort(compare); return result;
}

/** Validate exact, reasoned exceptions against raw findings, retaining waived evidence.
 * @param {Finding[]} findings @param {unknown} input @returns {Finding[]}
 */
export function applyExceptions(findings, input) {
  if (!Array.isArray(input)) throw new Error('Exceptions must be an array');
  /** @type {Map<string,string>} */ const reasons = new Map();
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'file,method,reason') throw new Error('Exception fields must be exactly file, method and reason');
    if (typeof item.file !== 'string' || typeof item.method !== 'string' || !isMethod(item.method) || typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('Exception requires a canonical file, mutation method and nonempty reason');
    const key = `${canonical(item.file)}:${item.method}`;
    if (reasons.has(key)) throw new Error('Duplicate exception');
    if (!findings.some((f) => `${f.file}:${f.method}` === key)) throw new Error('Stale exception has no matching raw finding in selected files');
    reasons.set(key, item.reason.trim());
  }
  return findings.map((f) => {
    const reason = reasons.get(`${f.file}:${f.method}`);
    return reason ? { ...f, path: [...f.path], excepted: reason } : { ...f, path: [...f.path] };
  });
}
/** @param {string} root @param {string} target @returns {void} */
function safePath(root, target) {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Input path is outside root');
  const absoluteRoot = parse(target).root;
  let current = absoluteRoot;
  for (const part of target.slice(absoluteRoot.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink files and ancestors are forbidden');
  }
}
/** @param {string} root @param {string[]} selected @returns {string[]} */
function collect(root, selected) {
  safePath(root, root);
  if (!lstatSync(root).isDirectory()) throw new Error('Root must be a directory');
  /** @type {string[]} */ const files = [];
  /** @param {string} directory */
  function walk(directory) {
    safePath(root, directory);
    for (const name of readdirSync(directory).sort()) {
      if (name === 'node_modules' || name === '.git') continue;
      const target = join(directory, name); safePath(root, target);
      const stat = lstatSync(target);
      if (stat.isDirectory()) walk(target);
      else if (stat.isFile() && /^route\.[jt]sx?$/.test(name)) files.push(relative(root, target).split(sep).join('/'));
      else if (!stat.isFile()) throw new Error('Only regular files and directories are allowed');
    }
  }
  if (selected.length) for (const file of selected) {
    canonical(file);
    if (!/\.[jt]sx?$/.test(file)) throw new Error('Explicit source files must use a TypeScript or JavaScript extension');
    const target = resolve(root, file); safePath(root, target);
    if (!lstatSync(target).isFile()) throw new Error('Explicit source input must be a regular file');
    files.push(file);
  }
  else walk(join(root, 'src/app/api'));
  const result = [...new Set(files)].sort();
  if (!result.length) throw new Error('No route source files selected');
  if (result.length > 5000) throw new Error('File selection exceeds the 5000-file audit limit');
  return result;
}

/** Read only selected source data beneath root; never load application modules.
 * @param {string} rootPath @param {string[]} selected @param {unknown} [exceptions=[]] @returns {Report}
 */
export function auditFiles(rootPath, selected, exceptions = []) {
  if (!rootPath || !rootPath.trim()) throw new Error('Explicit root is required');
  if (!Array.isArray(selected) || selected.some((file) => typeof file !== 'string')) throw new Error('Selected files must be a string array');
  const root = resolve(rootPath);
  const files = collect(root, selected);
  /** @type {Analysis} */ const result = { findings: [], diagnostics: [] };
  for (const file of files) {
    const target = resolve(root, file); safePath(root, target);
    if (lstatSync(target).size > 512 * 1024) throw new Error('Source exceeds the 512 KiB audit limit');
    const analysis = analyzeSource(file, readFileSync(target, 'utf8'));
    result.findings.push(...analysis.findings); result.diagnostics.push(...analysis.diagnostics);
  }
  sortAnalysis(result);
  return { files, findings: applyExceptions(result.findings, exceptions), diagnostics: result.diagnostics, limitations: [...limitations] };
}
/** @param {Report} report @returns {string} */
function formatText(report) {
  const rows = [`Audited ${report.files.length} source file(s); ${report.findings.length} finding(s); ${report.diagnostics.length} incomplete diagnostic(s).`];
  for (const finding of report.findings) rows.push(`${finding.file}:${finding.line}:${finding.column} ${finding.method} getDisplayAuth via ${finding.path.join(' -> ')}${finding.excepted ? ` [excepted: ${finding.excepted}]` : ''}`);
  for (const d of report.diagnostics) rows.push(`${d.file}:${d.line}:${d.column} ${d.method ?? ''} ${d.code}: ${d.message}`);
  rows.push(...report.limitations); return `${rows.join('\n')}\n`;
}

/** Parse a manual invocation. Diagnostics outrank findings in both advisory and check modes.
 * @param {string[]} args @returns {{exitCode:number,output:string}}
 */
export function runCli(args) {
  let json = args.includes('--json');
  try {
    let root = ''; let exceptionFile = ''; let check = false;
    /** @type {string[]} */ const files = [];
    /** @type {Set<string>} */ const seen = new Set();
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--help' && args.length === 1) return { exitCode: 0, output: 'Usage: node scripts/burn4-display-auth-audit.mjs --root DIRECTORY [--check] [--json] [--exceptions FILE] [RELATIVE_SOURCE ...]\nDefault discovery: src/app/api/**/route.{ts,tsx,js,jsx}. Source data only; never executes routes.\n' };
      if (arg.startsWith('--')) {
        if (seen.has(arg)) throw new Error('Duplicate option'); seen.add(arg);
        if (arg === '--check') check = true;
        else if (arg === '--json') json = true;
        else if (arg === '--root' || arg === '--exceptions') {
          const next = args[++index]; if (!next || next.startsWith('--')) throw new Error('Option requires a value');
          if (arg === '--root') root = next; else exceptionFile = next;
        } else throw new Error('Unknown option');
      } else files.push(arg);
    }
    if (!root) throw new Error('--root is required');
    /** @type {unknown} */ let exceptions = [];
    if (exceptionFile) {
      const target = resolve(root, canonical(exceptionFile)); safePath(resolve(root), target);
      if (!lstatSync(target).isFile() || lstatSync(target).size > 512 * 1024) throw new Error('Exception input must be a regular file of at most 512 KiB');
      try { exceptions = JSON.parse(readFileSync(target, 'utf8')); } catch { throw new Error('Malformed exception JSON'); }
    }
    const report = auditFiles(root, files, exceptions);
    const exitCode = report.diagnostics.length ? 2 : check && report.findings.some((f) => !f.excepted) ? 1 : 0;
    return { exitCode, output: json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report) };
  } catch (error) {
    const report = { files: [], findings: [], diagnostics: [{ file: '', line: 0, column: 0, code: 'input', message: error instanceof Error ? error.message : 'Invalid input' }], limitations: [...limitations] };
    return { exitCode: 2, output: json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report) };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
