export const VOICE_SOCKET_URL = 'wss://cb-threadripper.tail3a8e2d.ts.net:8445/voice';
export const VOICE_SAMPLE_RATE = 16_000;
const RESPONSE_TIMEOUT_MS = 6_000;

export type VoiceTicket = {
  url: string;
  token: string;
  expiresAt?: string;
};

export type VoiceStreamEvent = {
  type: string;
  requestId?: string;
  text?: string;
  reason?: string;
  format?: string;
  final?: boolean;
  emptyTranscript?: boolean;
  [key: string]: unknown;
};

const ACTION_ACKS: Record<string, string> = {
  'action.state': 'action.state.ack',
  'action.started': 'action.started.ack',
  'action.commit': 'action.committed.ack',
  'action.start_failed': 'action.start_failed.ack',
};

type SocketEvent = { data: string | ArrayBuffer };
type SocketListener = (event: SocketEvent) => void;
type TimerId = ReturnType<typeof globalThis.setTimeout>;

export type VoiceSocket = {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: SocketListener): void;
};

type ClientOptions = {
  fetchTicket?: () => Promise<VoiceTicket>;
  createSocket?: (url: string) => VoiceSocket;
  onEvent?: (event: VoiceStreamEvent) => void;
  onAudio?: (audio: ArrayBuffer, requestId: string) => void;
  setTimer?: (handler: () => void, timeout: number) => TimerId;
  clearTimer?: (timer: TimerId) => void;
};

export type ResampleState = {
  tail?: Float32Array;
  position?: number;
};

export function pcm16FromFloat32(
  input: Float32Array,
  inputRate: number,
  state: ResampleState = {}
): ArrayBuffer {
  const ratio = inputRate / VOICE_SAMPLE_RATE;
  const tail = state.tail || new Float32Array(0);
  const samples = new Float32Array(tail.length + input.length);
  samples.set(tail);
  samples.set(input, tail.length);
  const position = state.position || 0;
  const length = Math.max(0, Math.floor((samples.length - position) / ratio));
  const output = new Int16Array(length);

  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(position + index * ratio);
    const end = Math.max(start + 1, Math.floor(position + (index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor < end && cursor < samples.length; cursor += 1) {
      sum += samples[cursor] ?? 0;
      count += 1;
    }
    const sample = Math.max(-1, Math.min(1, count ? sum / count : 0));
    output[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }

  const nextPosition = position + length * ratio;
  const consumed = Math.floor(nextPosition);
  state.tail = samples.slice(consumed);
  state.position = nextPosition - consumed;
  return output.buffer;
}

export async function fetchVoiceTicket(): Promise<VoiceTicket> {
  const response = await fetch('/api/nox-voice/ticket', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? 'Sign in to the board before asking NOX.'
        : response.status === 429
          ? 'Too many voice connections. Try again in a minute.'
          : 'NOX voice is not ready yet.'
    );
  }
  const ticket = (await response.json()) as Partial<VoiceTicket>;
  if (ticket.url !== VOICE_SOCKET_URL || typeof ticket.token !== 'string' || !ticket.token) {
    throw new Error('NOX returned an invalid voice connection.');
  }
  return ticket as VoiceTicket;
}

export class KystVoiceStreamClient {
  private readonly fetchTicket: () => Promise<VoiceTicket>;
  private readonly createSocket: (url: string) => VoiceSocket;
  private readonly onEvent: (event: VoiceStreamEvent) => void;
  private readonly onAudio: (audio: ArrayBuffer, requestId: string) => void;
  private readonly setTimer: (handler: () => void, timeout: number) => TimerId;
  private readonly clearTimer: (timer: TimerId) => void;
  private socket: VoiceSocket | null = null;
  private connecting: Promise<void> | null = null;
  private connectionGeneration = 0;
  private authenticated = false;
  private activeRequestId: string | null = null;
  private audioRequestId: string | null = null;
  private responseTimer: TimerId | null = null;
  private ended = false;

  constructor(options: ClientOptions = {}) {
    this.fetchTicket = options.fetchTicket || fetchVoiceTicket;
    this.createSocket =
      options.createSocket || ((url) => new WebSocket(url) as unknown as VoiceSocket);
    this.onEvent = options.onEvent || (() => undefined);
    this.onAudio = options.onAudio || (() => undefined);
    this.setTimer = options.setTimer || globalThis.setTimeout.bind(globalThis);
    this.clearTimer = options.clearTimer || globalThis.clearTimeout.bind(globalThis);
  }

  get ready() {
    return this.authenticated && this.socket?.readyState === 1;
  }

  get active() {
    return this.activeRequestId;
  }

  connect(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const generation = ++this.connectionGeneration;
    const connecting = this.openFreshSocket(generation).finally(() => {
      if (this.connecting === connecting) this.connecting = null;
    });
    this.connecting = connecting;
    return connecting;
  }

  private async openFreshSocket(generation: number) {
    const ticket = await this.fetchTicket();
    if (generation !== this.connectionGeneration) {
      throw new Error('NOX voice connection was cancelled.');
    }
    if (ticket.url !== VOICE_SOCKET_URL || !ticket.token) {
      throw new Error('NOX returned an invalid voice connection.');
    }
    this.closeSocket('reconnect');
    const socket = this.createSocket(ticket.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = this.setTimer(() => {
        if (settled) return;
        settled = true;
        socket.close(4000, 'ready_timeout');
        reject(new Error('NOX voice connection timed out.'));
      }, 4_000);

      const failBeforeReady = (message: string) => {
        if (settled) return;
        settled = true;
        this.clearTimer(timeout);
        reject(new Error(message));
      };

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'auth', token: ticket.token }));
      });
      socket.addEventListener('message', (event) => {
        if (this.socket !== socket) return;
        if (typeof event.data !== 'string') {
          if (this.activeRequestId && this.audioRequestId === this.activeRequestId) {
            this.armResponseTimeout('audio_idle_timeout');
            this.onAudio(event.data, this.audioRequestId);
          }
          return;
        }
        let message: VoiceStreamEvent;
        try {
          message = JSON.parse(event.data) as VoiceStreamEvent;
        } catch {
          return;
        }
        if (message.type === 'ready') {
          this.authenticated = true;
          this.clearTimer(timeout);
          if (!settled) {
            settled = true;
            resolve();
          }
          this.onEvent(message);
          return;
        }
        this.handleControl(message);
      });
      socket.addEventListener('error', () => {
        if (!this.authenticated) failBeforeReady('NOX voice connection failed.');
        else this.failActive('socket_error');
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.authenticated = false;
        if (!settled) failBeforeReady('NOX voice connection closed.');
        else this.failActive('socket_closed');
        this.onEvent({ type: 'stream.closed' });
      });
    });
  }

  startTurn(requestId: string) {
    if (!this.ready || this.activeRequestId) return false;
    this.activeRequestId = requestId;
    this.audioRequestId = null;
    this.clearResponseTimeout();
    this.ended = false;
    this.sendControl({
      type: 'start',
      requestId,
      format: 'pcm16',
      rate: VOICE_SAMPLE_RATE,
      channels: 1,
    });
    return true;
  }

  sendAudio(audio: ArrayBuffer) {
    if (!this.ready || !this.activeRequestId || this.ended || !audio.byteLength) return false;
    this.socket!.send(audio);
    return true;
  }

  endTurn() {
    if (!this.ready || !this.activeRequestId || this.ended) return false;
    this.ended = true;
    this.sendControl({ type: 'end_of_speech', requestId: this.activeRequestId });
    this.armResponseTimeout('first_audio_timeout');
    return true;
  }

  cancelTurn(reason = 'barge_in') {
    if (!this.activeRequestId) return false;
    if (this.ready) {
      this.sendControl({ type: 'cancel', requestId: this.activeRequestId, reason });
    }
    this.clearResponseTimeout();
    this.activeRequestId = null;
    this.audioRequestId = null;
    this.ended = false;
    return true;
  }

  playbackStarted(requestId: string) {
    if (!this.ready || requestId !== this.activeRequestId) return false;
    this.sendControl({ type: 'playback.started', requestId });
    return true;
  }

  disconnect(reason = 'disconnect') {
    this.connectionGeneration += 1;
    this.connecting = null;
    this.cancelTurn(reason);
    this.closeSocket(reason);
  }

  private closeSocket(reason: string) {
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    if (socket && socket.readyState < 2) socket.close(1000, reason);
  }

  private sendControl(message: VoiceStreamEvent) {
    this.socket?.send(JSON.stringify(message));
  }

  private handleControl(message: VoiceStreamEvent) {
    if (!this.activeRequestId || message.requestId !== this.activeRequestId) return;
    if (message.type === 'audio.start') {
      this.audioRequestId = message.requestId;
      this.armResponseTimeout('audio_idle_timeout');
    }
    const acknowledgement = ACTION_ACKS[message.type];
    if (acknowledgement) {
      this.sendControl({ type: acknowledgement, requestId: this.activeRequestId });
    }
    this.onEvent(message);
    if (message.type === 'complete' || message.type === 'error' || message.type === 'fallback') {
      this.clearResponseTimeout();
      this.activeRequestId = null;
      this.audioRequestId = null;
      this.ended = false;
    }
  }

  private armResponseTimeout(reason: string) {
    this.clearResponseTimeout();
    this.responseTimer = this.setTimer(() => this.failActive(reason), RESPONSE_TIMEOUT_MS);
  }

  private clearResponseTimeout() {
    if (this.responseTimer) this.clearTimer(this.responseTimer);
    this.responseTimer = null;
  }

  private failActive(reason: string) {
    if (!this.activeRequestId) return;
    const requestId = this.activeRequestId;
    this.clearResponseTimeout();
    this.activeRequestId = null;
    this.audioRequestId = null;
    this.ended = false;
    this.onEvent({ type: 'error', requestId, reason });
  }
}
