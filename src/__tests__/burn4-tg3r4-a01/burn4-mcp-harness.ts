import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

export type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
};
export type RequestRecord = { url: string; method: string; body?: string };
export type Reply = { ok: boolean; status: number; text: () => Promise<string> };
type RegisteredTool = {
  description: string;
  schema: z.ZodRawShape;
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
};
type HarnessOptions = {
  baseUrl?: string | null;
  authenticated?: boolean;
  connectError?: Error;
  fetchReply?: (request: RequestRecord) => Reply | Promise<Reply>;
};

const source = readFileSync(resolve(__dirname, '../../..', '.mcp/src/index.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: 'index.ts',
}).outputText.replace(/^#![^\n]*\n/, '');

export function reply(data: unknown, ok = true, status = 200): Reply {
  return textReply(JSON.stringify(data), ok, status);
}
export function textReply(text: string, ok = true, status = 200): Reply {
  return { ok, status, text: async () => text };
}

export function createHarness(options: HarnessOptions = {}) {
  const tools = new Map<string, RegisteredTool>();
  const requests: RequestRecord[] = [];
  const stderr: string[] = [];
  const identities: unknown[] = [];
  const transports: unknown[] = [];
  let connections = 0;
  let transportCreations = 0;
  const replies: Array<Reply | Error | Promise<Reply>> = [];
  class FakeServer {
    constructor(identity: unknown) { identities.push(identity); }
    tool(name: string, description: string, schema: z.ZodRawShape, handler: RegisteredTool['handler']) {
      if (tools.has(name)) throw new Error(`Duplicate tool: ${name}`);
      tools.set(name, { description, schema, handler });
    }
    async connect(transport: unknown) {
      connections += 1;
      transports.push(transport);
      if (options.connectError) throw options.connectError;
    }
  }
  class FakeTransport { constructor() { transportCreations += 1; } }
  // This opaque object satisfies the startup presence guard without credential material.
  // Its empty coercion is discarded with all request headers by the fake fetch below.
  const opaquePresence = Object.freeze({ toString: () => '' });
  const fakeProcess = {
    env: {
      PRISM_BASE_URL: options.baseUrl === null ? undefined : options.baseUrl ?? 'https://offline.invalid/',
      PRISM_API_TOKEN: options.authenticated === false ? undefined : opaquePresence,
    },
    stderr: { write: (message: string) => { stderr.push(message); } },
    exit: (code: number) => { throw new Error(`Fixture exit ${code}`); },
  };
  const ready = new Script(`(async () => {${compiled}\n})()`, { filename: 'burn4-mcp-vm.js' }).runInNewContext({
    exports: {},
    require: (name: string) => {
      if (name === '@modelcontextprotocol/sdk/server/mcp.js') return { McpServer: FakeServer };
      if (name === '@modelcontextprotocol/sdk/server/stdio.js') return { StdioServerTransport: FakeTransport };
      if (name === 'zod') return { z };
      throw new Error(`Unapproved module: ${name}`);
    },
    process: fakeProcess,
    URLSearchParams,
    fetch: async (url: string, init: { method: string; body?: string }) => {
      // Do not retain or inspect headers, including authentication fields.
      const request = { url, method: init.method, body: init.body };
      requests.push(request);
      if (options.fetchReply) return options.fetchReply(request);
      const response = replies.shift() ?? reply({ accepted: true });
      if (response instanceof Error) throw response;
      return response;
    },
  }) as Promise<void>;

  function schema(name: string) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return z.object(tool.schema);
  }
  async function call(name: string, args: Record<string, unknown> = {}) {
    await ready;
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(schema(name).parse(args));
  }
  return {
    ready, tools, requests, stderr, identities, transports, schema, call,
    queue: (...values: Array<Reply | Error | Promise<Reply>>) => { replies.push(...values); },
    stats: () => ({ connections, transportCreations }),
  };
}

export function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: Error) => void;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

export const id = '11111111-1111-4111-8111-111111111111';
export const otherId = '22222222-2222-4222-8222-222222222222';
export const start = '2026-10-21T10:00:00.000Z';
export const end = '2026-10-22T10:00:00.000Z';
