#!/usr/bin/env node
// Offline checks for translator-edited JSON. See docs/features/LANGUAGES.md.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {parse, TYPE} from '@formatjs/icu-messageformat-parser';

/** @typedef {{file: string, text: string}} CatalogInput */
/** @typedef {'error' | 'warning' | 'info'} Severity */
/** @typedef {{severity: Severity, code: string, file: string, path: string, message: string, subject?: string, line?: number, column?: number}} Diagnostic */
/** @typedef {{version: 1, ok: boolean, catalogs: number, sourceMessages: number, translatedMessages: number, fallbacks: number, errors: number, warnings: number, diagnostics: Diagnostic[]}} AuditReport */
/** @typedef {{requireComplete?: boolean}} AuditOptions */
/** @typedef {'value' | 'number' | 'date'} ArgumentKind */
/** @typedef {{arguments: Map<string, Set<ArgumentKind>>, tags: Set<string>}} Signature */
/** @typedef {{nodes: Map<string, 'message' | 'namespace'>, messages: Map<string, Signature>, diagnostics: Diagnostic[], validRoot: boolean}} ParsedCatalog */

/** @param {string} parent @param {string} key */
function pointer(parent, key) {
  return `${parent}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {CatalogInput} input @returns {ParsedCatalog} */
function inspectCatalog(input) {
  /** @type {ParsedCatalog} */
  const result = {nodes: new Map(), messages: new Map(), diagnostics: [], validRoot: false};
  /** @param {string} code @param {string} path @param {string} message @param {string} [subject] */
  const error = (code, path, message, subject) => result.diagnostics.push({
    severity: 'error', code, file: input.file, path, message,
    ...(subject === undefined ? {} : {subject}),
  });
  /** @type {unknown} */
  let root;
  try {
    root = JSON.parse(input.text);
  } catch {
    error('invalid_json', '', 'Catalog must be strict JSON.');
    return result;
  }

  // JSON.parse loses duplicate names. Inspect the raw, already validated JSON AST.
  const ast = ts.parseJsonText(input.file, input.text);
  /** @param {ts.Node} node @param {string} path */
  function checkDuplicates(node, path) {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
        const childPath = pointer(path, property.name.text);
        if (seen.has(property.name.text)) {
          const location = ast.getLineAndCharacterOfPosition(property.name.getStart(ast));
          result.diagnostics.push({
            severity: 'error', code: 'duplicate_key', file: input.file, path: childPath,
            message: 'JSON object contains a repeated key.',
            line: location.line + 1, column: location.character + 1,
          });
        }
        seen.add(property.name.text);
        checkDuplicates(property.initializer, childPath);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((child, index) => checkDuplicates(child, pointer(path, String(index))));
    }
  }
  ast.statements.forEach(statement => {
    if (ts.isExpressionStatement(statement)) checkDuplicates(statement.expression, '');
  });

  if (!isObject(root)) {
    error('invalid_root', '', 'Catalog root must be an object.');
    return result;
  }
  result.validRoot = true;

  /** @param {Record<string, unknown>} object @param {string} path */
  function visit(object, path) {
    for (const [key, value] of Object.entries(object)) {
      const childPath = pointer(path, key);
      if (isObject(value)) {
        result.nodes.set(childPath, 'namespace');
        visit(value, childPath);
        continue;
      }
      result.nodes.set(childPath, 'message');
      if (typeof value !== 'string') {
        error('invalid_message_type', childPath, 'Message leaves must be strings.');
        continue;
      }
      if (!value.trim()) {
        error('empty_message', childPath, 'Message must contain visible text.');
        continue;
      }
      /** @type {import('@formatjs/icu-messageformat-parser').MessageFormatElement[]} */
      let elements;
      try {
        elements = parse(value, {captureLocation: true, requiresOtherClause: true});
      } catch {
        error('invalid_icu', childPath, 'Message is not valid ICU syntax.');
        continue;
      }
      /** @type {Signature} */
      const signature = {arguments: new Map(), tags: new Set()};
      /** @param {string} name @param {ArgumentKind} kind */
      function argument(name, kind) {
        const kinds = signature.arguments.get(name) ?? new Set();
        kinds.add(kind);
        signature.arguments.set(name, kinds);
      }
      /** @param {import('@formatjs/icu-messageformat-parser').MessageFormatElement[]} children */
      function collect(children) {
        for (const element of children) {
          switch (element.type) {
            case TYPE.argument: argument(element.value, 'value'); break;
            case TYPE.number: argument(element.value, 'number'); break;
            case TYPE.date:
            case TYPE.time: argument(element.value, 'date'); break;
            case TYPE.select:
            case TYPE.plural:
              // Select dispatch uses an existing scalar's string representation.
              argument(element.value, element.type === TYPE.select ? 'value' : 'number');
              Object.values(element.options).forEach(option => collect(option.value));
              break;
            case TYPE.tag:
              signature.tags.add(element.value);
              collect(element.children);
              break;
          }
        }
      }
      collect(elements);
      for (const name of signature.arguments.keys()) {
        if (signature.tags.has(name)) {
          error('conflicting_argument_use', childPath, 'One argument has incompatible uses within this message.', name);
        }
      }
      result.messages.set(childPath, signature);
    }
  }
  visit(root, '');
  return result;
}

/** @param {Diagnostic[]} diagnostics @param {number} catalogs @param {number} sourceMessages @param {number} translatedMessages @param {number} fallbacks @returns {AuditReport} */
function report(diagnostics, catalogs, sourceMessages, translatedMessages, fallbacks) {
  const ordered = [...diagnostics].sort((a, b) => {
    const left = JSON.stringify([a.file, a.path, a.code, a.subject ?? '', a.line ?? 0, a.column ?? 0]);
    const right = JSON.stringify([b.file, b.path, b.code, b.subject ?? '', b.line ?? 0, b.column ?? 0]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const errors = ordered.filter(item => item.severity === 'error').length;
  return {
    version: 1, ok: errors === 0, catalogs, sourceMessages, translatedMessages, fallbacks,
    errors, warnings: ordered.filter(item => item.severity === 'warning').length, diagnostics: ordered,
  };
}

/**
 * Compare caller-supplied catalogs without reading files or changing inputs.
 * Paths in diagnostics are JSON Pointers, so literal dots/slashes cannot collide.
 * Missing translations are informational unless requireComplete is true.
 * @param {CatalogInput} source
 * @param {CatalogInput[]} translations
 * @param {AuditOptions} [options]
 * @returns {AuditReport}
 */
export function auditCatalogs(source, translations, options = {}) {
  const baseline = inspectCatalog(source);
  const diagnostics = [...baseline.diagnostics];
  if (baseline.validRoot && baseline.messages.size === 0 && baseline.diagnostics.length === 0) {
    diagnostics.push({severity: 'error', code: 'empty_source', file: source.file, path: '', message: 'Source catalog must contain messages.'});
  }
  let translatedMessages = 0;
  let fallbacks = 0;
  const seen = new Set([source.file]);
  for (const input of translations) {
    if (seen.has(input.file)) {
      diagnostics.push({severity: 'error', code: 'duplicate_catalog', file: input.file, path: '', message: 'Catalog path was supplied more than once.'});
      continue;
    }
    seen.add(input.file);
    const locale = inspectCatalog(input);
    diagnostics.push(...locale.diagnostics);
    if (!locale.validRoot || !baseline.validRoot) continue;
    /** @param {Severity} severity @param {string} code @param {string} path @param {string} message @param {string} [subject] */
    const add = (severity, code, path, message, subject) => diagnostics.push({
      severity, code, file: input.file, path, message, ...(subject === undefined ? {} : {subject}),
    });
    const collisions = new Set();
    for (const [path, kind] of locale.nodes) {
      const original = baseline.nodes.get(path);
      if (original && original !== kind) {
        collisions.add(path);
        add('error', 'namespace_collision', path, 'Translation changes a namespace into a message or the reverse.');
      }
    }
    /** @param {string} path */
    const collides = path => [...collisions].some(prefix => path === prefix || path.startsWith(`${prefix}/`));
    for (const [path, signature] of baseline.messages) {
      if (collides(path)) continue;
      if (!locale.nodes.has(path)) {
        fallbacks++;
        add(options.requireComplete ? 'error' : 'info', 'missing_translation', path, 'Missing translation uses the source fallback.');
        continue;
      }
      const translated = locale.messages.get(path);
      if (!translated) continue; // Its syntax/type error was already recorded.
      translatedMessages++;
      for (const [name, kinds] of signature.arguments) {
        const otherKinds = translated.arguments.get(name);
        if (!otherKinds) {
          add('error', 'missing_argument', path, 'Translation removes an argument required by the source.', name);
          continue;
        }
        // A target may use an already supplied value without formatting it.
        // Preserve explicit number/date formatting contracts. Select adds none.
        if ([...otherKinds].some(kind => kind !== 'value' && !kinds.has(kind))) {
          add('error', 'argument_type_mismatch', path, 'Translation requires an argument type absent from the source.', name);
        }
      }
      for (const name of translated.arguments.keys()) {
        if (!signature.arguments.has(name)) add('error', 'extra_argument', path, 'Translation requires an argument absent from the source.', name);
      }
      for (const name of signature.tags) {
        if (!translated.tags.has(name)) add('error', 'missing_tag', path, 'Translation removes a rich-text tag supplied by the source.', name);
      }
      for (const name of translated.tags) {
        if (!signature.tags.has(name)) add('error', 'extra_tag', path, 'Translation requires a rich-text tag absent from the source.', name);
      }
    }
    for (const path of locale.messages.keys()) {
      if (!baseline.nodes.has(path) && !collides(path)) {
        add('warning', 'orphan_translation', path, 'Translation key has no source message.');
      }
    }
  }
  return report(diagnostics, 1 + translations.length, baseline.messages.size, translatedMessages, fallbacks);
}

/**
 * Read only explicitly named files. Read failures are aggregated and never echo
 * exception contents, file contents or full ICU messages into diagnostics.
 * @param {string} sourcePath
 * @param {string[]} translationPaths
 * @param {AuditOptions} [options]
 * @returns {Promise<AuditReport>}
 */
export async function auditFiles(sourcePath, translationPaths, options = {}) {
  const paths = [sourcePath, ...translationPaths].map(path => resolve(path));
  /** @type {Diagnostic[]} */
  const failures = [];
  const inputs = await Promise.all(paths.map(async file => {
    try {
      return {file, text: await readFile(file, 'utf8')};
    } catch {
      failures.push({severity: 'error', code: 'unreadable_catalog', file, path: '', message: 'Unable to read catalog file.'});
      return {file, text: ''};
    }
  }));
  const [source, ...translations] = inputs;
  // The first path always exists in the input array, even if reading failed.
  if (!source) throw new Error('Source input is required.');
  const result = auditCatalogs(source, translations, options);
  const unreadable = new Set(failures.map(item => item.file));
  return report(
    [...result.diagnostics.filter(item => !unreadable.has(item.file)), ...failures],
    result.catalogs, result.sourceMessages, result.translatedMessages, result.fallbacks,
  );
}

const usage = 'Usage: node scripts/burn4-icu-catalog-audit.mjs --source <source.json> [--json] [--require-complete] <translation.json>...\nMissing translations are allowed by default. File paths are explicit; no directories or services are scanned.\n';

/**
 * @param {string[]} argv
 * @param {{out: (text: string) => void, err: (text: string) => void}} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {out: text => process.stdout.write(text), err: text => process.stderr.write(text)}) {
  const terminator = argv.indexOf('--');
  const flags = terminator === -1 ? argv : argv.slice(0, terminator);
  if (flags.includes('--help') || flags.includes('-h')) {
    io.out(usage);
    return 0;
  }
  let source = '';
  let requireComplete = false;
  let json = false;
  let positional = false;
  let invalid = false;
  /** @type {string[]} */
  const translations = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (positional) translations.push(arg ?? '');
    else if (arg === '--') positional = true;
    else if (arg === '--json') json = true;
    else if (arg === '--require-complete') requireComplete = true;
    else if (arg === '--source') {
      const value = argv[index + 1];
      if (source || !value || value.startsWith('-')) invalid = true;
      else {source = value; index++;}
    } else if (!arg || arg.startsWith('-')) invalid = true;
    else translations.push(arg);
  }
  if (invalid || !source || !translations.length) {
    if (json) io.out(`${JSON.stringify({error: 'invalid_arguments', usage})}\n`);
    else io.err(usage);
    return 2;
  }
  const result = await auditFiles(source, translations, {requireComplete});
  if (json) io.out(`${JSON.stringify(result, null, 2)}\n`);
  else {
    io.out(`Catalog audit: ${result.ok ? 'PASS' : 'FAIL'}; ${result.errors} errors; ${result.warnings} warnings; ${result.fallbacks} fallbacks.\n`);
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : '';
      const subject = diagnostic.subject === undefined ? '' : ` [${diagnostic.subject}]`;
      io.out(`${diagnostic.severity} ${diagnostic.code} ${diagnostic.file}${location} ${diagnostic.path || '/'}${subject}: ${diagnostic.message}\n`);
    }
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    () => { process.stderr.write('Catalog audit failed unexpectedly.\n'); process.exitCode = 2; },
  );
}
