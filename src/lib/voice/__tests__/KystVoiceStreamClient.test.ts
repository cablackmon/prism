import {
  KystVoiceStreamClient,
  pcm16FromFloat32,
  VOICE_SOCKET_URL,
  type VoiceSocket,
} from '../KystVoiceStreamClient';

class FakeSocket implements VoiceSocket {
  binaryType = '';
  readyState = 0;
  sent: Array<string | ArrayBuffer> = [];
  closed: [number | undefined, string | undefined] | null = null;
  private listeners = new Map<string, Array<(event: { data: string | ArrayBuffer }) => void>>();

  addEventListener(type: string, listener: (event: { data: string | ArrayBuffer }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = [code, reason];
    this.readyState = 3;
  }

  emit(type: string, data: string | ArrayBuffer = '') {
    if (type === 'open') this.readyState = 1;
    for (const listener of this.listeners.get(type) || []) listener({ data });
  }
}

describe('KystVoiceStreamClient', () => {
  it('authenticates once and carries a turn on the same socket', async () => {
    const socket = new FakeSocket();
    const events: string[] = [];
    const audio: ArrayBuffer[] = [];
    const client = new KystVoiceStreamClient({
      fetchTicket: async () => ({ url: VOICE_SOCKET_URL, token: 'signed-ticket' }),
      createSocket: () => socket,
      onEvent: (event) => events.push(event.type),
      onAudio: (chunk) => audio.push(chunk),
    });

    const connection = client.connect();
    await new Promise((resolve) => setImmediate(resolve));
    socket.emit('open');
    expect(JSON.parse(socket.sent[0] as string)).toEqual({ type: 'auth', token: 'signed-ticket' });
    socket.emit('message', JSON.stringify({ type: 'ready', contract: 1 }));
    await connection;

    expect(client.startTurn('request-1')).toBe(true);
    const pcm = new ArrayBuffer(8);
    expect(client.sendAudio(pcm)).toBe(true);
    expect(client.endTurn()).toBe(true);
    socket.emit(
      'message',
      JSON.stringify({ type: 'transcript.delta', requestId: 'request-1', text: 'hello' })
    );
    socket.emit(
      'message',
      JSON.stringify({ type: 'audio.start', requestId: 'request-1', format: 'pcm16' })
    );
    socket.emit('message', new ArrayBuffer(12));
    expect(client.playbackStarted('request-1')).toBe(true);
    socket.emit('message', JSON.stringify({ type: 'complete', requestId: 'request-1' }));

    expect(events).toEqual(['ready', 'transcript.delta', 'audio.start', 'complete']);
    expect(audio).toHaveLength(1);
    expect(socket.sent).toEqual([
      JSON.stringify({ type: 'auth', token: 'signed-ticket' }),
      JSON.stringify({
        type: 'start',
        requestId: 'request-1',
        format: 'pcm16',
        rate: 16000,
        channels: 1,
      }),
      pcm,
      JSON.stringify({ type: 'end_of_speech', requestId: 'request-1' }),
      JSON.stringify({ type: 'playback.started', requestId: 'request-1' }),
    ]);
  });

  it('acknowledges the complete Phase 1 action-state contract', async () => {
    const socket = new FakeSocket();
    const client = new KystVoiceStreamClient({
      fetchTicket: async () => ({ url: VOICE_SOCKET_URL, token: 'ticket' }),
      createSocket: () => socket,
    });
    const connection = client.connect();
    await new Promise((resolve) => setImmediate(resolve));
    socket.emit('open');
    socket.emit('message', JSON.stringify({ type: 'ready' }));
    await connection;
    client.startTurn('request-action');

    for (const type of ['action.state', 'action.started', 'action.commit', 'action.start_failed']) {
      socket.emit('message', JSON.stringify({ type, requestId: 'request-action' }));
    }

    expect(socket.sent.slice(-4).map((message) => JSON.parse(message as string))).toEqual([
      { type: 'action.state.ack', requestId: 'request-action' },
      { type: 'action.started.ack', requestId: 'request-action' },
      { type: 'action.committed.ack', requestId: 'request-action' },
      { type: 'action.start_failed.ack', requestId: 'request-action' },
    ]);
    expect(client.playbackStarted('another-request')).toBe(false);
  });

  it('preserves request id spelling for cancel controls', async () => {
    const socket = new FakeSocket();
    const client = new KystVoiceStreamClient({
      fetchTicket: async () => ({ url: VOICE_SOCKET_URL, token: 'ticket' }),
      createSocket: () => socket,
    });
    const connection = client.connect();
    await new Promise((resolve) => setImmediate(resolve));
    socket.emit('open');
    socket.emit('message', JSON.stringify({ type: 'ready' }));
    await connection;

    const requestId = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
    client.startTurn(requestId);
    client.cancelTurn();

    expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({
      type: 'cancel',
      requestId,
      reason: 'barge_in',
    });
  });

  it('rejects an unexpected socket endpoint before connecting', async () => {
    const createSocket = jest.fn();
    const client = new KystVoiceStreamClient({
      fetchTicket: async () => ({ url: 'wss://evil.example/voice', token: 'ticket' }),
      createSocket,
    });

    await expect(client.connect()).rejects.toThrow('invalid voice connection');
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('accepts binary audio only after audio.start for the active request', async () => {
    const socket = new FakeSocket();
    const received: string[] = [];
    const client = new KystVoiceStreamClient({
      fetchTicket: async () => ({ url: VOICE_SOCKET_URL, token: 'ticket' }),
      createSocket: () => socket,
      onAudio: (_chunk, requestId) => received.push(requestId),
    });
    const connection = client.connect();
    await new Promise((resolve) => setImmediate(resolve));
    socket.emit('open');
    socket.emit('message', JSON.stringify({ type: 'ready' }));
    await connection;

    client.startTurn('request-old');
    socket.emit(
      'message',
      JSON.stringify({ type: 'audio.start', requestId: 'request-old', format: 'pcm16' })
    );
    client.cancelTurn();
    client.startTurn('request-new');
    socket.emit('message', new ArrayBuffer(4));
    socket.emit(
      'message',
      JSON.stringify({ type: 'audio.start', requestId: 'request-old', format: 'pcm16' })
    );
    socket.emit('message', new ArrayBuffer(4));
    socket.emit(
      'message',
      JSON.stringify({ type: 'audio.start', requestId: 'request-new', format: 'pcm16' })
    );
    socket.emit('message', new ArrayBuffer(4));

    expect(received).toEqual(['request-new']);
    client.cancelTurn('test_complete');
  });

  it('fails a turn that receives no response after end_of_speech', async () => {
    jest.useFakeTimers();
    const socket = new FakeSocket();
    const events: Array<{ type: string; reason?: string }> = [];
    const client = new KystVoiceStreamClient({
      fetchTicket: async () => ({ url: VOICE_SOCKET_URL, token: 'ticket' }),
      createSocket: () => socket,
      onEvent: (event) => events.push(event),
    });
    const connection = client.connect();
    await Promise.resolve();
    socket.emit('open');
    socket.emit('message', JSON.stringify({ type: 'ready' }));
    await connection;

    client.startTurn('request-timeout');
    client.endTurn();
    jest.advanceTimersByTime(6_000);

    expect(events.at(-1)).toEqual({
      type: 'error',
      requestId: 'request-timeout',
      reason: 'first_audio_timeout',
    });
    expect(client.active).toBeNull();
    jest.useRealTimers();
  });

  it('does not create a socket when disconnect invalidates a pending ticket request', async () => {
    let resolveTicket: ((ticket: { url: string; token: string }) => void) | undefined;
    const ticket = new Promise<{ url: string; token: string }>((resolve) => {
      resolveTicket = resolve;
    });
    const createSocket = jest.fn();
    const client = new KystVoiceStreamClient({
      fetchTicket: () => ticket,
      createSocket,
    });

    const connection = client.connect();
    client.disconnect('unmount');
    resolveTicket?.({ url: VOICE_SOCKET_URL, token: 'ticket' });

    await expect(connection).rejects.toThrow('cancelled');
    expect(createSocket).not.toHaveBeenCalled();
  });
});

describe('pcm16FromFloat32', () => {
  it('clamps and converts 16 kHz samples', () => {
    const output = new Int16Array(
      pcm16FromFloat32(new Float32Array([-2, -1, 0, 0.5, 1, 2]), 16_000)
    );
    expect(Array.from(output)).toEqual([-32768, -32768, 0, 16384, 32767, 32767]);
  });

  it('resamples 48 kHz input to 16 kHz', () => {
    const output = new Int16Array(pcm16FromFloat32(new Float32Array([1, 1, 1, 0, 0, 0]), 48_000));
    expect(output).toHaveLength(2);
    expect(output[0]).toBe(32767);
    expect(output[1]).toBe(0);
  });
});
