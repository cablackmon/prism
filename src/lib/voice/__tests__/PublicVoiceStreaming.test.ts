/* eslint-disable @typescript-eslint/no-require-imports */

const { READY_FRAME, TicketRefreshController, VOICE_URL, VoiceStreamClient } =
  require('../../../../public/voice-streaming.js') as {
    READY_FRAME: Record<string, unknown>;
    TicketRefreshController: new (options: Record<string, unknown>) => {
      attempts: number;
      request(options?: { retry?: boolean; preserveCompletedPlayback?: boolean }): boolean;
      received(requestId: string): boolean;
      reset(): void;
      takePreserveCompletedPlayback(): boolean;
    };
    VOICE_URL: string;
    VoiceStreamClient: new (options: Record<string, unknown>) => {
      ready: boolean;
      connect(
        config: { url: string; token: string },
        options?: { preserveCompletedPlayback?: boolean }
      ): void;
      begin(input: { requestId: string }): boolean;
    };
  };

class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  closed: [number | undefined, string | undefined] | null = null;
  private listeners = new Map<string, Array<(event: { data: unknown }) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = [code, reason];
    this.readyState = 3;
  }

  emit(type: string, data: unknown = '') {
    if (type === 'open') this.readyState = FakeSocket.OPEN;
    for (const listener of this.listeners.get(type) || []) listener({ data });
  }
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing test fixture: ${label}`);
  return value;
}

describe('wall VoiceStreamClient first-frame contract', () => {
  beforeEach(() => {
    FakeSocket.instances.length = 0;
  });

  it('accepts only the complete contract-v1 ready frame', () => {
    const events: Array<{ type: string }> = [];
    const client = new VoiceStreamClient({
      WebSocketClass: FakeSocket,
      onEvent: (event: { type: string }) => events.push(event),
    });
    client.connect({ url: VOICE_URL, token: 'opaque-ticket' });
    const socket = required(FakeSocket.instances[0], 'initial socket');
    socket.emit('open');
    socket.emit('message', JSON.stringify(READY_FRAME));

    expect(client.ready).toBe(true);
    expect(events).toEqual([READY_FRAME]);
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: 'auth',
      token: 'opaque-ticket',
    });
  });

  it.each([
    ['incomplete', JSON.stringify({ type: 'ready' })],
    ['extra-field', JSON.stringify({ ...READY_FRAME, extra: true })],
    ['malformed', 'not-json'],
    ['binary', new ArrayBuffer(4)],
  ])('rejects an %s first frame without exposing it', (_label, frame) => {
    const events: Array<{ type: string; reason?: string }> = [];
    const client = new VoiceStreamClient({
      WebSocketClass: FakeSocket,
      onEvent: (event: { type: string; reason?: string }) => events.push(event),
    });
    client.connect({ url: VOICE_URL, token: 'opaque-ticket' });
    const socket = required(FakeSocket.instances[0], 'rejected socket');
    socket.emit('open');
    socket.emit('message', frame);

    expect(client.ready).toBe(false);
    expect(socket.closed).toEqual([4002, 'unexpected_ready_frame']);
    expect(events).toEqual([
      {
        type: 'stream.unavailable',
        reason: 'unexpected_ready_frame',
        preserveCompletedPlayback: false,
      },
    ]);
  });

  it('closes on ready timeout and never reuses the single-use ticket', () => {
    const timers: Array<() => void> = [];
    const events: Array<{ type: string; reason?: string }> = [];
    const client = new VoiceStreamClient({
      WebSocketClass: FakeSocket,
      setTimer: (handler: () => void) => {
        timers.push(handler);
        return timers.length;
      },
      clearTimer: () => undefined,
      onEvent: (event: { type: string; reason?: string }) => events.push(event),
    });
    client.connect({ url: VOICE_URL, token: 'single-use-ticket' });
    const socket = required(FakeSocket.instances[0], 'timed-out socket');
    socket.emit('open');
    required(timers[0], 'ready timer')();

    expect(socket.closed).toEqual([4000, 'ready_timeout']);
    expect(events).toEqual([
      {
        type: 'stream.unavailable',
        reason: 'ready_timeout',
        preserveCompletedPlayback: false,
      },
    ]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('closes when the socket handshake never opens', () => {
    const timers: Array<() => void> = [];
    const events: Array<{ type: string; reason?: string }> = [];
    const client = new VoiceStreamClient({
      WebSocketClass: FakeSocket,
      setTimer: (handler: () => void) => {
        timers.push(handler);
        return timers.length;
      },
      clearTimer: () => undefined,
      onEvent: (event: { type: string; reason?: string }) => events.push(event),
    });
    client.connect({ url: VOICE_URL, token: 'single-use-ticket' });
    const socket = required(FakeSocket.instances[0], 'connecting socket');
    required(timers[0], 'connection timer')();

    expect(socket.closed).toEqual([4000, 'connect_timeout']);
    expect(events).toEqual([
      {
        type: 'stream.unavailable',
        reason: 'connect_timeout',
        preserveCompletedPlayback: false,
      },
    ]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('reports a close before ready and never reuses the single-use ticket', () => {
    const events: Array<{ type: string; reason?: string }> = [];
    const client = new VoiceStreamClient({
      WebSocketClass: FakeSocket,
      onEvent: (event: { type: string; reason?: string }) => events.push(event),
    });
    client.connect({ url: VOICE_URL, token: 'single-use-ticket' });
    const socket = required(FakeSocket.instances[0], 'closed socket');
    socket.emit('open');
    socket.emit('close');

    expect(events).toEqual([
      {
        type: 'stream.unavailable',
        reason: 'socket_closed',
        preserveCompletedPlayback: false,
      },
    ]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('marks completed playback for preservation when a ready socket closes', () => {
    const events: Array<Record<string, unknown>> = [];
    const client = new VoiceStreamClient({
      WebSocketClass: FakeSocket,
      playAudio: () => undefined,
      onEvent: (event: Record<string, unknown>) => events.push(event),
    });
    client.connect({ url: VOICE_URL, token: 'opaque-ticket' });
    const socket = required(FakeSocket.instances[0], 'completed socket');
    socket.emit('open');
    socket.emit('message', JSON.stringify(READY_FRAME));
    client.begin({ requestId: 'completed-turn' });
    socket.emit(
      'message',
      JSON.stringify({ type: 'audio.start', requestId: 'completed-turn', format: 'pcm16' })
    );
    socket.emit('message', new ArrayBuffer(2));
    socket.emit('message', JSON.stringify({ type: 'complete', requestId: 'completed-turn' }));
    socket.emit('close');

    expect(events.at(-1)).toEqual({
      type: 'stream.closed',
      preserveCompletedPlayback: true,
    });

    client.connect({ url: VOICE_URL, token: 'fresh-ticket' }, { preserveCompletedPlayback: true });
    const replacement = required(FakeSocket.instances[1], 'replacement socket');
    replacement.emit('open');
    replacement.emit('close');
    expect(events.at(-1)).toEqual({
      type: 'stream.unavailable',
      reason: 'socket_closed',
      preserveCompletedPlayback: true,
    });
  });
});

describe('wall ticket refresh policy', () => {
  it('backs off and stops after three fresh-ticket requests', () => {
    const requests: string[] = [];
    const timers: Array<{ handler: () => void; delay: number }> = [];
    const refresh = new TicketRefreshController({
      onRequest: (requestId: string) => requests.push(requestId),
      setTimer: (handler: () => void, delay: number) => {
        timers.push({ handler, delay });
        return timers.length;
      },
      clearTimer: () => undefined,
    });

    expect(refresh.request()).toBe(true);
    expect(requests).toHaveLength(1);
    expect(refresh.received(requests.at(-1)!)).toBe(true);
    expect(refresh.request({ retry: true })).toBe(true);
    expect(required(timers[1], 'first backoff').delay).toBe(500);
    required(timers[1], 'first backoff').handler();
    expect(refresh.received(requests.at(-1)!)).toBe(true);
    expect(refresh.request({ retry: true })).toBe(true);
    expect(required(timers[3], 'second backoff').delay).toBe(1_000);
    required(timers[3], 'second backoff').handler();
    expect(refresh.received(requests.at(-1)!)).toBe(true);
    expect(refresh.request({ retry: true })).toBe(false);
    expect(requests).toHaveLength(3);
    expect(refresh.attempts).toBe(3);
  });

  it('times out unanswered requests and exhausts after bounded retries', () => {
    const requests: string[] = [];
    const timers: Array<{ handler: () => void; delay: number }> = [];
    const exhausted = jest.fn();
    const refresh = new TicketRefreshController({
      onRequest: (requestId: string) => requests.push(requestId),
      onExhausted: exhausted,
      setTimer: (handler: () => void, delay: number) => {
        timers.push({ handler, delay });
        return timers.length;
      },
      clearTimer: () => undefined,
    });

    refresh.request();
    expect(required(timers[0], 'first response timeout').delay).toBe(3_000);
    required(timers[0], 'first response timeout').handler();
    expect(required(timers[1], 'first retry delay').delay).toBe(500);
    required(timers[1], 'first retry delay').handler();
    required(timers[2], 'second response timeout').handler();
    expect(required(timers[3], 'second retry delay').delay).toBe(1_000);
    required(timers[3], 'second retry delay').handler();
    required(timers[4], 'third response timeout').handler();

    expect(requests).toHaveLength(3);
    expect(exhausted).toHaveBeenCalledTimes(1);
  });

  it('rejects a delayed response from an expired request generation', () => {
    const requests: string[] = [];
    const timers: Array<{ handler: () => void; delay: number }> = [];
    const refresh = new TicketRefreshController({
      onRequest: (requestId: string) => requests.push(requestId),
      setTimer: (handler: () => void, delay: number) => {
        timers.push({ handler, delay });
        return timers.length;
      },
      clearTimer: () => undefined,
    });

    refresh.request();
    const expiredRequestId = required(requests[0], 'expired request id');
    required(timers[0], 'expired request timeout').handler();
    required(timers[1], 'replacement request delay').handler();
    const currentRequestId = required(requests[1], 'current request id');

    expect(refresh.received(currentRequestId)).toBe(true);
    expect(refresh.received(expiredRequestId)).toBe(false);
  });

  it('preserves completed playback across refresh and resets after ready', () => {
    let requestId = '';
    const refresh = new TicketRefreshController({
      onRequest: (value: string) => {
        requestId = value;
      },
    });
    refresh.request();
    refresh.received(requestId);
    refresh.request({ retry: true, preserveCompletedPlayback: true });

    expect(refresh.takePreserveCompletedPlayback()).toBe(true);
    expect(refresh.takePreserveCompletedPlayback()).toBe(false);
    refresh.reset();
    expect(refresh.attempts).toBe(0);
  });
});
