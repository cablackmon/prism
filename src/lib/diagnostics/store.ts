/** Fixed NOX-11625 collector. Persistent single-machine volume; no stale-lock takeover. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const operationNames = [
  'measure',
  'scroll',
  'bootstrap',
  'identity-frame',
  'scrolled-frame',
  'restored-frame',
  'classic-frame',
  'nox-frame',
] as const;
const id = z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const geometry = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    dpr: z.number().positive(),
    scale: z.number().positive(),
  })
  .strict();
const fixed = {
  bootstrap: 'nox11625-diagnostic-load',
  'identity-frame': 'nox11625-diagnostic-identity-frame',
  'scrolled-frame': 'nox11625-final-scroll-frame',
  'restored-frame': 'nox11625-final-restored-frame',
  'classic-frame': 'nox11625-final-classic-frame',
  'nox-frame': 'nox11625-final-nox-frame',
};
export type Operation = (typeof operationNames)[number];
type Grant = {
  id: string;
  operation: Operation;
  issuedAt: number;
  deadline: number;
  delivered?: boolean;
  published?: boolean;
  status: string;
  result?: Record<string, unknown>;
};
type Renderer = {
  document: string;
  cookieHash: string;
  challenge: string;
  origin: string;
  geometry: z.infer<typeof geometry>;
  ready?: Record<string, unknown>;
  verified?: Record<string, unknown>;
};
type State = {
  session: string;
  build: string;
  probe: string;
  created: number;
  expires: number;
  disabled?: boolean;
  renderer?: Renderer;
  grants: Partial<Record<Operation, Grant>>;
  active?: Operation;
  captureWindow?: { from: number; until: number };
  capture?: Record<string, unknown>;
};
export class Refusal extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message);
  }
}
function refuse(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Refusal(message);
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const nonce = () => randomBytes(24).toString('hex');
export class Collector {
  constructor(
    private directory: string,
    public build: string,
    public probe: string,
    public origin: string,
    private now = () => Date.now()
  ) {}
  private transact<T>(fn: (state: State | undefined) => { state?: State; value: T }): T {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, 'transaction.lock');
    let fd: number;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
    } catch {
      throw new Refusal('Collector busy or interrupted; reconcile, never retry an operation');
    }
    try {
      const file = path.join(this.directory, 'session.json');
      let state: State | undefined;
      try {
        state = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const result = fn(state);
      if (result.state) {
        const temp = path.join(this.directory, 'session.next');
        const f = fs.openSync(temp, 'wx', 0o600);
        try {
          fs.writeFileSync(f, JSON.stringify(result.state));
          fs.fsyncSync(f);
        } finally {
          fs.closeSync(f);
        }
        fs.renameSync(temp, file);
        const d = fs.openSync(this.directory, 'r');
        try {
          fs.fsyncSync(d);
        } finally {
          fs.closeSync(d);
        }
      }
      return result.value;
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
  handle(raw: unknown, operator: boolean, cookieHash: string): unknown {
    const request = z
      .object({
        action: z.string(),
        session: id,
        document: id.optional(),
        body: z.record(z.unknown()).default({}),
      })
      .strict()
      .parse(raw);
    return this.transact<unknown>((state) => {
      const b = request.body,
        t = this.now();
      if (request.action === 'begin') {
        refuse(operator, 'Operator required');
        refuse(!state, 'Mission session already exists; no replacement');
        const v = z.object({ expires: z.number(), build: hash, probe: hash }).strict().parse(b);
        refuse(v.expires > t && v.expires <= t + 45 * 60_000, 'Session maximum45minutes');
        refuse(v.build === this.build && v.probe === this.probe, 'Wrong build/probe');
        const s: State = {
          session: request.session,
          build: this.build,
          probe: this.probe,
          created: t,
          expires: v.expires,
          grants: {},
        };
        return { state: s, value: s };
      }
      refuse(state && state.session === request.session, 'Wrong session');
      const s = state;
      refuse(s.build === this.build && s.probe === this.probe, 'Build changed; no continuation');
      const live = !s.disabled && t < s.expires;
      if (request.action === 'status') {
        refuse(operator, 'Operator required');
        return { value: s };
      }
      if (request.action === 'disable') {
        refuse(operator, 'Operator required');
        s.disabled = true;
        return { state: s, value: { disabled: true, active: s.active || null } };
      }
      // Terminal reports remain admissible after expiry/disable; effects never do.
      if (!['terminal', 'capture-terminal'].includes(request.action))
        refuse(live, 'Expired/disabled session');
      if (request.action === 'claim') {
        refuse(!operator && cookieHash, 'Browser cookie required');
        refuse(!s.renderer, 'Renderer already claimed; no replacement');
        const v = z
          .object({
            origin: z.string(),
            build: hash,
            probe: hash,
            geometry,
            iframe: z.literal(true),
            pathname: z.literal('/'),
          })
          .strict()
          .parse(b);
        refuse(
          v.origin === this.origin && v.build === s.build && v.probe === s.probe,
          'Wrong renderer origin/build/probe'
        );
        refuse(request.document, 'Document required');
        s.renderer = {
          document: request.document,
          cookieHash,
          origin: v.origin,
          geometry: v.geometry,
          challenge: nonce(),
        };
        return { state: s, value: { challenge: s.renderer.challenge, expires: s.expires } };
      }
      if (request.action === 'verify') {
        refuse(operator && s.renderer && s.renderer.ready, 'Ready renderer and operator required');
        const v = z
          .object({
            challenge: id,
            document: id,
            identityReceipt: hash,
            frame: hash,
            pid: z.number().int().positive(),
            createdTicks: z.string().regex(/^\d+$/),
            session: z.literal(1),
            width: z.literal(3840),
            height: z.literal(2160),
          })
          .strict()
          .parse(b);
        refuse(
          v.document === s.renderer.document && v.challenge === s.renderer.challenge,
          'Wrong renderer challenge'
        );
        const g = s.grants['identity-frame'];
        refuse(
          g?.status === 'terminal' && g.result?.sha256 === v.frame,
          'Identity frame not correlated'
        );
        refuse(!s.renderer.verified, 'Renderer already verified');
        s.renderer.verified = { ...v, at: t };
        return { state: s, value: { verified: true } };
      }
      if (request.action === 'arm') {
        refuse(operator, 'Operator required');
        const v = z
          .object({ operation: z.enum(operationNames) })
          .strict()
          .parse(b);
        const op = v.operation;
        refuse(!s.grants[op], 'Operation permanently consumed');
        const duringScroll =
          op === 'scrolled-frame' &&
          s.active === 'scroll' &&
          s.captureWindow &&
          t < s.captureWindow.until;
        refuse(!s.active || duringScroll, 'Another operation is active/ambiguous');
        if (op === 'bootstrap')
          refuse(
            !s.renderer && Object.keys(s.grants).length === 0,
            'Bootstrap must precede renderer'
          );
        else if (op === 'identity-frame')
          refuse(
            s.renderer?.ready && s.grants.bootstrap?.status === 'terminal',
            'Bootstrap/ready prerequisite'
          );
        else refuse(s.renderer?.verified, 'Exact renderer unverified');
        if (op === 'scroll')
          refuse(
            s.grants.measure?.status === 'terminal' &&
              s.grants.measure.result?.restoreVerified === true &&
              s.grants.measure.result?.ok === true,
            'Measurement not restored'
          );
        if (op === 'restored-frame')
          refuse(
            s.grants.scroll?.status === 'terminal' &&
              s.grants.scroll.result?.restoreVerified === true,
            'Scroll not restored'
          );
        if (op === 'scrolled-frame') refuse(duringScroll, 'No active capture window');
        const seconds = op === 'scroll' ? 75 : op === 'measure' ? 20 : 15;
        refuse(s.expires - t >= seconds * 1000, 'Insufficient session time');
        const g: Grant = {
          id: nonce(),
          operation: op,
          issuedAt: t,
          deadline: t + 10_000,
          status: 'issued',
        };
        s.grants[op] = g;
        if (!duringScroll) s.active = op;
        // Native grant consumed here BEFORE queue publication. A lost response cannot be reissued.
        return {
          state: s,
          value: { ...g, commandId: op in fixed ? fixed[op as keyof typeof fixed] : undefined },
        };
      }
      if (request.action === 'publish') {
        refuse(operator, 'Operator required');
        const v = z
          .object({
            operation: z.enum([
              'bootstrap',
              'identity-frame',
              'scrolled-frame',
              'restored-frame',
              'classic-frame',
              'nox-frame',
            ]),
            grant: id,
          })
          .strict()
          .parse(b);
        const g = s.grants[v.operation];
        refuse(
          g && g.id === v.grant && !g.published && g.status === 'issued' && t < g.deadline,
          'Native publication consumed/expired'
        );
        if (v.operation === 'scrolled-frame')
          refuse(
            s.active === 'scroll' && s.captureWindow && t < s.captureWindow.until,
            'Capture window closed'
          );
        g.published = true;
        return { state: s, value: { commandId: fixed[v.operation], grant: g.id, publishedAt: t } };
      }
      if (request.action === 'capture-terminal') {
        refuse(operator, 'Operator required');
        const v = z
          .object({
            operation: z.enum([
              'bootstrap',
              'identity-frame',
              'scrolled-frame',
              'restored-frame',
              'classic-frame',
              'nox-frame',
            ]),
            grant: id,
            ok: z.boolean(),
            sha256: hash.optional(),
            width: z.number().optional(),
            height: z.number().optional(),
            capturedAt: z.number().optional(),
            commandReceipt: hash,
            error: z.string().max(1000).optional(),
          })
          .strict()
          .parse(b);
        const g = s.grants[v.operation];
        refuse(
          g && g.id === v.grant && g.published && g.status === 'issued',
          'Wrong/terminal native issuance'
        );
        if (v.ok) {
          refuse(
            v.operation === 'bootstrap' ||
              (v.width === 3840 &&
                v.height === 2160 &&
                v.sha256 &&
                v.capturedAt &&
                v.capturedAt >= g.issuedAt &&
                v.capturedAt <= t),
            'Invalid native receipt'
          );
        }
        g.status = 'terminal';
        g.result = v;
        if (v.operation === 'scrolled-frame') {
          refuse(
            ['scroll', 'scrolled-frame'].includes(s.active || '') && s.captureWindow,
            'No scroll owner'
          );
          if (
            v.ok &&
            v.capturedAt! >= s.captureWindow.from &&
            v.capturedAt! <= s.captureWindow.until &&
            live &&
            t < s.captureWindow.until
          )
            s.capture = {
              commandId: fixed['scrolled-frame'],
              sha256: v.sha256,
              width: v.width,
              height: v.height,
              grant: g.id,
            };
          else
            g.result = {
              ...v,
              ok: false,
              error: 'Missing/late capture; scroll cleanup must still settle',
            };
          if (s.active === 'scrolled-frame') s.active = undefined;
        } else if (s.active === v.operation) {
          if (v.ok) s.active = undefined; /* uncertain native outcome blocks continuation */
        }
        return { state: s, value: g };
      }
      const r = s.renderer;
      refuse(
        !operator && r && request.document === r.document && cookieHash === r.cookieHash,
        'Wrong browser document/session'
      );
      if (request.action === 'ready') {
        refuse(!r.ready, 'Ready already recorded');
        r.ready = z
          .object({ initial: geometry, widgets: z.literal(7) })
          .strict()
          .parse(b);
        refuse(
          JSON.stringify((r.ready as { initial: unknown }).initial) === JSON.stringify(r.geometry),
          'Geometry drift'
        );
        return { state: s, value: { ready: true } };
      }
      if (request.action === 'poll') {
        const g = s.active ? s.grants[s.active] : undefined;
        if (g && ['measure', 'scroll'].includes(g.operation) && !g.delivered) {
          refuse(t < g.deadline, 'Grant delivery expired; no retry');
          g.delivered = true;
          return { state: s, value: { grant: g } };
        }
        return { value: { capture: s.capture || null, verified: !!s.renderer?.verified } };
      }
      if (request.action === 'window') {
        const v = z.object({ grant: id, from: z.number(), until: z.number() }).strict().parse(b);
        const g = s.grants.scroll;
        refuse(
          s.active === 'scroll' && g?.id === v.grant && g.delivered && !s.captureWindow,
          'Wrong/duplicate scroll window'
        );
        refuse(
          v.from >= g.issuedAt &&
            Math.abs(v.from - t) < 5000 &&
            v.until > t &&
            v.until <= v.from + 60_000 &&
            v.until < s.expires,
          'Capture window mismatch'
        );
        s.captureWindow = { from: v.from, until: v.until };
        return { state: s, value: { accepted: true } };
      }
      if (request.action === 'terminal') {
        const v = z
          .object({
            operation: z.enum(['measure', 'scroll']),
            grant: id,
            result: z.record(z.unknown()),
          })
          .strict()
          .parse(b);
        const g = s.grants[v.operation];
        refuse(
          s.active === v.operation && g?.id === v.grant && g.delivered && g.status === 'issued',
          'Wrong/duplicate terminal'
        );
        refuse(
          v.result.phase === 'terminal' &&
            typeof v.result.restoreVerified === 'boolean' &&
            typeof v.result.ok === 'boolean',
          'Incomplete cleanup report'
        );
        g.status = 'terminal';
        g.result = v.result;
        s.active = s.grants['scrolled-frame']?.status === 'issued' ? 'scrolled-frame' : undefined;
        return { state: s, value: { recorded: true, expired: !live } };
      }
      throw new Refusal('Unknown fixed action', 400);
    });
  }
  config() {
    return this.transact((s) => ({
      value:
        s && !s.disabled && this.now() < s.expires
          ? {
              session: s.session,
              build: s.build,
              probe: s.probe,
              expires: s.expires,
              origin: this.origin,
            }
          : null,
    }));
  }
}
