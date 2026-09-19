/* eslint-disable @typescript-eslint/no-require-imports */

const {
  READY_FRAME,
  VOICE_URL,
  VoiceStreamClient,
} = require('../../../../public/voice-streaming.js') as {
  READY_FRAME: Record<string, unknown>;
  VOICE_URL: string;
  VoiceStreamClient: new (options: Record<string, unknown>) => {
    ready: boolean;
    connect(config: { url: string; token: string }): void;
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
    const socket = FakeSocket.instances[0];
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
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    socket.emit('message', frame);

    expect(client.ready).toBe(false);
    expect(socket.closed).toEqual([4002, 'unexpected_ready_frame']);
    expect(events).toEqual([{ type: 'stream.unavailable', reason: 'unexpected_ready_frame' }]);
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
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    timers[0]();

    expect(socket.closed).toEqual([4000, 'ready_timeout']);
    expect(events).toEqual([{ type: 'stream.unavailable', reason: 'ready_timeout' }]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('reports a close before ready and never reuses the single-use ticket', () => {
    const events: Array<{ type: string; reason?: string }> = [];
    const client = new VoiceStreamClient({
      WebSocketClass: FakeSocket,
      onEvent: (event: { type: string; reason?: string }) => events.push(event),
    });
    client.connect({ url: VOICE_URL, token: 'single-use-ticket' });
    const socket = FakeSocket.instances[0];
    socket.emit('open');
    socket.emit('close');

    expect(events).toEqual([{ type: 'stream.unavailable', reason: 'socket_closed' }]);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
